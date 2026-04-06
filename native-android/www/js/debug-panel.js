/**
 * VortexEye - Debug Panel
 * Simulation tools for testing Bluetooth Triangulation and Obstacle Detection
 * without physical hardware.
 */

class DebugPanel {
    constructor(app) {
        this.app = app;
        this.isVisible = false;
        this.panel = null;
        this.obstacleToggle = false;

        this.init();
    }

    init() {
        // Create panel container
        this.panel = document.createElement('div');
        this.panel.className = 'debug-panel hidden';
        this.panel.innerHTML = `
            <div class="debug-header">
                <h3>🛠️ Developer Tools</h3>
                <button id="closeDebugBtn">✕</button>
            </div>
            
            <div class="debug-section">
                <h4>⚠️ Simulation</h4>
                <div class="debug-row">
                    <label>Simulate Wall Ahead</label>
                    <label class="switch">
                        <input type="checkbox" id="simObstacle">
                        <span class="slider round"></span>
                    </label>
                </div>
            </div>

            <div class="debug-section">
                <h4>🔵 Virtual Beacons (RSSI)</h4>
                <div id="beaconList"></div>
            </div>
            
            <div class="debug-section">
                <button id="resetSimBtn" class="secondary-btn">Reset Simulation</button>
            </div>
        `;

        document.body.appendChild(this.panel);

        // Add toggle button to main UI (hidden from end users)
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'debugToggleBtn';
        toggleBtn.innerText = '🛠️';
        toggleBtn.className = 'icon-btn debug-toggle';
        toggleBtn.style.display = 'none';
        toggleBtn.onclick = () => this.togglePanel();
        document.querySelector('.header-actions').appendChild(toggleBtn);

        // Event Listeners
        this.panel.querySelector('#closeDebugBtn').onclick = () => this.togglePanel();

        this.panel.querySelector('#simObstacle').onchange = (e) => {
            this.toggleObstacle(e.target.checked);
        };

        this.panel.querySelector('#resetSimBtn').onclick = () => this.resetSimulation();

        // Render beacon sliders when panel opens
        this.renderBeaconSliders();
    }

    togglePanel() {
        this.isVisible = !this.isVisible;
        this.panel.classList.toggle('hidden', !this.isVisible);

        if (this.isVisible) {
            this.renderBeaconSliders();
        }
    }

    renderBeaconSliders() {
        const beaconList = this.panel.querySelector('#beaconList');
        beaconList.innerHTML = '';

        // Get beacons from BluetoothService
        if (this.app.bluetooth && this.app.bluetooth.beacons) {
            this.app.bluetooth.beacons.forEach(beacon => {
                const row = document.createElement('div');
                row.className = 'beacon-row';

                // Slider value map: -100 (far) to -40 (close)
                const currentRssi = beacon.rssi === -100 ? -100 : beacon.rssi;

                // Calculate estimated distance for display
                const dist = this.app.bluetooth.calculateDistance(currentRssi);
                const distText = dist < 0 ? 'Unknown' : `${dist.toFixed(1)}m`;

                row.innerHTML = `
                    <div class="beacon-info">
                        <span class="beacon-id">${beacon.label || beacon.id}</span>
                        <span class="beacon-val" id="val-${beacon.id}">${currentRssi} dBm (${distText})</span>
                    </div>
                    <input type="range" min="-100" max="-40" value="${currentRssi}" 
                           class="beacon-slider" data-id="${beacon.id}">
                `;

                // Slider Logic
                const slider = row.querySelector('input');
                slider.oninput = (e) => {
                    const val = parseInt(e.target.value);
                    this.updateBeacon(beacon.id, val);

                    // Update text
                    const d = this.app.bluetooth.calculateDistance(val);
                    row.querySelector('.beacon-val').innerText = `${val} dBm (${d.toFixed(1)}m)`;
                };

                beaconList.appendChild(row);
            });
        } else {
            beaconList.innerHTML = '<p class="text-sm text-gray">No beacons configured for this building.</p>';
        }
    }

    updateBeacon(id, rssi) {
        if (this.app.bluetooth) {
            this.app.bluetooth.updateBeacon(id, rssi);
        }
    }

    toggleObstacle(active) {
        this.obstacleToggle = active;
        console.log(`⚠️ Simulation: Obstacle ${active ? 'ENABLED' : 'DISABLED'}`);

        if (this.app.vision) {
            this.app.vision.setSimulatedObstacle(active);
        }
    }

    resetSimulation() {
        // Reset sliders
        const sliders = this.panel.querySelectorAll('.beacon-slider');
        sliders.forEach(s => {
            s.value = -100;
            this.updateBeacon(s.dataset.id, -100);
        });

        // Reset obstacle
        this.panel.querySelector('#simObstacle').checked = false;
        this.toggleObstacle(false);
    }
}
