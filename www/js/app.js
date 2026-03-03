/**
 * VortexEye - Main Application
 * Orchestrates all modules and handles UI interactions
 */

class VortexEyeApp {
    constructor() {
        // Services
        this.location = new LocationService();
        this.navigation = new OutdoorNavigation();
        this.vision = new IndoorVision();
        this.voice = new VoiceInterface();
        this.stepCounter = new StepCounter();
        this.indoorPos = new IndoorPositioningService();
        this.bluetooth = new BluetoothService(); // New Service

        // State
        this.currentMode = 'indoor';
        this.isFromIndoor = true;
        this.lastSpokenDetection = 0;
        this.indoorGridInitialized = false;

        // === NavFSM: Navigation Finite State Machine ===
        // States: IDLE | EGRESS | OUTDOOR_NAV | INDOOR_NAV | INGRESS
        this.navState = 'IDLE';
        this.cachedOutdoorRoute = null; // pre-computed route held during EGRESS

        // DOM Elements
        this.elements = {};

        // Initialize
        this.init();
    }

    /**
     * Initialize the application
     */
    async init() {
        try {
            // Cache DOM elements FIRST (required for showLoading)
            this.cacheElements();

            // OTA update check using @capgo/capacitor-updater
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorUpdater) {
                const updater = window.Capacitor.Plugins.CapacitorUpdater;
                updater.notifyAppReady();

                try {
                    const resp = await fetch(
                        'https://raw.githubusercontent.com/ashishdubeyuw/VortexEyeLg/main/version.json?t=' + Date.now(),
                        { cache: 'no-store' }
                    );
                    const manifest = await resp.json();
                    const localVer = localStorage.getItem('ve_version') || '0.0.0';
                    const remoteVer = manifest.version;

                    console.log(`OTA check: local=${localVer} remote=${remoteVer}`);

                    if (remoteVer && remoteVer !== localVer) {
                        this.showLoading(`Downloading v${remoteVer}...`);
                        const bundle = await updater.download({
                            url: manifest.url,
                            version: remoteVer
                        });
                        this.showLoading(`Installing v${remoteVer}...`);
                        // CRITICAL: set the bundle FIRST, then persist version
                        await updater.set({ id: bundle.id });
                        // Only save after set() succeeds (WebView reloads, so this line
                        // only matters if set() didn't trigger a reload)
                        localStorage.setItem('ve_version', remoteVer);
                        localStorage.setItem('ve_notes', manifest.notes || '');
                    } else {
                        console.log('App is up to date:', localVer);
                    }
                } catch (otaErr) {
                    console.error('OTA update failed:', otaErr);
                    this.showLoading(`Update Error: ${otaErr.message || otaErr}`);
                    setTimeout(() => this.hideLoading(), 4000);
                }
            }

            // NOTE: cacheElements already called above

            this.showLoading('Initializing VortexEye...');

            // Setup event listeners
            this.setupEventListeners();

            // Initialize map
            this.showLoading('Loading map...');
            await this.navigation.initMap('map');

            // Start location service
            this.showLoading('Getting your location...');
            this.location.start();

            // Setup location listener
            this.location.addListener((event, data) => {
                this.handleLocationEvent(event, data);
                this.handleLocationEvent(event, data);
            });

            // Start Bluetooth service
            this.bluetooth.start();
            this.bluetooth.addListener((event, data) => {
                if (event === 'position') {
                    // Fuse BLE position with Indoor Positioning
                    this.indoorPos.updateFromBluetooth(data);

                    // Update UI source indicator
                    if (this.elements.positionSource) {
                        this.elements.positionSource.innerText = '🔵 Bluetooth';
                    }
                }
            });

            // Initialize Debug Panel (hidden by default)
            this.debugPanel = new DebugPanel(this);

            // Setup voice listeners
            this.setupVoiceListeners();

            // Setup map click for start location picking
            this.navigation.onStartLocationPicked((lat, lng, address) => {
                this.elements.startInput.value = address;
                this.pickedStartCoords = { lat, lng };
            });

            // Setup step counter listener (start() happens on user gesture)
            this.stepCounter.addListener((data) => {
                this.updateStepCount(data.stepCount, data.distanceMeters);

                // Update indoor positioning via dead reckoning
                if (this.currentMode === 'indoor' && this.indoorGridInitialized) {
                    const heading = this.location.getHeading() || 0;
                    this.indoorPos.updatePosition(data, heading);

                    // Update UI Heading
                    if (this.elements.userHeading) {
                        this.elements.userHeading.textContent = `${Math.round(heading)}°`;
                    }

                    // Update quadrant highlight on mini-map
                    this.navigation.highlightCurrentQuadrant(this.indoorPos);
                }
            });

            // Setup indoor positioning listeners
            this.indoorPos.addListener((event, data) => {
                this.handleIndoorPositionEvent(event, data);
            });

            // Hide loading overlay
            this.hideLoading();

            console.log('🌀 VortexEye initialized');

            // Start in outdoor mode by default (Landing Page: Map Only)
            // Indoor mode will be activated when user selects an indoor target
            this.switchMode('outdoor');

            console.log('📷 Camera will be initialized on-demand when indoor mode is activated');

            // Initialize Hardware Barometer Polling (Simulated for MVP)
            // Real implementation would use capacitor-plugin-barometer or Generic Sensor API
            this._startBarometerPolling();

            // Welcome message
            setTimeout(() => {
                this.voice.speak('Welcome to Vortex Eye. Select a destination to start.');
            }, 1000);

            // Update initial guidance
            this.updateGuidance('📸', 'Point camera to scan for objects');

        } catch (error) {
            console.error('Initialization error:', error);
            this.showLoading(`Error: ${error.message}`);
        }
    }

    /**
     * Start pushing Barometer Hardware updates to the EKF Fusion Engine
     */
    _startBarometerPolling() {
        // MVP: Simulate a pressure sensor detecting an elevator ride or stairs
        // In production, this binds to: new AbsoluteOrientationSensor() or Cap plugin
        this.baseAltitude = 0;

        setInterval(() => {
            if (window.AntigravityEKF && window.AntigravityEKF.isInitialized) {
                // Determine Z-axis drift / floor changes (simulating 3.5m floors)
                // For demonstration, we'll slowly drift Z if 'demo' mode is active, or keep it 0
                let simulatedAltMeters = this.baseAltitude;

                // Demo: If indoor vision detects "Elevator", simulate going up a floor over 10s
                if (this.vision && this.vision.currentTarget === 'elevator' && this.vision.detections.length > 0) {
                    simulatedAltMeters += 0.5; // Rise half a meter per tick
                    this.baseAltitude = simulatedAltMeters;
                }

                window.AntigravityEKF.predictElevation(simulatedAltMeters);
            }
        }, 1000); // 1Hz Baro Polling
    }

    /**
     * Cache DOM elements
     */
    cacheElements() {
        this.elements = {
            // Views
            mapView: document.getElementById('mapView'),
            cameraView: document.getElementById('cameraView'),

            // Mode indicator
            modeIndicator: document.getElementById('modeIndicator'),
            modeIcon: document.getElementById('modeIcon'),
            modeText: document.getElementById('modeText'),

            // Direction (outdoor)
            directionCard: document.getElementById('directionCard'),
            directionIcon: document.getElementById('directionIcon'),
            directionText: document.getElementById('directionText'),

            // Indoor direction card (top center, like outdoor)
            indoorDirectionCard: document.getElementById('indoorDirectionCard'),
            indoorDirectionIcon: document.getElementById('indoorDirectionIcon'),
            indoorDirectionText: document.getElementById('indoorDirectionText'),

            // Indoor mini-map
            indoorMiniMap: document.getElementById('indoorMiniMap'),

            // Indoor guidance (legacy - for compatibility)
            guidanceIcon: document.getElementById('guidanceIcon'),
            guidanceText: document.getElementById('guidanceText'),

            // Status
            targetStatus: document.getElementById('targetStatus'),
            navStatus: document.getElementById('navStatus'),

            // Input
            startInput: document.getElementById('startInput'),
            clearStartBtn: document.getElementById('clearStartBtn'),
            destinationInput: document.getElementById('destinationInput'),
            goBtn: document.getElementById('goBtn'),
            micBtn: document.getElementById('micBtn'),
            voiceBtn: document.getElementById('voiceBtn'),
            quickBtns: document.querySelectorAll('.glass-quick-btn'),

            // Route Preview (Start button)
            routePreview: document.getElementById('routePreview'),
            routeDestination: document.getElementById('routeDestination'),
            routeDistance: document.getElementById('routeDistance'),
            routeDuration: document.getElementById('routeDuration'),
            startNavBtn: document.getElementById('startNavBtn'),
            cancelRouteBtn: document.getElementById('cancelRouteBtn'),

            // Offline badge
            offlineBadge: document.getElementById('offlineBadge'),

            // Overlays
            loadingOverlay: document.getElementById('loadingOverlay'),
            loadingText: document.getElementById('loadingText'),

            // Autocomplete
            suggestionsDropdown: document.getElementById('suggestionsDropdown'),

            // Step counter
            stepCount: document.getElementById('stepCount'),
            userHeading: document.getElementById('userHeading'),

            // Position source indicator
            positionSource: document.getElementById('positionSource'),

            // Settings & About
            settingsBtn: document.getElementById('settingsBtn'),
            settingsOverlay: document.getElementById('settingsOverlay'),
            closeSettingsBtn: document.getElementById('closeSettingsBtn'),
            audioToggle: document.getElementById('audioToggle'),
            aboutBtn: document.getElementById('aboutBtn'),
            aboutOverlay: document.getElementById('aboutOverlay'),
            closeAboutBtn: document.getElementById('closeAboutBtn')
        };
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Go button
        this.elements.goBtn.addEventListener('click', () => {
            this.handleDestinationSubmit();
        });

        // Enter key on input
        this.elements.destinationInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleDestinationSubmit();
            }
        });

        // Mic button
        this.elements.micBtn.addEventListener('click', () => {
            this.voice.startListening();
        });

        // Voice button (header)
        this.elements.voiceBtn.addEventListener('click', () => {
            this.voice.startListening();
        });

        // Quick action buttons
        this.elements.quickBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.target;
                this.handleIndoorTarget(target);
            });
        });

        // Clear start location button
        this.elements.clearStartBtn.addEventListener('click', () => {
            this.elements.startInput.value = '';
            this.elements.startInput.placeholder = 'Current Location (tap to change)';
            this.pickedStartCoords = null;
            this.navigation.clearStartMarker();
        });

        // Autocomplete for start input
        let autocompleteTimeout = null;
        this.elements.startInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            clearTimeout(autocompleteTimeout);

            // Clear picked coordinates when user types (they're overriding the pin)
            this.pickedStartCoords = null;
            this.navigation.clearStartMarker();

            if (query.length < 3) {
                this.hideSuggestions();
                return;
            }

            // Debounce: wait 400ms before searching
            autocompleteTimeout = setTimeout(async () => {
                try {
                    const suggestions = await this.fetchSuggestions(query);
                    this.showSuggestions(suggestions, 'start');
                } catch (err) {
                    console.warn('Autocomplete error:', err);
                }
            }, 400);
        });

        // Also add autocomplete for destination input
        this.elements.destinationInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            clearTimeout(autocompleteTimeout);

            if (query.length < 3) {
                this.hideSuggestions();
                return;
            }

            autocompleteTimeout = setTimeout(async () => {
                try {
                    const suggestions = await this.fetchSuggestions(query);
                    this.showSuggestions(suggestions, 'destination');
                } catch (err) {
                    console.warn('Autocomplete error:', err);
                }
            }, 400);
        });

        // Start Navigation button
        this.elements.startNavBtn.addEventListener('click', () => {
            this.confirmStartNavigation();
        });

        // Cancel Route button
        this.elements.cancelRouteBtn.addEventListener('click', () => {
            this.cancelPendingRoute();
        });

        // Offline/Online detection
        window.addEventListener('online', () => {
            this.updateOfflineStatus(false);
        });

        window.addEventListener('offline', () => {
            this.updateOfflineStatus(true);
        });

        // Settings Modals
        if (this.elements.settingsBtn) {
            this.elements.settingsBtn.addEventListener('click', () => {
                this.elements.settingsOverlay.classList.remove('hidden');

                // Initialize toggle state from VoiceInterface
                if (this.elements.audioToggle) {
                    this.elements.audioToggle.checked = this.voice.audioEnabled;
                }
            });
        }

        if (this.elements.closeSettingsBtn) {
            this.elements.closeSettingsBtn.addEventListener('click', () => {
                this.elements.settingsOverlay.classList.add('hidden');
            });
        }

        if (this.elements.audioToggle) {
            this.elements.audioToggle.addEventListener('change', (e) => {
                this.voice.setAudioEnabled(e.target.checked);
            });
        }

        if (this.elements.aboutBtn) {
            this.elements.aboutBtn.addEventListener('click', () => {
                this.elements.settingsOverlay.classList.add('hidden');

                // Sync about page with latest version data
                const valVersion = document.getElementById('aboutVersion');
                const valNotes = document.getElementById('aboutNotes');
                if (valVersion) {
                    valVersion.textContent = `Version ${localStorage.getItem('ve_version') || '1.0.0'}`;
                }
                if (valNotes) {
                    valNotes.textContent = `Patch Details: ${localStorage.getItem('ve_notes') || 'AI-powered indoor and outdoor navigation system designed for accessibility.'}`;
                }

                this.elements.aboutOverlay.classList.remove('hidden');
            });
        }

        if (this.elements.closeAboutBtn) {
            this.elements.closeAboutBtn.addEventListener('click', () => {
                this.elements.aboutOverlay.classList.add('hidden');
            });
        }

        // Check initial offline status
        this.updateOfflineStatus(!navigator.onLine);
    }

    /**
     * Setup voice interface listeners
     */
    setupVoiceListeners() {
        // Listening state change
        this.voice.onListeningChange((isListening) => {
            this.elements.micBtn.classList.toggle('listening', isListening);
        });

        // Voice result
        this.voice.onResult((transcript) => {
            this.elements.destinationInput.value = transcript;

            const intent = this.voice.parseIntent(transcript);
            this.handleVoiceIntent(intent);
        });
    }

    /**
     * Handle voice / text intent — NavFSM entry point
     */
    handleVoiceIntent(intent) {
        console.log('Intent:', intent);
        switch (intent.type) {
            case 'indoor_poi':
                this.handleIndoorTarget(intent.target);
                break;
            case 'navigate':
                this.routeDestination(intent.destination);
                break;
            case 'stop':
                this.stopNavigation();
                break;
            default:
                this.voice.speak("I didn't understand. Try saying 'Take me to' followed by a destination.");
        }
    }

    /**
     * NavFSM Smart Router — decides the correct state transition
     * based on where the user IS and where they want to GO.
     */
    async routeDestination(rawDestination) {
        const userEnv = this.location.getMode(); // 'indoor' | 'outdoor'
        const dest = rawDestination.replace(/\s*(near me|nearby|close to me)\s*/gi, '').trim();
        this.currentTarget = dest;

        console.log(`NavFSM: userEnv=${userEnv}, dest="${dest}"`);

        if (userEnv === 'indoor') {
            // User is indoors → need to EXIT first before GPS navigation
            this.navState = 'EGRESS';
            this.location.navState = 'EGRESS';
            this.voice.speak(`You're indoors. Let me find the exit first, then I'll route you to ${dest}.`);
            this.updateStatus(dest, 'Finding exit first...');

            // Phase 1: pre-compute outdoor route in background
            this._precomputeOutdoorRoute(dest);

            // Phase 2: switch to indoor camera and hunt for exit/door
            this.switchMode('indoor');
            if (!this.vision.isRunning) {
                try {
                    await this.vision.initCamera();
                    this.vision.start();
                } catch (e) {
                    console.warn('Camera failed:', e);
                }
            }
            this.vision.setTarget('exit');
            this.vision.onDetection((d) => this.handleDetection(d));
            this.vision.onTargetReached((hit) => {
                console.log('NavFSM: exit/door reached via vision proximity');
                this.onEgressComplete();
            });

            this.updateGuidance('🚪', 'Look for an exit or door to leave the building.');

            // Start step counter on this user gesture
            if (!this.stepCounter.isRunning) {
                this.stepCounter.start();
            }
        } else {
            // User is already outdoors → direct GPS navigation
            this.navState = 'OUTDOOR_NAV';
            this.location.navState = 'OUTDOOR_NAV';
            this.handleOutdoorNavigation(rawDestination);
        }
    }

    /**
     * Pre-compute the outdoor route while user is still indoors (EGRESS).
     * Stored in cachedOutdoorRoute for use after egress completes.
     */
    async _precomputeOutdoorRoute(dest) {
        try {
            const anchorPos = this.location.getIndoorAnchor() || this.location.getPosition();
            if (!anchorPos) { this.cachedOutdoorRoute = null; return; }
            const origin = { lat: anchorPos.lat, lng: anchorPos.lng };
            const destCoords = await this.navigation.geocode(dest, origin);
            const route = await this.navigation.getRoute(origin, destCoords);
            const resolvedName = destCoords.displayName
                ? destCoords.displayName.split(',').slice(0, 2).join(',').trim()
                : dest;
            this.cachedOutdoorRoute = { destination: resolvedName, destCoords, route };
            this.currentTarget = resolvedName;
            this.updateStatus(resolvedName, 'Route ready · Exit building to begin');
            console.log('NavFSM: outdoor route pre-computed for', resolvedName);

            // Store first-step direction so we can guide user toward the exit
            const firstStep = route.steps && route.steps[0];
            this._egressHint = firstStep ? firstStep.instruction : null;
            if (this._egressHint) {
                console.log('NavFSM: egress hint from route —', this._egressHint);
                this._startEgressHintTimer();
            }
        } catch (e) {
            console.error('NavFSM: failed to pre-compute route:', e);
            this.cachedOutdoorRoute = null;
        }
    }

    /**
     * NavFSM EGRESS → OUTDOOR_NAV transition.
     * Called when (a) vision detects exit at close range, or (b) GPS restores.
     */
    onEgressComplete() {
        if (this.navState !== 'EGRESS') return;
        this.navState = 'OUTDOOR_NAV';
        this.location.navState = 'OUTDOOR_NAV';

        this._clearEgressHintTimer();
        this._egressHint = null;

        this.voice.speak('Great, you are outside! Starting outdoor navigation.');
        this.switchMode('outdoor');
        this.vision.clearTarget();

        if (this.cachedOutdoorRoute) {
            const r = this.cachedOutdoorRoute;
            this.navigation.displayRoute(r.destCoords, true);
            const distText = this.navigation.formatDistance(r.route.distance);
            const durText = this.navigation.formatDuration(r.route.duration, r.route.distance);
            this.pendingRoute = { destination: r.destination, destCoords: r.destCoords, route: r.route, hasIndoorSegment: true };
            this.showRoutePreview(r.destination, distText, durText);
            this.updateStatus(r.destination, `${distText} • ${durText}`);
        } else {
            if (this.currentTarget) {
                this.handleOutdoorNavigation(this.currentTarget);
            }
        }
        this.cachedOutdoorRoute = null;
    }

    /** Speak egress direction hint every 20 s while no exit detected */
    _startEgressHintTimer() {
        this._clearEgressHintTimer();
        this._egressHintTimer = setInterval(() => {
            if (this.navState !== 'EGRESS' || !this._egressHint) {
                this._clearEgressHintTimer();
                return;
            }
            const hint = `No exit found yet. Heading hint: ${this._egressHint}. Keep looking for a door.`;
            this.voice.speak(hint);
            this.updateGuidance('📍', hint);
        }, 20000);
    }

    _clearEgressHintTimer() {
        if (this._egressHintTimer) {
            clearInterval(this._egressHintTimer);
            this._egressHintTimer = null;
        }
    }

    /**
     * Handle destination form submit
     */
    handleDestinationSubmit() {
        const destination = this.elements.destinationInput.value.trim();
        if (!destination) return;

        const intent = this.voice.parseIntent(destination);
        this.handleVoiceIntent(intent);
    }

    /**
     * Handle indoor target search
     */
    async handleIndoorTarget(target) {
        this.currentTarget = target;
        this.updateStatus(target, 'Searching...');

        // Switch to indoor mode
        this.switchMode('indoor');

        // Start step counter on this user gesture (required for iOS permission)
        if (!this.stepCounter.isRunning) {
            this.stepCounter.start().then(started => {
                if (!started) console.warn('Step counter unavailable — no accelerometer permission.');
            });
        }

        // Initialize camera if not already
        if (!this.vision.isRunning) {
            try {
                await this.vision.initCamera();
                this.vision.start();
            } catch (error) {
                this.voice.speak('Camera access denied. Please allow camera access.');
                return;
            }
        }

        // Set detection target
        this.vision.setTarget(target);

        // Register vision detection for both routing modes (wifi-enhance and camera-only)
        this.vision.onDetection((detection) => {
            this.handleDetection(detection);
        });

        // Use indoor positioning to find optimal target via multi-exit routing
        if (this.indoorGridInitialized) {
            const result = this.indoorPos.selectOptimalTarget(target);
            if (result) {
                // Draw the A* route on the mini-map
                this.navigation.drawQuadrantRoute(result.route, this.indoorPos);

                // Show instruction
                const instruction = this.indoorPos.getNextInstruction();
                this.updateGuidance(instruction.icon, instruction.text);

                // Announce candidates
                const allCandidates = this.indoorPos.getAllCandidates();
                if (allCandidates.length > 1) {
                    this.voice.speak(`Found ${allCandidates.length} ${target}s. Best route is to ${result.label}, ${result.pathLength} quadrants away. Score ${result.score}.`);
                } else {
                    this.voice.speak(`Found ${target} at ${result.label}. ${result.pathLength} quadrants away.`);
                }

                this.updateStatus(target, `Route: ${result.pathLength} steps · Score ${result.score}`);
                return;
            }
        }

        this.voice.speak(`Looking for ${target}. Rotate your camera slowly to scan the area.`);
        this.updateGuidance('🔄', `Rotate camera slowly to find ${target}...`);
    }

    /**
     * Handle detection result
     */
    handleDetection(detection) {
        // Scan phase complete
        if (detection && detection._scanDone) {
            this.updateGuidance('✅', 'Scanning complete! Identifying target…');
            this.updateStatus(this.currentTarget || 'None', 'Detecting…');
            return;
        }

        // No detection — camera found nothing for 3+ seconds
        if (!detection) {
            const targetLabel = this.currentTarget
                ? this.currentTarget.replace(/_/g, ' ')
                : 'target';

            if (this.navState === 'EGRESS' && this._egressHint) {
                this.updateGuidance('📍', `No exit found. Head: ${this._egressHint}`);
            } else {
                this.updateGuidance('🔍', `No ${targetLabel} detected. Keep scanning.`);
            }
            this.updateStatus(this.currentTarget || 'None', 'Scanning...');
            return;
        }

        // Obstacle warning (High Priority)
        if (detection.isObstacle) {
            const dist = detection.distanceMeters || 0.5;
            const lbl = detection.label || 'Object';
            this.updateGuidance('⛔', `${lbl} ${dist}m ahead — STOP!`);
            this.voice.speak(`Warning! ${lbl} ${dist} meters ahead. Stop immediately!`);
            this.showDirection('⛔', `DEAD END — ${lbl} ${dist}m ahead`);

            const overlay = document.getElementById('detectionOverlay');
            if (overlay) {
                overlay.style.border = '4px solid #ef4444';
                overlay.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
                clearTimeout(this.obstacleTimeout);
                this.obstacleTimeout = setTimeout(() => {
                    overlay.style.border = 'none';
                    overlay.style.backgroundColor = 'transparent';
                    this.updateGuidance('✅', 'Path clear.');
                }, 2000);
            }
            return;
        }

        const guidance = this.vision.generateGuidance(detection);
        this.updateGuidance(guidance.icon, guidance.text);
        this.updateStatus(this.currentTarget, 'Found!');

        // Indoor positioning drift correction
        if (this.indoorGridInitialized) {
            this.indoorPos.correctWithDetection(detection);
            this.navigation.highlightCurrentQuadrant(this.indoorPos);
        }

        // Draw predicted path on map
        const heading = this.location.getHeading() || 0;
        this.navigation.drawIndoorPredictedPath(detection, heading);

        const now = Date.now();

        // OCR sign text: speak immediately with 8s cooldown, separate from regular cooldown
        if (detection._ocrAnnounce && guidance.ocrRead) {
            if (!this._lastOcrSpoken || now - this._lastOcrSpoken >= 8000) {
                this._lastOcrSpoken = now;
                this.voice.speak(`Sign board detected. It reads: ${guidance.ocrRead}.`);
            }
            return; // skip regular 10s cooldown for OCR-only events
        }

        // Regular detection voice (10s cooldown)
        if (now - this.lastSpokenDetection > 10000) {
            this.voice.speak(guidance.text);
            this.lastSpokenDetection = now;
        }
    }

    /**
     * Handle outdoor navigation
     */
    async handleOutdoorNavigation(rawDestination) {
        // Strip proximity suffixes so geocoder gets a clean query
        const destination = rawDestination.replace(/\s*(near me|nearby|near by|close to me)\s*/gi, '').trim();
        this.currentTarget = destination;
        this.updateStatus(destination, 'Finding nearby...');

        // Switch to outdoor mode
        this.switchMode('outdoor');

        try {
            let originCoords;
            const customStart = this.elements.startInput.value.trim();

            if (customStart) {
                this.updateStatus(destination, 'Finding start location...');
                const startResult = await this.navigation.geocode(customStart);
                originCoords = { lat: startResult.lat, lng: startResult.lng };
            } else {
                const currentPos = this.location.getPosition();
                if (!currentPos) {
                    this.voice.speak('Waiting for GPS signal...');
                    this.updateStatus(destination, 'Waiting for GPS...');
                    return;
                }
                originCoords = { lat: currentPos.lat, lng: currentPos.lng };
            }

            this.updateStatus(destination, 'Finding nearest...');
            const destCoords = await this.navigation.geocode(destination, originCoords);

            // Use resolved place name for all UI updates
            const resolvedName = destCoords.displayName
                ? destCoords.displayName.split(',').slice(0, 2).join(',').trim()
                : destination;

            // BUG FIX: Update the global current target so navigation uses the specific
            // shop name (e.g., Starbucks) rather than the generic search query ("coffee")
            this.currentTarget = resolvedName;

            const route = await this.navigation.getRoute(originCoords, destCoords);

            const hasIndoorSegment = this.isFromIndoor ||
                this.location.getMode() === 'indoor' ||
                this.location.getMode() === 'detecting';
            this.navigation.displayRoute(destCoords, hasIndoorSegment);

            this.pendingRoute = { destination: resolvedName, destCoords, route, hasIndoorSegment };

            const distanceText = this.navigation.formatDistance(route.distance);
            const durationText = this.navigation.formatDuration(route.duration, route.distance);
            this.showRoutePreview(resolvedName, distanceText, durationText);

            // Show resolved place name in the target status
            this.updateStatus(resolvedName, `${distanceText} • ${durationText}`);

            this.voice.speak(`Route found to ${resolvedName}. ${distanceText}, about ${durationText}. Press Start to begin navigation.`);

        } catch (error) {
            console.error('Navigation error:', error);
            this.voice.speak(`Sorry, couldn't find route to ${destination}`);
            this.updateStatus(destination, 'Route not found');
        }
    }

    /**
     * Show route preview card
     */
    showRoutePreview(destination, distance, duration) {
        this.elements.routeDestination.textContent = `📍 ${destination}`;
        this.elements.routeDistance.textContent = distance;
        this.elements.routeDuration.textContent = duration;
        this.elements.routePreview.classList.remove('hidden');
    }

    /**
     * Hide route preview card
     */
    hideRoutePreview() {
        this.elements.routePreview.classList.add('hidden');
    }

    /**
     * Confirm and start navigation (called when Start button pressed).
     * NavFSM-aware: only switch to indoor camera if navigation requires it.
     */
    confirmStartNavigation() {
        if (!this.pendingRoute) return;
        this.hideRoutePreview();

        const isOutdoorNav = this.navState === 'OUTDOOR_NAV';

        if (isOutdoorNav) {
            this.switchMode('outdoor');
        } else {
            this.switchMode('indoor');
        }

        this.navigation.startNavigation();

        const instruction = this.navigation.getNextInstruction();
        if (instruction) {
            this.showDirection(
                this.navigation.getDirectionEmoji(instruction.maneuver),
                instruction.instruction
            );
        }
        this.voice.speak(`Navigation started. ${instruction?.instruction || 'Proceed to route.'}`);

        this.stepCounter.start().then(started => {
            if (!started) console.warn('Step counter could not start.');
        });

        // Only start camera for indoor-related navigation
        if (!isOutdoorNav) {
            let visionTarget = 'navigation_default';
            if (this.pendingRoute.hasIndoorSegment || this.navState === 'EGRESS') {
                visionTarget = 'door';
            }
            if (!this.vision.isRunning) {
                this.vision.initCamera().then(() => {
                    this.vision.start();
                    this.vision.setTarget(visionTarget);
                }).catch(e => console.warn('Camera failed:', e));
            } else {
                this.vision.setTarget(visionTarget);
            }
            this.vision.onDetection((d) => this.handleDetection(d));
        }

        if (window.vxLog) {
            window.vxLog.navigation('Navigation started', {
                destination: this.pendingRoute.destination,
                navState: this.navState
            });
        }

        this.pendingRoute = null;
    }

    /**
     * Cancel pending route
     */
    cancelPendingRoute() {
        this.hideRoutePreview();
        this.navigation.stopNavigation();
        this.pendingRoute = null;
        this.currentTarget = null;

        this.updateStatus('None', 'Ready');
        this.voice.speak('Route cancelled.');

        if (window.vxLog) {
            window.vxLog.navigation('Route cancelled');
        }
    }

    /**
     * Update offline status indicator
     */
    updateOfflineStatus(isOffline) {
        if (isOffline) {
            this.elements.offlineBadge.classList.remove('hidden');
            if (window.vxLog) {
                window.vxLog.warn('Network', 'Device went offline');
            }
        } else {
            this.elements.offlineBadge.classList.add('hidden');
            if (window.vxLog) {
                window.vxLog.info('Network', 'Device is online');
            }
        }
    }

    /**
     * Handle combined indoor to outdoor journey
     */
    async handleCombinedJourney(origin, destination) {
        // First, find exit (indoor phase)
        this.voice.speak(`I'll help you get from ${origin} to ${destination}. First, let's find the exit.`);

        this.updateStatus(`${origin} → ${destination}`, 'Finding exit...');

        // Start indoor navigation to exit
        await this.handleIndoorTarget('exit');

        // The outdoor navigation will be triggered when GPS is restored
        // (detected in handleLocationEvent)
        this.pendingOutdoorDestination = destination;
    }

    /**
     * Stop current navigation
     */
    stopNavigation() {
        this.navigation.stopNavigation();
        this.vision.clearTarget();
        this.vision.stop();

        this.currentTarget = null;
        this.pendingOutdoorDestination = null;
        this.cachedOutdoorRoute = null;
        this._egressHint = null;
        this._clearEgressHintTimer();

        this.navState = 'IDLE';
        this.location.navState = 'IDLE';

        this.hideDirection();
        this.updateStatus('None', 'Ready');
        this.updateGuidance('🔍', 'Navigation stopped');

        this.voice.speak('Navigation stopped.');
    }

    /**
     * Handle location events
     */
    handleLocationEvent(event, data) {
        switch (event) {
            case 'position':
                // Pass speed and heading to enable dynamic mode switching (walking -> driving)
                this.navigation.updatePosition(data.lat, data.lng, data.speed, data.heading);
                // Update position source indicator
                if (this.elements.positionSource) {
                    const src = this.location.getPositionSource();
                    const labels = { 'gps': '🛰️ GPS', 'wifi-enhanced': '📶 WiFi-Enhanced', 'none': '❌ None' };
                    this.elements.positionSource.textContent = labels[src] || src;
                }
                // Update heading if available
                if (this.elements.userHeading && data.heading !== null && data.heading !== undefined) {
                    this.elements.userHeading.textContent = `${Math.round(data.heading)}°`;
                }
                break;

            case 'modeChange':
                // Automatic mode switching based on GPS signal quality (85%+ required for outdoor)
                const signalPercent = this.location.getSignalStrengthPercent();

                // STRICT LOCK: Never switch to outdoor if an indoor route requires reaching a transition point
                if (data.current === 'outdoor' && this.navigation.transitionPoint) {
                    const currentPos = this.location.getPosition();
                    if (currentPos) {
                        const dist = this.navigation.calculateDistance(
                            currentPos.lat, currentPos.lng,
                            this.navigation.transitionPoint[1], this.navigation.transitionPoint[0]
                        );
                        // If we are more than 15 meters away, STRICTLY stay indoor
                        if (dist > 0.015) {
                            console.log(`🔒 Strict Lock: Staying in indoor mode until orange marker is reached (${(dist * 1000).toFixed(0)}m away)`);
                            this.location.forceIndoorMode();
                            return; // Stop processing the mode change
                        } else {
                            // Reached transition point! Proceed with outdoor switch and clear transition point
                            this.navigation.transitionPoint = null;
                        }
                    } else {
                        // If we don't have a firm position yet, default to strict locking to be safe
                        this.location.forceIndoorMode();
                        return;
                    }
                }

                console.log(`🔄 Auto-switching to ${data.current} mode (GPS signal: ${signalPercent}%)`);

                if (data.current === 'indoor') {
                    // Switch to indoor mode
                    this.switchMode('indoor');
                    this.voice.speak(`GPS signal is ${signalPercent} percent. Using indoor camera mode.`);
                    this.updateGuidance('📸', `Indoor mode (GPS: ${signalPercent}%)`);

                    // Initialize camera if needed
                    if (!this.vision.isRunning) {
                        this.vision.initCamera().then(() => {
                            this.vision.start();

                            // Re-apply target and missing callbacks for the vision loop
                            if (this.currentTarget) {
                                this.vision.setTarget(this.currentTarget);
                            }
                            this.vision.onDetection((detection) => {
                                this.handleDetection(detection);
                            });
                        }).catch(err => {
                            console.warn('Failed to start camera for indoor mode:', err);
                        });
                    } else {
                        // Even if it is running, make sure callback and target are locked in
                        if (this.currentTarget) {
                            this.vision.setTarget(this.currentTarget);
                        }
                        this.vision.onDetection((detection) => {
                            this.handleDetection(detection);
                        });
                    }
                } else {
                    // Switch to outdoor mode (only happens when GPS > 85%)
                    this.switchMode('outdoor');
                    this.voice.speak(`Strong GPS signal at ${signalPercent} percent. Switching to outdoor navigation.`);

                    // If we had a pending destination, resume navigation
                    if (this.pendingOutdoorDestination) {
                        this.handleOutdoorNavigation(this.pendingOutdoorDestination);
                        this.pendingOutdoorDestination = null;
                    }
                }
                break;

            case 'error':
                console.warn('Location error:', data);
                break;

            case 'egress_gps_restored':
                console.log('NavFSM: GPS restored during EGRESS — transitioning to outdoor nav');
                this.onEgressComplete();
                break;
        }
    }

    /**
     * Handle indoor positioning events
     */
    handleIndoorPositionEvent(event, data) {
        switch (event) {
            case 'positionUpdate':
                // Update mini-map with current indoor position
                this.navigation.updateIndoorPosition(data.currentQuadrant, data.positionInQuadrant);
                break;
            case 'instruction':
                this.updateGuidance(data.icon, data.text);
                this.voice.speak(data.text);
                break;
            case 'targetReached':
                this.voice.speak(`You have reached ${data.target}.`);
                this.updateGuidance('✅', `Reached ${data.target}`);
                this.stopNavigation(); // Stop indoor navigation
                break;
            case 'error':
                console.error('Indoor positioning error:', data);
                this.voice.speak(`Indoor positioning error: ${data.message}`);
                break;
        }
    }

    /**
     * Switch between outdoor and indoor mode
     */
    switchMode(mode) {
        this.currentMode = mode;

        // Update UI
        if (mode === 'outdoor') {
            this.elements.mapView.classList.remove('hidden');
            this.elements.cameraView.classList.add('hidden');
            this.elements.modeIndicator.className = 'glass-pill outdoor';
            this.elements.modeIcon.textContent = '📍';
            this.elements.modeText.textContent = 'Outdoor Navigation';
            // Clear indoor grid overlay
            this.navigation.clearQuadrantOverlay();
        } else {
            this.elements.mapView.classList.add('hidden');
            this.elements.cameraView.classList.remove('hidden');
            this.elements.modeIndicator.className = 'glass-pill indoor';
            this.elements.modeIcon.textContent = '📸';

            // Set mode text with position source
            const source = this.location.getPositionSource();
            const sourceLabel = source === 'wifi-enhanced' ? 'WiFi-Enhanced' : 'GPS Anchor';
            this.elements.modeText.textContent = `Indoor Navigation (· ${sourceLabel})`;

            // Initialize the indoor mini-map (split-screen view)
            setTimeout(async () => {
                await this.navigation.initIndoorMiniMap('indoorMiniMap');
                this.navigation.replicateRouteToMiniMap();
                this.initIndoorQuadrantGrid();

                // Make mini-map draggable
                const mapHalf = document.querySelector('.indoor-map-half');
                if (mapHalf && !mapHalf._dragBound) {
                    mapHalf._dragBound = true;
                    let sx, sy, ox, oy;
                    mapHalf.addEventListener('touchstart', (e) => {
                        const t = e.touches[0];
                        sx = t.clientX; sy = t.clientY;
                        ox = mapHalf.offsetLeft; oy = mapHalf.offsetTop;
                        mapHalf.style.right = 'auto'; mapHalf.style.bottom = 'auto';
                        mapHalf.style.left = ox + 'px'; mapHalf.style.top = oy + 'px';
                    }, { passive: true });
                    mapHalf.addEventListener('touchmove', (e) => {
                        const t = e.touches[0];
                        mapHalf.style.left = (ox + t.clientX - sx) + 'px';
                        mapHalf.style.top = (oy + t.clientY - sy) + 'px';
                    }, { passive: true });
                }
            }, 100);
        }
    }

    /**
     * Initialize the indoor quadrant grid on mode switch
     */
    initIndoorQuadrantGrid() {
        // Get anchor position from location service or use a default
        const anchor = this.location.getIndoorAnchor() || this.location.getPosition();
        if (anchor) {
            this.indoorPos.setAnchorPosition(anchor);
        } else {
            // No GPS fix yet — use default Seattle coords as anchor
            this.indoorPos.setAnchorPosition({ lat: 47.6553, lng: -122.3035, accuracy: 50 });
        }

        // Initialize quadrant grid with default building config
        const config = BuildingConfigs.getConfig('default');
        this.indoorPos.initQuadrantGrid(config);
        this.indoorGridInitialized = true;

        // Initialize Bluetooth Beacons if available in config
        if (config.beacons && this.bluetooth) {
            this.bluetooth.init(config.beacons);
        }

        // Draw content on the mini-map
        if (this.indoorPos.getCurrentRoute()) {
            // Case 1: Indoor Grid Navigation active - show grid route
            this.navigation.drawQuadrantRoute(this.indoorPos.getCurrentRoute(), this.indoorPos);
        }
        // Always replicate OSRM route to mini-map if one exists (covers both navigating + quick-button entry)
        if (this.navigation.currentRoute) {
            this.navigation.replicateRouteToMiniMap();
        } else {
            // Case 3: Just exploring - show grid POIs
            this.navigation.drawQuadrantGrid(this.indoorPos);
        }

        // Update position source in status
        if (this.elements.navStatus) {
            this.elements.navStatus.textContent = `Indoor Grid Active (· ${this.indoorPos.getAnchorPosition()?.source || 'anchor'})`;
        }
    }

    /**
     * Update status panel
     */
    updateStatus(target, status) {
        this.elements.targetStatus.textContent = target || 'None';
        this.elements.navStatus.textContent = status || 'Ready';
    }

    /**
     * Update indoor guidance (uses the new top-center direction card)
     */
    updateGuidance(icon, text) {
        // Update new indoor direction card (top center, like outdoor)
        if (this.elements.indoorDirectionIcon) {
            this.elements.indoorDirectionIcon.textContent = icon;
        }
        if (this.elements.indoorDirectionText) {
            this.elements.indoorDirectionText.textContent = text;
        }

        // Also update legacy elements if they exist (for compatibility)
        if (this.elements.guidanceIcon) {
            this.elements.guidanceIcon.textContent = icon;
        }
        if (this.elements.guidanceText) {
            this.elements.guidanceText.textContent = text;
        }
    }

    /**
     * Show direction card
     */
    showDirection(icon, text) {
        this.elements.directionIcon.textContent = icon;
        this.elements.directionText.textContent = text;
        this.elements.directionCard.style.display = 'flex';
    }

    /**
     * Hide direction card
     */
    hideDirection() {
        this.elements.directionCard.style.display = 'none';
    }

    /**
     * Show loading overlay
     */
    showLoading(message) {
        this.elements.loadingText.textContent = message;
        this.elements.loadingOverlay.classList.remove('hidden');
    }

    /**
     * Hide loading overlay
     */
    hideLoading() {
        this.elements.loadingOverlay.classList.add('hidden');
    }

    /**
     * Fetch suggestions from Nominatim
     */
    async fetchSuggestions(query) {
        const currentPos = this.location.getPosition();
        const params = new URLSearchParams({
            q: query,
            format: 'json',
            limit: 5,
            addressdetails: 1
        });

        // Add location bias if available
        if (currentPos) {
            const delta = 0.5;
            const viewbox = [
                currentPos.lng - delta,
                currentPos.lat + delta,
                currentPos.lng + delta,
                currentPos.lat - delta
            ].join(',');
            params.append('viewbox', viewbox);
            params.append('bounded', '1');
        }

        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?${params}`,
            { headers: { 'User-Agent': 'VortexEye/1.0' } }
        );
        return await response.json();
    }

    /**
     * Show suggestions dropdown
     */
    showSuggestions(results, targetField) {
        const dropdown = this.elements.suggestionsDropdown;

        if (!results || results.length === 0) {
            this.hideSuggestions();
            return;
        }

        dropdown.innerHTML = results.map(r => {
            const parts = r.display_name.split(',');
            const shortName = parts.slice(0, 3).join(',').trim();
            return `<div class="suggestion-item" data-lat="${r.lat}" data-lng="${r.lon}" data-name="${shortName}" data-target="${targetField}">${shortName}</div>`;
        }).join('');

        // Add click handlers
        dropdown.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                const target = item.dataset.target;
                const name = item.dataset.name;

                if (target === 'start') {
                    this.elements.startInput.value = name;
                    this.pickedStartCoords = {
                        lat: parseFloat(item.dataset.lat),
                        lng: parseFloat(item.dataset.lng)
                    };
                } else {
                    this.elements.destinationInput.value = name;
                }

                this.hideSuggestions();
            });
        });

        dropdown.classList.remove('hidden');
    }

    /**
     * Hide suggestions dropdown
     */
    hideSuggestions() {
        this.elements.suggestionsDropdown.classList.add('hidden');
        this.elements.suggestionsDropdown.innerHTML = '';
    }

    /**
     * Update step count display
     */
    updateStepCount(steps, distanceMeters) {
        if (this.elements.stepCount) {
            const distanceDisplay = distanceMeters > 0
                ? ` (${distanceMeters.toFixed(1)}m)`
                : '';
            this.elements.stepCount.textContent = `${steps}${distanceDisplay}`;
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new VortexEyeApp();
});
