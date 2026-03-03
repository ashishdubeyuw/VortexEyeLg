/**
 * VortexEye - Indoor Positioning Service
 * Quadrant grid-based indoor navigation using WiFi-enhanced GPS anchor,
 * dead reckoning (step counter + compass), and camera drift correction.
 * Supports multi-exit optimal path selection via A* + weighted scoring.
 */

class IndoorPositioningService {
    constructor() {
        // Anchor = last known GPS position when entering indoor mode
        this.anchorPosition = null; // {lat, lng, accuracy, timestamp}

        // Quadrant grid
        this.grid = null;           // 2D array of quadrant objects
        this.gridConfig = null;     // Building config used to init
        this.gridRows = 0;
        this.gridCols = 0;
        this.cellSizeMeters = 5;    // Default cell size

        // User position tracking
        this.currentQuadrant = { row: 0, col: 0 };
        this.estimatedOffset = { x: 0, y: 0 }; // meters from anchor
        this.heading = 0;           // compass heading in degrees

        // Route state
        this.currentRoute = null;   // Array of {row, col} waypoints
        this.routeStepIndex = 0;
        this.allCandidates = [];    // All matching targets, ranked
        this.selectedCandidate = 0; // Index into allCandidates

        // Listeners
        this.listeners = [];

        // Scoring weights for multi-exit selection
        this.WEIGHTS = {
            PATH_LENGTH: 0.50,
            ACCESSIBILITY: 0.30,
            OUTDOOR_PROXIMITY: 0.20
        };
    }

    /**
     * Capture the WiFi-enhanced GPS position as indoor anchor
     * Called when transitioning outdoor → indoor
     */
    setAnchorPosition(position) {
        this.anchorPosition = {
            lat: position.lat,
            lng: position.lng,
            accuracy: position.accuracy || 30,
            timestamp: Date.now(),
            source: position.accuracy < 30 ? 'wifi-enhanced' : 'gps'
        };
        this.estimatedOffset = { x: 0, y: 0 };
        console.log(`📍 Indoor anchor captured at [${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}] (${this.anchorPosition.source})`);

        if (window.AntigravityEKF) {
            window.AntigravityEKF.setGlobalAnchor(position.lat, position.lng, this.heading || 0);
        }

        this.notifyListeners('anchor', this.anchorPosition);
    }

    /**
     * Get the current anchor position
     */
    getAnchorPosition() {
        return this.anchorPosition;
    }

    /**
     * Initialize the quadrant grid from a building configuration
     * @param {object} config - Building config from building-configs.js
     */
    initQuadrantGrid(config) {
        this.gridConfig = config;
        this.gridRows = config.rows;
        this.gridCols = config.cols;
        this.cellSizeMeters = config.cellSize || 5;

        // Build 2D grid
        this.grid = [];
        for (let r = 0; r < this.gridRows; r++) {
            this.grid[r] = [];
            for (let c = 0; c < this.gridCols; c++) {
                this.grid[r][c] = {
                    row: r,
                    col: c,
                    walkable: true,
                    pois: [],           // POI types at this quadrant
                    label: '',          // Display label
                    accessible: true,   // Accessibility flag (ramp vs stairs)
                    gpsOffset: {        // Offset from anchor in meters
                        x: c * this.cellSizeMeters,
                        y: r * this.cellSizeMeters
                    }
                };
            }
        }

        // Apply config POIs and labels
        if (config.cells) {
            config.cells.forEach(cell => {
                if (cell.row < this.gridRows && cell.col < this.gridCols) {
                    const q = this.grid[cell.row][cell.col];
                    q.pois = cell.pois || [];
                    q.label = cell.label || '';
                    q.walkable = cell.walkable !== undefined ? cell.walkable : true;
                    q.accessible = cell.accessible !== undefined ? cell.accessible : true;
                }
            });
        }

        // Set user's starting quadrant (entry point or center)
        if (config.entryQuadrant) {
            this.currentQuadrant = { ...config.entryQuadrant };
        } else {
            // Default: bottom-left (typical building entry)
            this.currentQuadrant = { row: this.gridRows - 1, col: 0 };
        }

        // Initialize EKF
        if (window.AntigravityEKF) {
            window.AntigravityEKF.init(config);
            window.AntigravityEKF.addListener('ekf_state', (state) => {
                this._handleEKFStateChanged(state);
                // Pass raw EKF state up to the app
                this.notifyListeners('ekf_update', state);
            });
            window.AntigravityEKF.addListener('floor_change', (floor) => {
                console.log(`Elevator/Stairs Transition: Floor ${floor}`);
            });
        }

        console.log(`🗺️ Quadrant grid initialized: ${this.gridCols}x${this.gridRows} cells, ${this.cellSizeMeters}m each`);
        this.notifyListeners('gridInit', { rows: this.gridRows, cols: this.gridCols });
    }

