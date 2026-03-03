/**
 * VortexEye - Location Service
 * GPS tracking, signal quality detection, and mode switching
 */

class LocationService {
    constructor() {
        this.currentPosition = null;
        this.watchId = null;
        this.listeners = [];
        this.mode = 'indoor'; // Default to indoor mode (changed from 'detecting')

        // GPS Signal Strength Thresholds
        // For accessibility (blind users, seniors, kids), we only switch to outdoor 
        // when GPS signal is very strong (>85% = accuracy < 10m)
        this.GPS_THRESHOLDS = {
            STRONG: 10,   // accuracy < 10m = outdoor mode (85%+ signal strength)
            WEAK: 30,     // accuracy < 30m = transitioning zone
            LOST: 50      // accuracy > 50m = indoor mode (unreliable GPS)
        };

        // Max accuracy we consider for percentage calculation (100m = 0% signal)
        this.MAX_ACCURACY_METERS = 100;

        // Indoor anchor: last known GPS position when switching to indoor
        this.indoorAnchorPosition = null;

        // Strict lock to prevent toggling
        this.lockedMode = null;

        // Position source indicator
        this.positionSource = 'gps'; // 'gps', 'wifi-enhanced', 'none'

        // NavFSM state — set by app.js so LocationService can emit egress events
        this.navState = 'IDLE';
    }

    /**
     * Start watching GPS position
     */
    start() {
        if (!navigator.geolocation) {
            console.error('Geolocation not supported');
            this.setMode('indoor');
            return;
        }

        this.watchId = navigator.geolocation.watchPosition(
            (position) => this.handlePosition(position),
            (error) => this.handleError(error),
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 5000
            }
        );

        console.log('📍 Location service started');
    }

    /**
     * Stop watching position
     */
    stop() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
        console.log('📍 Location service stopped');
    }

    /**
     * Handle new position from GPS
     */
    handlePosition(position) {
        this.currentPosition = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            altitude: position.coords.altitude,
            heading: position.coords.heading,
            speed: position.coords.speed,
            timestamp: position.timestamp
        };

        // Determine position source based on accuracy
        // WiFi-assisted positioning typically gives 20-50m accuracy
        // Pure GPS gives <10m
        if (position.coords.accuracy < 10) {
            this.positionSource = 'gps';
        } else if (position.coords.accuracy < 50) {
            this.positionSource = 'wifi-enhanced';
        } else {
            this.positionSource = 'gps';
        }

        // Determine mode based on GPS accuracy
        const accuracy = position.coords.accuracy;
        let newMode = this.mode;

        if (this.lockedMode) {
            newMode = this.lockedMode;
        } else if (accuracy < this.GPS_THRESHOLDS.STRONG) {
            newMode = 'outdoor';
        } else if (accuracy > this.GPS_THRESHOLDS.LOST) {
            newMode = 'indoor';
        }

        if (newMode !== this.mode) {
            this.setMode(newMode);
        }

        // NavFSM egress signal: user was indoors and GPS just restored to strong
        if (this.navState === 'EGRESS' && accuracy < this.GPS_THRESHOLDS.STRONG) {
            this.notifyListeners('egress_gps_restored', this.currentPosition);
        }

        // Feed absolute GPS fix to the EKF for update/handoff calculation
        if (window.AntigravityEKF && window.AntigravityEKF.isInitialized) {
            window.AntigravityEKF.updateGPS(this.currentPosition.lat, this.currentPosition.lng, this.currentPosition.accuracy);
        }

        // Notify listeners
        this.notifyListeners('position', this.currentPosition);
    }

    /**
     * Handle GPS errors
     */
    handleError(error) {
        console.warn('GPS Error:', error.message);

        // If GPS fails, switch to indoor mode
        if (error.code === error.POSITION_UNAVAILABLE ||
            error.code === error.TIMEOUT) {
            this.setMode('indoor');
        }

        this.notifyListeners('error', error);
    }

    /**
     * Set navigation mode (outdoor/indoor)
     */
    setMode(mode) {
        const previousMode = this.mode;
        this.mode = mode;

        // Capture indoor anchor when switching outdoor → indoor
        if (mode === 'indoor' && previousMode === 'outdoor' && this.currentPosition) {
            this.indoorAnchorPosition = { ...this.currentPosition };
            console.log(`📍 Indoor anchor saved: [${this.currentPosition.lat.toFixed(5)}, ${this.currentPosition.lng.toFixed(5)}] (${this.positionSource})`);
        }

        console.log(`🔄 Mode changed: ${previousMode} → ${mode}`);
        this.notifyListeners('modeChange', { previous: previousMode, current: mode });
    }

    /**
     * Get the indoor anchor position (last GPS fix before indoor switch)
     */
    getIndoorAnchor() {
        return this.indoorAnchorPosition;
    }

    /**
     * Get the current position source
     */
    getPositionSource() {
        return this.positionSource;
    }

    /**
     * Get current mode
     */
    getMode() {
        return this.mode;
    }

    /**
     * Get current position
     */
    getPosition() {
        return this.currentPosition;
    }

    /**
     * Get current heading (compass direction in degrees)
     */
    getHeading() {
        if (!this.currentPosition || this.currentPosition.heading === null) {
            return 0; // Default to north if no heading available
        }
        return this.currentPosition.heading;
    }

    /**
     * Get GPS signal quality
     */
    getSignalQuality() {
        if (!this.currentPosition) return 'none';

        const accuracy = this.currentPosition.accuracy;
        if (accuracy < this.GPS_THRESHOLDS.STRONG) return 'strong';
        if (accuracy < this.GPS_THRESHOLDS.WEAK) return 'weak';
        return 'lost';
    }

    /**
     * Get GPS signal strength as percentage (0-100%)
     * 100% = accuracy of 0m (perfect)
     * 85%+ = good enough for outdoor navigation (< 10m accuracy)
     * 0% = accuracy >= MAX_ACCURACY_METERS
     */
    getSignalStrengthPercent() {
        if (!this.currentPosition || !this.currentPosition.accuracy) {
            return 0;
        }

        const accuracy = this.currentPosition.accuracy;
        // Convert accuracy to percentage: 0m = 100%, MAX_ACCURACY_METERS = 0%
        const percent = Math.max(0, Math.min(100,
            100 - (accuracy / this.MAX_ACCURACY_METERS) * 100
        ));
        return Math.round(percent);
    }

    /**
     * Add event listener
     */
    addListener(callback) {
        this.listeners.push(callback);
    }

    /**
     * Remove event listener
     */
    removeListener(callback) {
        this.listeners = this.listeners.filter(l => l !== callback);
    }

    /**
     * Notify all listeners
     */
    notifyListeners(event, data) {
        this.listeners.forEach(callback => {
            try {
                callback(event, data);
            } catch (e) {
                console.error('Listener error:', e);
            }
        });
    }

    /**
     * Force switch to indoor mode (for testing)
     */
    forceIndoorMode() {
        this.lockedMode = 'indoor';
        this.setMode('indoor');
    }

    /**
     * Force switch to outdoor mode (for testing)
     */
    forceOutdoorMode() {
        this.lockedMode = 'outdoor';
        this.setMode('outdoor');
    }

    /**
     * Unlock strict mode locking
     */
    unlockMode() {
        this.lockedMode = null;
    }
}

// Export global instance
window.LocationService = LocationService;
