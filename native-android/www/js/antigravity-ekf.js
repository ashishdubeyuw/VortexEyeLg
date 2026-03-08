/**
 * VortexEye - Antigravity EKF Module
 * 6-DoF Extended Kalman Filter for Sensor Fusion and Drift Elimination
 *
 * Fuses continuous data (Accel, Gyro, Barometer) with absolute anchors
 * (BLE, Vision POI, GPS, Compass) to provide a unified, highly accurate
 * position state (x, y, z) and orientation (roll, pitch, yaw).
 */

class AntigravityEKF {
    constructor() {
        // --- 6-DoF State Vector ---
        // X = [x, y, z, vx, vy, vz, roll, pitch, yaw]^T
        // For simplicity in JS, we track these as explicit properties
        this.state = {
            x: 0, y: 0,
            z: null,                    // Altitude (null until barometer initializes)
            vx: 0, vy: 0, vz: 0,        // Velocity in m/s
            roll: 0, pitch: 0, yaw: 0   // Orientation in radians
        };

        // --- Covariance Matrix (Error uncertainty) ---
        // Simplified diagonal for MVP: [p_err, p_err, p_err, v_err, v_err, v_err, o_err, o_err, o_err]
        this.P = {
            pos: 5.0,  // High initial uncertainty in position
            vel: 1.0,  // Moderate initial uncertainty in velocity
            ori: Math.PI / 4 // High initial uncertainty in orientation (~45 deg)
        };

        // --- Process Noise (Q) ---
        // How much trust we put in our continuous predictive sensors vs the mathematical model
        this.Q = {
            pos: 0.05, // Small drift accumulates over time
            vel: 0.1,  // Velocity changes rapidly with human movement
            ori: 0.01  // Gyro drift is relatively slow
        };

        // --- State Flags & Anchors ---
        this.isInitialized = false;
        this.lastPredictionTime = 0;
        this.gridConfig = null;

        // Handoff trust weight (0.0 = 100% EKF/Indoor, 1.0 = 100% GPS/Outdoor)
        this.outdoorTrustWeight = 0.0;
        this.outdoorTransitionThreshold = 10.0; // meters of GPS accuracy

        // Global anchor reference (Lat/Lng origin for x,y conversion)
        this.gpsAnchor = null;

        // EKF Barometer Processing
        this.referencePressureP0 = 1013.25;
        this.emaPressure = null;
        this.emaAlpha = 0.15;

        // Position history ring buffer for delayed measurement updates
        this._posHistory = [];          // [{t, x, y, vx, vy}, ...]
        this._posHistoryMax = 90;       // ~3s at 30Hz step rate

        // Smooth correction accumulator (drained over successive predict calls)
        this._pendingCorrX = 0;
        this._pendingCorrY = 0;
        this._corrDrainRate = 0.15;     // drain 15% per predict cycle

        // Listeners
        this.listeners = [];
    }

    /**
     * Initialize the filter with a building config for constraint mapping
     */
    init(gridConfig) {
        this.gridConfig = gridConfig;
        this.lastPredictionTime = performance.now();
        console.log('🌌 Antigravity EKF Initialized');
    }

    /**
     * Start the filter at a known absolute GPS position
     */
    setGlobalAnchor(lat, lng, heading = 0) {
        this.gpsAnchor = { lat, lng };
        this.state.x = 0;
        this.state.y = 0;
        this.state.yaw = heading * (Math.PI / 180);

        // Reset uncertainties
        this.P.pos = 1.0;
        this.isInitialized = true;
        this.lastPredictionTime = performance.now();

        console.log(`🌌 EKF Anchor Set: [${lat}, ${lng}], Yaw: ${heading}°`);
    }

    // ==========================================
    // PREDICT STEP (Continuous IMU/Baro Data)
    // ==========================================

    /**
     * Predict step driven by IMU (Accelerometer peak detection for velocity)
     * @param {number} isStep - 1 if step detected (peak > 1.2g), 0 otherwise
     * @param {number} dt - Delta time in seconds
     */
    predictKinematics(isStep, dt) {
        if (!this.isInitialized) return;

        const strideLength = 0.75;
        const speed = isStep ? (strideLength / dt) : (this.state.vx * 0.8);

        this.state.vx = speed * Math.sin(this.state.yaw);
        this.state.vy = -speed * Math.cos(this.state.yaw);
        this.state.vz = 0;

        let newX = this.state.x + (this.state.vx * dt);
        let newY = this.state.y + (this.state.vy * dt);

        // Drain pending delayed-vision correction (smooth glide)
        if (this._pendingCorrX !== 0 || this._pendingCorrY !== 0) {
            const drainX = this._pendingCorrX * this._corrDrainRate;
            const drainY = this._pendingCorrY * this._corrDrainRate;
            newX += drainX;
            newY += drainY;
            this._pendingCorrX -= drainX;
            this._pendingCorrY -= drainY;
            // Zero-out when negligible
            if (Math.abs(this._pendingCorrX) < 0.01) this._pendingCorrX = 0;
            if (Math.abs(this._pendingCorrY) < 0.01) this._pendingCorrY = 0;
        }

        const constrained = this.constrainToGrid(newX, newY, this.state.z);
        this.state.x = constrained.x;
        this.state.y = constrained.y;

        this.P.pos += this.Q.pos * dt;
        this.P.vel += this.Q.vel * dt;

        // Record to position history ring buffer
        this._posHistory.push({
            t: Date.now(), x: this.state.x, y: this.state.y,
            vx: this.state.vx, vy: this.state.vy
        });
        if (this._posHistory.length > this._posHistoryMax) this._posHistory.shift();

        this.emitState();
    }