    /**
     * Handle state changes emitted by the EKF Fusion Engine
     */
    _handleEKFStateChanged(state) {
        // Only trust indoor EKF when weight < 0.5
        if (state.trustWeight > 0.5) return;

        if (state.quadrant.row !== this.currentQuadrant.row || state.quadrant.col !== this.currentQuadrant.col) {
            const targetQ = this.getQuadrantInfo(state.quadrant.row, state.quadrant.col);
            if (targetQ && targetQ.walkable) {
                this.currentQuadrant = { row: state.quadrant.row, col: state.quadrant.col };
                this.estimatedOffset = { x: state.x, y: state.y };
                console.log(`🌌 EKF State Snapped to Q(${state.quadrant.col},${state.quadrant.row}): ${targetQ.label || 'unknown'}`);
                this.notifyListeners('quadrantChange', this.currentQuadrant);
                this.checkRouteProgress();
            }
        }
    }

    /**
     * Get the current estimated quadrant
     */
    getCurrentQuadrant() {
        return { ...this.currentQuadrant };
    }

    /**
     * Get full quadrant info at given position
     */
    getQuadrantInfo(row, col) {
        if (row >= 0 && row < this.gridRows && col >= 0 && col < this.gridCols) {
            return this.grid[row][col];
        }
        return null;
    }

    /**
     * Update position based on 6-DoF EKF State Matrix
     * Replaces manual dead reckoning with fused predictions
     */
    updatePosition(stepData, heading) {
        this.heading = heading;

        if (window.AntigravityEKF && window.AntigravityEKF.isInitialized) {
            // Supply kinematics to EKF predicting continuous state
            const isStep = (stepData && stepData.distanceMeters > 0) ? 1 : 0;
            // Assumed dt of ~1 second for the interval it's usually called on
            window.AntigravityEKF.predictKinematics(isStep, 1.0);

            // Supply absolute heading to update the orientation covariance matrix
            window.AntigravityEKF.updateHeading(heading);
        }
    }

    /**
     * Correct position drift using camera detection
     * When a known POI is detected, snap to the nearest matching quadrant
     */
    correctWithDetection(detection) {
        if (!this.grid || !detection) return;

        const detectedType = detection.className || detection.label?.toLowerCase();
        if (!detectedType) return;

        // Find the closest quadrant with this POI type
        let closestQ = null;
        let closestDist = Infinity;

        for (let r = 0; r < this.gridRows; r++) {
            for (let c = 0; c < this.gridCols; c++) {
                const q = this.grid[r][c];
                const hasPOI = q.pois.some(p =>
                    p.toLowerCase().includes(detectedType) ||
                    detectedType.includes(p.toLowerCase())
                );
                if (hasPOI) {
                    const dist = Math.abs(r - this.currentQuadrant.row) + Math.abs(c - this.currentQuadrant.col);
                    if (dist < closestDist) {
                        closestDist = dist;
                        closestQ = { row: r, col: c };
                    }
                }
            }
        }

        if (closestQ && closestDist <= 3) {
            // Use EKF Vision Snap Update to absolutely bind the state without snapping drift errors
            const absX = closestQ.col * this.cellSizeMeters;
            const absY = closestQ.row * this.cellSizeMeters;

            if (window.AntigravityEKF && window.AntigravityEKF.isInitialized) {
                window.AntigravityEKF.updateVisionSnap(absX, absY);
            } else {
                // Fallback MVP behavior
                this.currentQuadrant = closestQ;
                this.estimatedOffset = { x: absX, y: absY };
                console.log(`🔧 Drift corrected → Q(${closestQ.col},${closestQ.row}) via ${detectedType} detection`);
                this.notifyListeners('driftCorrection', { quadrant: closestQ, trigger: detectedType });
            }
        }
    }

