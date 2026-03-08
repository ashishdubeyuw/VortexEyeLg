/**
 * VortexEye - Building Configurations
 * Predefined indoor quadrant grid layouts for navigation
 * Each config defines: grid dimensions, cell size, POI placements, walkable paths
 */

const BuildingConfigs = {

    /**
     * Default Generic Building Layout
     * Used when no specific building config is available
     * Simple 4x3 grid representing a typical floor plan
     */
    default: {
        name: 'Generic Building',
        rows: 3,
        cols: 4,
        cellSize: 5, // meters per cell
        entryQuadrant: { row: 1, col: 0 },
        cells: [
            // Row 0 (top)
            { row: 0, col: 0, label: 'Entry', pois: ['exit', 'door'], walkable: true, accessible: true },
            { row: 0, col: 1, label: 'Hallway', pois: [], walkable: true, accessible: true },
            { row: 0, col: 2, label: 'Hallway', pois: [], walkable: true, accessible: true },
            { row: 0, col: 3, label: 'Stairs', pois: ['stairs'], walkable: true, accessible: false },
            // Row 1 (middle)
            { row: 1, col: 0, label: 'Lobby', pois: ['door'], walkable: true, accessible: true },
            { row: 1, col: 1, label: 'Lounge', pois: [], walkable: true, accessible: true },
            { row: 1, col: 2, label: 'Cafe', pois: ['lollipop'], walkable: true, accessible: true },
            { row: 1, col: 3, label: 'Elevator', pois: ['elevator'], walkable: true, accessible: true },
            // Row 2 (bottom)
            { row: 2, col: 0, label: 'Restroom', pois: ['restroom'], walkable: true, accessible: true },
            { row: 2, col: 1, label: 'Office', pois: [], walkable: true, accessible: true },
            { row: 2, col: 2, label: 'Office', pois: [], walkable: true, accessible: true },
            { row: 2, col: 3, label: 'Side Exit', pois: ['exit', 'door', 'emergency_exit'], walkable: true, accessible: true }
        ]
    },

    /**
     * Demo Building Layout (for GenAI/Agentic Fair Presentation)
     * Larger 5x4 grid with multiple exits for multi-exit demo
     */
    demo: {
        name: 'Demo Venue',
        rows: 4,
        cols: 5,
        cellSize: 4, // meters per cell
        entryQuadrant: { row: 0, col: 2 },
        cells: [
            // Row 0 (top - entrance area)
            { row: 0, col: 0, label: 'Main Exit', pois: ['exit', 'door'], walkable: true, accessible: true },
            { row: 0, col: 1, label: 'Reception', pois: [], walkable: true, accessible: true },
            { row: 0, col: 2, label: 'Main Entry', pois: ['exit', 'door'], walkable: true, accessible: true },
            { row: 0, col: 3, label: 'Info Desk', pois: ['signboard'], walkable: true, accessible: true },
            { row: 0, col: 4, label: 'East Exit', pois: ['exit', 'door'], walkable: true, accessible: true },
            // Row 1
            { row: 1, col: 0, label: 'Hallway W', pois: [], walkable: true, accessible: true },
            { row: 1, col: 1, label: 'Auditorium', pois: [], walkable: true, accessible: true },
            { row: 1, col: 2, label: 'Auditorium', pois: [], walkable: true, accessible: true },
            { row: 1, col: 3, label: 'Auditorium', pois: [], walkable: true, accessible: true },
            { row: 1, col: 4, label: 'Hallway E', pois: [], walkable: true, accessible: true },
            // Row 2
            { row: 2, col: 0, label: 'Restroom W', pois: ['restroom'], walkable: true, accessible: true },
            { row: 2, col: 1, label: 'Demo Area', pois: [], walkable: true, accessible: true },
            { row: 2, col: 2, label: 'Demo Area', pois: ['lollipop'], walkable: true, accessible: true },
            { row: 2, col: 3, label: 'Demo Area', pois: [], walkable: true, accessible: true },
            { row: 2, col: 4, label: 'Restroom E', pois: ['restroom'], walkable: true, accessible: true },
            // Row 3 (bottom)
            { row: 3, col: 0, label: 'Fire Exit W', pois: ['exit', 'emergency_exit', 'door'], walkable: true, accessible: true },
            { row: 3, col: 1, label: 'Storage', pois: [], walkable: false, accessible: false },
            { row: 3, col: 2, label: 'Elevator', pois: ['elevator'], walkable: true, accessible: true },
            { row: 3, col: 3, label: 'Stairs', pois: ['stairs'], walkable: true, accessible: false },
            { row: 3, col: 4, label: 'Fire Exit E', pois: ['exit', 'emergency_exit', 'door'], walkable: true, accessible: true }
        ],
        // Bluetooth Beacons for Triangulation Demo
        beacons: [
            { id: 'b1', label: 'Entry Beacon', x: 2, y: 0 },       // Top Center (Main Entry)
            { id: 'b2', label: 'West Beacon', x: 0, y: 2 },        // Middle Left
            { id: 'b3', label: 'East Beacon', x: 4, y: 2 },        // Middle Right
            { id: 'b4', label: 'Elevator Beacon', x: 2, y: 3 }     // Bottom Center (Elevator)
        ]
    },

    /**
     * Get config by name, fallback to default
     */
    getConfig(name) {
        return this[name] || this.default;
    },

    /**
     * List available configs
     */
    listConfigs() {
        return Object.keys(this).filter(k => typeof this[k] === 'object' && this[k].name);
    }
};

// Export
window.BuildingConfigs = BuildingConfigs;