    /**
     * Predict step driven by Gyroscope
     * @param {number} deltaYawRad - Change in yaw since last reading
     * @param {number} dt - Delta time in seconds
     */
    predictOrientation(deltaYawRad, dt) {
        if (!this.isInitialized) return;

        this.state.yaw += deltaYawRad;

        // Normalize 0-2PI
        if (this.state.yaw < 0) this.state.yaw += 2 * Math.PI;
        if (this.state.yaw >= 2 * Math.PI) this.state.yaw -= 2 * Math.PI;

        this.P.ori += this.Q.ori * dt;
    }

    /**
     * Dynamically update the Sea Level Reference Pressure (QNH)
     * This can be fed from a Weather API to adjust absolute altitude calculation.
     * @param {number} p0_hpa - Local QNH in hPa (default: 1013.25 for standard atmosphere)
     */
    setReferencePressure(p0_hpa) {
        if (p0_hpa > 850 && p0_hpa < 1100) {
            this.referencePressureP0 = p0_hpa;
            console.log(`🌌 EKF Reference Pressure Updated to ${this.referencePressureP0} hPa`);
        }
    }

    /**
     * Update step driven by native Hardware Barometer
     * Calculates absolute altitude above sea level using the standard hypsometric formula.
     * @param {number} rawPressureHpa - Raw atmospheric pressure from sensor in hectopascals (millibars)
     */
    updatePressure(rawPressureHpa) {
        if (!this.isInitialized) return;

        // 1. Exponential Moving Average (EMA) to smooth hardware sensor noise
        if (this.emaPressure === null) {
            this.emaPressure = rawPressureHpa; // initialize instantly
        } else {
            this.emaPressure = (this.emaAlpha * rawPressureHpa) + ((1 - this.emaAlpha) * this.emaPressure);
        }

        // 2. Calculate altitude using the smoothed pressure against our Reference Pressure
        // alt = 44330 * (1 - (p / p0)^(1/5.255))
        const absoluteAltMeters = 44330.0 * (1.0 - Math.pow(this.emaPressure / this.referencePressureP0, 0.190295));

        // In a real production system with GPS, we would tie this absoluteAltMeters 
        // to our GPS anchor's known elevation. Since we don't have a 3D building model 
        // with absolute sea-level coordinates, we will just pipe this raw sea-level altitude 
        // into the EKF.

        this.predictElevation(absoluteAltMeters);
    }

    /**
     * Predict step driven by calculated Elevation
     * @param {number} absoluteAltMeters - Raw altitude above sea level
     */
    predictElevation(absoluteAltMeters) {
        if (!this.isInitialized) return;

        // Smooth heavily to ignore air conditioning drafts
        const alpha = 0.1;

        // If this is the very first reading, snap to it immediately to set our baseline
        if (this.state.z === null) {
            this.state.z = absoluteAltMeters;
        } else {
            this.state.z = (1 - alpha) * this.state.z + alpha * absoluteAltMeters;
        }

        // Detect absolute floor (assume ~3.5m per floor)
        // Since we are using absolute altitude, the raw number could be 140m (Floor 40 assuming sea level is F0)
        // Without an absolute building anchor, we just show the raw absolute floor relative to sea level
        const currentFloor = Math.round(this.state.z / 3.5);
        if (currentFloor !== this.lastFloorEmitted) {
            this.lastFloorEmitted = currentFloor;
            this.notifyListeners('floor_change', currentFloor);
        }
    }

    // ==========================================
    // UPDATE STEP (Asynchronous Anchors)
    // ==========================================

    /**
     * Generic Kalman 1D Measurement Update
     * K = P / (P + R)
     * X = X + K * (Z - X)
     * P = (1 - K) * P
     */
    _kalmanUpdate1D(currentState, currentCovariance, measurement, measVariance) {
        const kalmanGain = currentCovariance / (currentCovariance + measVariance);
        const newState = currentState + kalmanGain * (measurement - currentState);
        const newCovariance = (1 - kalmanGain) * currentCovariance;
        return { state: newState, cov: newCovariance };
    }