    /**
     * Update position tracking with Bluetooth Trilateration data
     * Fuses BLE (x,y) with EKF State
     * @param {object} bleData - {x, y, accuracy}
     */
    updateFromBluetooth(bleData) {
        if (!this.grid || !bleData) return;

        if (window.AntigravityEKF && window.AntigravityEKF.isInitialized) {
            // Update EKF with the absolute BLE coordinates
            window.AntigravityEKF.updateBLE(bleData.x, bleData.y, bleData.accuracy || 3.0);
        } else {
            // Fallback MVP logic
            const col = Math.floor(bleData.x / this.cellSizeMeters);
            const row = Math.floor(bleData.y / this.cellSizeMeters);

            if (col >= 0 && col < this.gridCols && row >= 0 && row < this.gridRows) {
                const newQ = { row, col };
                if (newQ.row !== this.currentQuadrant.row || newQ.col !== this.currentQuadrant.col) {
                    this.currentQuadrant = newQ;
                    this.estimatedOffset = {
                        x: col * this.cellSizeMeters,
                        y: row * this.cellSizeMeters
                    };
                    console.log(`🔵 BLE Update (Fallback) → Q(${col},${row})`);
                    this.notifyListeners('quadrantChange', this.currentQuadrant);
                    this.checkRouteProgress();
                }
            }
        }
    }

    /**
     * Find all quadrants matching a target type
     * @param {string} targetType - e.g. 'exit', 'restroom', 'elevator', 'stairs'
     */
    findAllCandidates(targetType) {
        if (!this.grid) return [];

        const target = targetType.toLowerCase();
        const candidates = [];

        for (let r = 0; r < this.gridRows; r++) {
            for (let c = 0; c < this.gridCols; c++) {
                const q = this.grid[r][c];
                const match = q.pois.some(p =>
                    p.toLowerCase().includes(target) ||
                    target.includes(p.toLowerCase())
                );
                if (match) {
                    candidates.push({
                        quadrant: { row: r, col: c },
                        label: q.label || `${targetType} at Q(${c},${r})`,
                        accessible: q.accessible,
                        pois: q.pois
                    });
                }
            }
        }

        return candidates;
    }

    /**
     * Score and rank candidates for multi-exit/multi-target selection
     * @param {Array} candidates - From findAllCandidates
     * @param {object|null} outdoorDest - {lat, lng} of outdoor destination, or null
     * @returns {Array} Ranked candidates with routes and scores
     */
    scoreAndRankCandidates(candidates, outdoorDest = null) {
        if (!candidates.length) return [];

        const scored = candidates.map(candidate => {
            // 1. Calculate A* path + length
            const route = this.calculateRoute(this.currentQuadrant, candidate.quadrant);
            const pathLength = route ? route.length : Infinity;

            // 2. Accessibility score (1.0 = fully accessible, 0.5 = stairs only)
            const accessScore = candidate.accessible ? 1.0 : 0.5;

            // 3. Outdoor proximity score (if outdoor destination given)
            let proximityScore = 0.5; // Default neutral
            if (outdoorDest && this.anchorPosition) {
                // Estimate GPS position of this exit
                const exitGPS = this.quadrantToGPS(candidate.quadrant);
                // Distance from exit to outdoor destination (rough)
                const distToOutdoor = this.haversineDistance(
                    exitGPS.lat, exitGPS.lng,
                    outdoorDest.lat, outdoorDest.lng
                );
                // Normalize: closer = higher score (max 500m considered)
                proximityScore = Math.max(0, 1 - (distToOutdoor / 500));
            }

            // Weighted total score (0-100)
            const maxPathLen = this.gridRows * this.gridCols;
            const pathScore = pathLength < Infinity ? (1 - pathLength / maxPathLen) : 0;
            const totalScore = Math.round(
                (pathScore * this.WEIGHTS.PATH_LENGTH +
                    accessScore * this.WEIGHTS.ACCESSIBILITY +
                    proximityScore * this.WEIGHTS.OUTDOOR_PROXIMITY) * 100
            );

            return {
                ...candidate,
                route,
                pathLength,
                accessScore,
                proximityScore,
                score: totalScore
            };
        });

        // Sort by score descending (best first)
        scored.sort((a, b) => b.score - a.score);
        return scored;
    }

