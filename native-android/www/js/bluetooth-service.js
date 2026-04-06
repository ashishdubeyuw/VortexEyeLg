/**
 * VortexEye - Bluetooth Service
 * Manages BLE beacon data and performs trilateration to determine user position.
 * Since browsers cannot scan for beacons, this service accepts data from:
 * 1. Native app wrappers (via window.updateBeacons)
 * 2. Simulation Panel (for testing/demo)
 */

class BluetoothService {
    constructor() {
        this.beacons = new Map(); // Map of beacon ID -> {x, y, rssi, lastUpdate}
        this.listeners = [];
        this.isScanning = false;

        // Path Loss Model Constants (TxPower - 10 * n * log10(d))
        this.TX_POWER = -59; // RSSI at 1 meter
        this.N_FACTOR = 2.0; // Environmental factor (2.0 = free space, 3.0+ = walls)

        // Smoothing
        this.smoothingFactor = 0.3; // 0 = no change, 1 = instant change
        this.lastPosition = null;
    }

    /**
     * Initialize with known beacon positions from config
     */
    init(beaconConfig) {
        if (!beaconConfig) return;

        beaconConfig.forEach(b => {
            this.beacons.set(b.id, {
                id: b.id,
                x: b.x,
                y: b.y,
                label: b.label,
                rssi: -100, // Default weak signal
                distance: Infinity,
                lastUpdate: 0
            });
        });

        console.log(`🔵 BluetoothService initialized with ${this.beacons.size} beacons`);
    }

    /**
     * Start "scanning" (listening for updates)
     */
    start() {
        this.isScanning = true;
        // In a real app, this might start a WebSocket or native plugin listener
        console.log('🔵 Bluetooth scanning started');
    }

    /**
     * Stop scanning
     */
    stop() {
        this.isScanning = false;
        console.log('🔵 Bluetooth scanning stopped');
    }

    /**
     * Update a beacon's RSSI (called by Native Wrapper or Simulator)
     * @param {string} id - Beacon ID
     * @param {number} rssi - Signal strength in dBm (e.g., -60)
     */
    updateBeacon(id, rssi) {
        if (!this.isScanning) return;

        const beacon = this.beacons.get(id);
        if (beacon) {
            beacon.rssi = rssi;
            beacon.distance = this.calculateDistance(rssi);
            beacon.lastUpdate = Date.now();

            // Try to triangulate after every update
            this.triangulatePosition();
        }
    }

    /**
     * Calculate distance from RSSI using Log-Distance Path Loss Model
     * d = 10 ^ ((TxPower - RSSI) / (10 * n))
     */
    calculateDistance(rssi) {
        if (rssi === 0) return -1.0;

        const ratio = (this.TX_POWER - rssi) / (10 * this.N_FACTOR);
        return Math.pow(10, ratio);
    }

    /**
     * Perform trilateration to find (x, y)
     * Requires at least 3 beacons with valid signals
     */
    triangulatePosition() {
        // Filter active beacons (updated in last 5 seconds)
        const activeBeacons = Array.from(this.beacons.values())
            .filter(b => Date.now() - b.lastUpdate < 5000 && b.distance < 20); // Filter out very far/stale beacons

        if (activeBeacons.length < 3) {
            // Not enough beacons for full triangulation
            // If we have 1 or 2, we could do proximity or weighted centroid
            if (activeBeacons.length > 0) {
                this.estimateProximity(activeBeacons);
            }
            return;
        }

        // Sort by signal strength (strongest first)
        activeBeacons.sort((a, b) => b.rssi - a.rssi);

        // Use top 3 beacons for trilateration
        const [b1, b2, b3] = activeBeacons;

        // Simplified 2D Trilateration
        // Using linearized approach or weighted centroid for robustness
        const newPos = this.calculateWeightedCentroid(activeBeacons);

        if (newPos) {
            // Apply smoothing
            if (this.lastPosition) {
                newPos.x = this.lastPosition.x + this.smoothingFactor * (newPos.x - this.lastPosition.x);
                newPos.y = this.lastPosition.y + this.smoothingFactor * (newPos.y - this.lastPosition.y);
            }
            this.lastPosition = newPos;

            this.notifyListeners('position', {
                x: newPos.x,
                y: newPos.y,
                beaconsUsed: activeBeacons.length,
                accuracy: 3 // Estimated accuracy in meters
            });
        }
    }

    /**
     * Calculate Weighted Centroid (simpler and often more robust for noisy RSSI)
     * Weight = 1 / distance^2
     */
    calculateWeightedCentroid(beacons) {
        let totalWeight = 0;
        let weightedX = 0;
        let weightedY = 0;

        beacons.forEach(b => {
            // Avoid division by zero
            const w = 1 / Math.pow(Math.max(0.1, b.distance), 2);
            weightedX += b.x * w;
            weightedY += b.y * w;
            totalWeight += w;
        });

        if (totalWeight > 0) {
            return {
                x: weightedX / totalWeight,
                y: weightedY / totalWeight
            };
        }
        return null;
    }

    /**
     * Proximity estimation (closest beacon)
     */
    estimateProximity(beacons) {
        // Sort by distance
        beacons.sort((a, b) => a.distance - b.distance);
        const closest = beacons[0];

        // If very close (< 2m), snap to it
        if (closest.distance < 3) {
            this.notifyListeners('position', {
                x: closest.x,
                y: closest.y,
                source: 'proximity',
                accuracy: closest.distance
            });
        }
    }

    /**
     * Add event listener
     */
    addListener(callback) {
        this.listeners.push(callback);
    }

    /**
     * Notify listeners
     */
    notifyListeners(event, data) {
        this.listeners.forEach(cb => cb(event, data));
    }

    /**
     * Get all beacons state (for Debug Panel)
     */
    getBeacons() {
        return Array.from(this.beacons.values());
    }
}

// Export global instance
window.BluetoothService = BluetoothService;