    /**
     * Update from Absolute Magnetometer/Compass
     * @param {number} absoluteHeadingDeg - Compass heading
     * @param {number} measVariance - Sensor noise (e.g., 0.1 for phone mag)
     */
    updateHeading(absoluteHeadingDeg, measVariance = 0.5) {
        if (!this.isInitialized) return;

        const absoluteYawRad = absoluteHeadingDeg * (Math.PI / 180);

        // Handle wraparound for interpolation
        let diff = absoluteYawRad - this.state.yaw;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;

        const res = this._kalmanUpdate1D(0, this.P.ori, diff, measVariance);

        this.state.yaw += res.state;
        this.P.ori = res.cov;

        // Normalize
        if (this.state.yaw < 0) this.state.yaw += 2 * Math.PI;
        if (this.state.yaw >= 2 * Math.PI) this.state.yaw -= 2 * Math.PI;
    }

    /**
     * Update from BLE Triangulation (Weighted Centroid)
     * @param {number} x - Local X coord
     * @param {number} y - Local Y coord
     * @param {number} measVariance - Depends on n-factor and RSSI variance (~2.0 to 5.0)
     */
    updateBLE(x, y, measVariance = 3.0) {
        if (!this.isInitialized) return;

        const resX = this._kalmanUpdate1D(this.state.x, this.P.pos, x, measVariance);
        const resY = this._kalmanUpdate1D(this.state.y, this.P.pos, y, measVariance);

        this.state.x = resX.state;
        this.state.y = resY.state;
        this.P.pos = (resX.cov + resY.cov) / 2; // Approximate joint covariance

        console.log(`📡 BLE Covariance Update -> X:${this.state.x.toFixed(2)}, Y:${this.state.y.toFixed(2)}`);
        this.emitState();
    }

    /**
     * Delayed Measurement Update from AI Visual Odometry.
     * Retrodicts state to the frame capture time, computes the error
     * between where the user was and where the POI is, then loads
     * the correction into a smooth accumulator drained by predictKinematics.
     * @param {number} anchorX - Exact local X of the detected POI
     * @param {number} anchorY - Exact local Y of the detected POI
     * @param {number} captureTs - Date.now() timestamp when the camera frame was grabbed
     */
    updateDelayedVision(anchorX, anchorY, captureTs) {
        if (!this.isInitialized) return;

        // 1. Find the closest history entry to the capture timestamp
        let best = null, bestDt = Infinity;
        for (const entry of this._posHistory) {
            const d = Math.abs(entry.t - captureTs);
            if (d < bestDt) { bestDt = d; best = entry; }
        }

        // Fallback: if no history or history too old (>3s), hard-snap as before
        if (!best || bestDt > 3000) {
            this.updateVisionSnap(anchorX, anchorY);
            return;
        }

        // 2. Compute retrodicted error (where user was at capture vs ground truth)
        const errX = anchorX - best.x;
        const errY = anchorY - best.y;

        // 3. Load into the smooth correction accumulator
        this._pendingCorrX += errX;
        this._pendingCorrY += errY;

        // 4. Collapse covariance (we now have a high-confidence measurement)
        this.P.pos = Math.min(this.P.pos, 0.5);

        console.log(`👁️ Delayed Vision Update: err=(${errX.toFixed(2)}, ${errY.toFixed(2)}), lag=${bestDt}ms, pending=(${this._pendingCorrX.toFixed(2)}, ${this._pendingCorrY.toFixed(2)})`);
    }

    /**
     * Legacy hard-snap (kept as fallback for zero-latency detections)
     */
    updateVisionSnap(anchorX, anchorY) {
        if (!this.isInitialized) return;
        const VISION_VAR = 0.01;
        const resX = this._kalmanUpdate1D(this.state.x, this.P.pos, anchorX, VISION_VAR);
        const resY = this._kalmanUpdate1D(this.state.y, this.P.pos, anchorY, VISION_VAR);
        this.state.x = resX.state;
        this.state.y = resY.state;
        this.P.pos = VISION_VAR;
        console.log(`👁️ Vision Anchor Snap -> X:${this.state.x.toFixed(2)}, Y:${this.state.y.toFixed(2)}`);
        this.emitState();
    }