    /**
     * Select the optimal target from multiple candidates
     * Main entry point: combines findAll + score + route
     * @param {string} targetType - e.g. 'exit'
     * @param {object|null} outdoorDest - optional outdoor destination
     * @returns {object|null} Best candidate with route, or null
     */
    selectOptimalTarget(targetType, outdoorDest = null) {
        const candidates = this.findAllCandidates(targetType);

        if (candidates.length === 0) {
            console.log(`❌ No ${targetType} found in building grid`);
            return null;
        }

        this.allCandidates = this.scoreAndRankCandidates(candidates, outdoorDest);
        this.selectedCandidate = 0;

        const best = this.allCandidates[0];
        this.currentRoute = best.route;
        this.routeStepIndex = 0;

        console.log(`🎯 Found ${this.allCandidates.length} ${targetType}(s):`);
        this.allCandidates.forEach((c, i) => {
            const marker = i === 0 ? '✅' : '⬜';
            console.log(`  ${marker} ${c.label}: ${c.pathLength} steps, score: ${c.score}`);
        });

        this.notifyListeners('targetSelected', {
            best,
            alternatives: this.allCandidates,
            totalFound: this.allCandidates.length
        });

        return best;
    }

    /**
     * Switch to an alternative candidate
     * @param {number} index - Index in allCandidates array
     */
    switchToAlternative(index) {
        if (index < 0 || index >= this.allCandidates.length) return null;

        this.selectedCandidate = index;
        const alt = this.allCandidates[index];
        this.currentRoute = alt.route;
        this.routeStepIndex = 0;

        console.log(`🔄 Switched to alternative: ${alt.label} (score: ${alt.score})`);
        this.notifyListeners('targetSwitched', { candidate: alt, index });

        return alt;
    }

    /**
     * A* pathfinding on the quadrant grid
     * @param {object} from - {row, col}
     * @param {object} to - {row, col}
     * @returns {Array|null} Array of {row, col} waypoints, or null
     */
    calculateRoute(from, to) {
        if (!this.grid) return null;

        // A* implementation
        const openSet = [];
        const closedSet = new Set();
        const cameFrom = new Map();
        const gScore = new Map();
        const fScore = new Map();

        const key = (r, c) => `${r},${c}`;
        const heuristic = (r1, c1, r2, c2) => Math.abs(r1 - r2) + Math.abs(c1 - c2);

        const startKey = key(from.row, from.col);
        gScore.set(startKey, 0);
        fScore.set(startKey, heuristic(from.row, from.col, to.row, to.col));
        openSet.push({ row: from.row, col: from.col, f: fScore.get(startKey) });

        while (openSet.length > 0) {
            // Get node with lowest f-score
            openSet.sort((a, b) => a.f - b.f);
            const current = openSet.shift();
            const curKey = key(current.row, current.col);

            // Reached destination
            if (current.row === to.row && current.col === to.col) {
                // Reconstruct path
                const path = [{ row: current.row, col: current.col }];
                let k = curKey;
                while (cameFrom.has(k)) {
                    k = cameFrom.get(k);
                    const [r, c] = k.split(',').map(Number);
                    path.unshift({ row: r, col: c });
                }
                return path;
            }

            closedSet.add(curKey);

            // Check 4 neighbors (up, down, left, right)
            const neighbors = [
                { row: current.row - 1, col: current.col },
                { row: current.row + 1, col: current.col },
                { row: current.row, col: current.col - 1 },
                { row: current.row, col: current.col + 1 }
            ];

            for (const n of neighbors) {
                if (n.row < 0 || n.row >= this.gridRows || n.col < 0 || n.col >= this.gridCols) continue;

                const nKey = key(n.row, n.col);
                if (closedSet.has(nKey)) continue;

                const nQuad = this.grid[n.row][n.col];
                if (!nQuad.walkable) continue;

                const tentativeG = (gScore.get(curKey) || 0) + 1;

                if (tentativeG < (gScore.get(nKey) || Infinity)) {
                    cameFrom.set(nKey, curKey);
                    gScore.set(nKey, tentativeG);
                    const f = tentativeG + heuristic(n.row, n.col, to.row, to.col);
                    fScore.set(nKey, f);

                    if (!openSet.some(o => o.row === n.row && o.col === n.col)) {
                        openSet.push({ row: n.row, col: n.col, f });
                    }
                }
            }
        }

        // No path found
        return null;
    }

    /**
     * Check if user has progressed along the route
     */
    checkRouteProgress() {
        if (!this.currentRoute || this.routeStepIndex >= this.currentRoute.length) return;

        const nextWaypoint = this.currentRoute[this.routeStepIndex];
        if (this.currentQuadrant.row === nextWaypoint.row &&
            this.currentQuadrant.col === nextWaypoint.col) {
            this.routeStepIndex++;

            if (this.routeStepIndex >= this.currentRoute.length) {
                console.log('🎉 Reached destination!');
                this.notifyListeners('arrived', { quadrant: this.currentQuadrant });
            } else {
                this.notifyListeners('waypointReached', {
                    quadrant: this.currentQuadrant,
                    remaining: this.currentRoute.length - this.routeStepIndex
                });
            }
        }
    }