    /**
     * Fused GPS Update and Handoff Logic
     * @param {number} lat 
     * @param {number} lng 
     * @param {number} accuracyMeters
     */
    updateGPS(lat, lng, accuracyMeters) {
        if (!this.gpsAnchor) this.setGlobalAnchor(lat, lng); // 1st fix

        // 1. Convert GPS (Lat, Lng) to Local Tangent Plane (X, Y in meters from anchor)
        const R = 6371000;
        const dLat = (lat - this.gpsAnchor.lat) * Math.PI / 180;
        const dLng = (lng - this.gpsAnchor.lng) * Math.PI / 180;

        const gpsX = dLng * R * Math.cos(this.gpsAnchor.lat * Math.PI / 180);
        const gpsY = -dLat * R; // GPS North=+, Grid Y Down=+

        // 2. Adjust Trust Weight based on accuracy threshold
        // If accuracy < 10m -> weight = 1.0 (100% GPS)
        // If accuracy > 50m -> weight = 0.0 (100% EKF Indoor)
        const upperThreshold = 50.0;
        let newWeight = 0;

        if (accuracyMeters <= this.outdoorTransitionThreshold) {
            newWeight = 1.0;
        } else if (accuracyMeters >= upperThreshold) {
            newWeight = 0.0;
        } else {
            // Linear transition between 10m and 50m
            newWeight = 1.0 - ((accuracyMeters - this.outdoorTransitionThreshold) / (upperThreshold - this.outdoorTransitionThreshold));
        }

        // Smooth the trust transition to prevent teleporting
        this.outdoorTrustWeight = (this.outdoorTrustWeight * 0.8) + (newWeight * 0.2);

        // 3. Mathematical Fusion (GPS vs EKF)
        if (this.outdoorTrustWeight > 0.05) {
            // When outdoor trust is active, GPS acts as an update measurement with variance = accuracy
            const measVar = Math.max(1.0, accuracyMeters);

            // Apply kalman but scaled by the trust weight
            const resX = this._kalmanUpdate1D(this.state.x, this.P.pos, gpsX, measVar);
            const resY = this._kalmanUpdate1D(this.state.y, this.P.pos, gpsY, measVar);

            // Interpolate final state based on trust weight
            this.state.x = (this.state.x * (1 - this.outdoorTrustWeight)) + (resX.state * this.outdoorTrustWeight);
            this.state.y = (this.state.y * (1 - this.outdoorTrustWeight)) + (resY.state * this.outdoorTrustWeight);

            this.P.pos = resX.cov; // shrink covariance based on GPS read

            this.emitState();
        }
    }

    // ==========================================
    // ARCHITECTURAL CONSTRAINTS
    // ==========================================

    /**
     * Prevents the coordinate state from walking through un-walkable cells
     */
    constrainToGrid(targetX, targetY, targetZ) {
        if (!this.gridConfig) return { x: targetX, y: targetY };

        const cellSize = this.gridConfig.cellSize || 5;
        const targetCol = Math.floor(targetX / cellSize);
        const targetRow = Math.floor(targetY / cellSize);

        // Check array bounds
        if (targetRow < 0 || targetRow >= this.gridConfig.rows || targetCol < 0 || targetCol >= this.gridConfig.cols) {
            // Out of bounds - allow it if outdoor trust is high, else clamp
            if (this.outdoorTrustWeight > 0.5) return { x: targetX, y: targetY };

            return {
                x: Math.max(0, Math.min(this.state.x, (this.gridConfig.cols * cellSize) - 0.1)),
                y: Math.max(0, Math.min(this.state.y, (this.gridConfig.rows * cellSize) - 0.1))
            };
        }

        // Check walkability layer
        // Find cell definition in config.cells
        const cell = this.gridConfig.cells?.find(c => c.row === targetRow && c.col === targetCol);

        if (cell && cell.walkable === false) {
            // Hit a wall! Snap back to previous known good coordinate
            console.warn(`🧱 AntigravityEKF: Trajectory collision rejected at Q(${targetCol},${targetRow})`);
            return { x: this.state.x, y: this.state.y };
        }

        // Path is clear
        return { x: targetX, y: targetY };
    }

    // ==========================================
    // OUTPUT
    // ==========================================

    emitState() {
        if (!this.gridConfig) return;
        const cellSize = this.gridConfig.cellSize || 5;

        const col = Math.floor(this.state.x / cellSize);
        const row = Math.floor(this.state.y / cellSize);

        this.notifyListeners('ekf_state', {
            x: this.state.x,
            y: this.state.y,
            z: this.state.z,
            yaw: this.state.yaw,
            quadrant: { row, col },
            trustWeight: this.outdoorTrustWeight,
            uncertaintyArea: this.P.pos
        });
    }

    addListener(evt, cb) {
        this.listeners.push({ event: evt, callback: cb });
    }

    notifyListeners(evt, data) {
        this.listeners.forEach(l => {
            if (l.event === evt || l.event === '*') l.callback(data);
        });
    }
}

// Export global instance
window.AntigravityEKF = new AntigravityEKF();