    /**
     * Get the next turn-by-turn instruction
     * Returns GPS-style guidance based on current route
     */
    getNextInstruction() {
        if (!this.currentRoute || this.routeStepIndex >= this.currentRoute.length) {
            return { icon: '🎉', text: 'You have arrived!', type: 'arrived' };
        }

        const current = this.currentQuadrant;
        const next = this.currentRoute[this.routeStepIndex];
        const stepsRemaining = this.currentRoute.length - this.routeStepIndex;
        const metersRemaining = stepsRemaining * this.cellSizeMeters;
        const walkingSteps = Math.round(metersRemaining / 0.75); // 0.75m per step

        // Determine direction from current to next waypoint
        const dRow = next.row - current.row;
        const dCol = next.col - current.col;

        let direction, icon;
        if (dCol > 0) { direction = 'right'; icon = '➡️'; }
        else if (dCol < 0) { direction = 'left'; icon = '⬅️'; }
        else if (dRow > 0) { direction = 'ahead'; icon = '⬆️'; }
        else if (dRow < 0) { direction = 'back'; icon = '⬇️'; }
        else { direction = 'here'; icon = '📍'; }

        // Look ahead for turns
        let instruction = '';
        if (this.routeStepIndex + 1 < this.currentRoute.length) {
            const afterNext = this.currentRoute[this.routeStepIndex + 1];
            const nextDRow = afterNext.row - next.row;
            const nextDCol = afterNext.col - next.col;

            // Detect upcoming turn
            if (dCol !== nextDCol || dRow !== nextDRow) {
                let turnDir = '';
                if (nextDCol > 0) turnDir = 'right';
                else if (nextDCol < 0) turnDir = 'left';
                else if (nextDRow > 0) turnDir = 'straight';
                else if (nextDRow < 0) turnDir = 'back';

                instruction = `Walk ${this.cellSizeMeters} steps ${direction}, then turn ${turnDir}`;
            } else {
                instruction = `Continue ${direction} for ${walkingSteps} steps`;
            }
        } else {
            // Last stretch
            const destQ = this.grid[next.row][next.col];
            instruction = `Walk ${direction} ${this.cellSizeMeters} steps to reach ${destQ.label || 'destination'}`;
        }

        return {
            icon,
            text: instruction,
            type: 'navigate',
            direction,
            stepsRemaining: walkingSteps,
            waypointsRemaining: stepsRemaining,
            nextQuadrant: next
        };
    }

    /**
     * Get all ranked candidates (for UI display)
     */
    getAllCandidates() {
        return this.allCandidates;
    }

    /**
     * Get the current route
     */
    getCurrentRoute() {
        return this.currentRoute;
    }

    /**
     * Convert quadrant position to approximate GPS coordinates
     */
    quadrantToGPS(quadrant) {
        if (!this.anchorPosition) return { lat: 0, lng: 0 };

        const metersPerDegreeLat = 111320;
        const metersPerDegreeLng = 111320 * Math.cos((this.anchorPosition.lat * Math.PI) / 180);

        const dx = quadrant.col * this.cellSizeMeters;
        const dy = quadrant.row * this.cellSizeMeters;

        return {
            lat: this.anchorPosition.lat + (dy / metersPerDegreeLat),
            lng: this.anchorPosition.lng + (dx / metersPerDegreeLng)
        };
    }

    /**
     * Haversine distance between two GPS points (meters)
     */
    haversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /**
     * Get the full grid for visualization
     */
    getGrid() {
        return this.grid;
    }

    /**
     * Get grid config
     */
    getGridConfig() {
        return this.gridConfig;
    }

    // --- Listeners ---

    addListener(callback) {
        this.listeners.push(callback);
    }

    removeListener(callback) {
        this.listeners = this.listeners.filter(l => l !== callback);
    }

    notifyListeners(event, data) {
        this.listeners.forEach(cb => {
            try { cb(event, data); }
            catch (e) { console.error('IndoorPositioning listener error:', e); }
        });
    }
}

// Export global instance
window.IndoorPositioningService = IndoorPositioningService;
