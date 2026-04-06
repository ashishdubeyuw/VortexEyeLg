/**
 * VortexEye - Outdoor Navigation Module
 * Uses OpenStreetMap + OSRM for free routing
 */

class OutdoorNavigation {
    constructor() {
        this.map = null;
        this.currentRoute = null;
        this.currentMarker = null;
        this.destinationMarker = null;
        this.routeLine = null;
        this.transitionPoint = null;
        this.connectionLine = null;
        this.startMarker = null;
        this.onStartLocationCallback = null;
        this.indoorPredictedPath = null;
        this.detectedTargetMarker = null;
        this.instructions = [];
        this.currentStepIndex = 0;
        this.currentStepIndex = 0;
        this.isNavigating = false;

        // Transport mode state
        this.transportMode = 'walking'; // Default to walking
        // formatted roughly as 10 km/h = 2.78 m/s
        this.SPEED_THRESHOLD_DRIVING = 2.8;
        this.lastSpeedCheck = 0;

        // OSRM Profiles
        this.OSRM_PROFILES = {
            walking: 'https://router.project-osrm.org/route/v1/walking',
            driving: 'https://router.project-osrm.org/route/v1/driving'
        };
        this.OSRM_API = this.OSRM_PROFILES.walking;
        this.NOMINATIM_API = 'https://nominatim.openstreetmap.org/search';
        // Multiple Overpass API servers for failover
        this.OVERPASS_SERVERS = [
            'https://overpass.kumi.systems/api/interpreter',  // Fast mirror
            'https://maps.mail.ru/osm/tools/overpass/api/interpreter',  // Russian mirror
            'https://overpass-api.de/api/interpreter'  // Main (often congested)
        ];
        this.OVERPASS_API = this.OVERPASS_SERVERS[0];

        // Common POI keywords mapped to OSM tags
        this.POI_MAPPINGS = {
            'starbucks': { amenity: 'cafe', name: 'Starbucks' },
            'coffee': { amenity: 'cafe' },
            'cafe': { amenity: 'cafe' },
            'restaurant': { amenity: 'restaurant' },
            'food': { amenity: 'restaurant' },
            'gas': { amenity: 'fuel' },
            'gas station': { amenity: 'fuel' },
            'pharmacy': { amenity: 'pharmacy' },
            'hospital': { amenity: 'hospital' },
            'bank': { amenity: 'bank' },
            'atm': { amenity: 'atm' },
            'parking': { amenity: 'parking' },
            'hotel': { tourism: 'hotel' },
            'bus stop': { highway: 'bus_stop' },
            'bus': { highway: 'bus_stop' },
            'subway': { railway: 'station' },
            'train': { railway: 'station' },
            'supermarket': { shop: 'supermarket' },
            'grocery': { shop: 'supermarket' },
            'mall': { shop: 'mall' },
            'park': { leisure: 'park' }
        };
    }

    /**
     * Search for nearby POIs using Overpass API
     */
    async searchNearbyPOI(query, currentPosition, radiusMeters = 5000) {
        const queryLower = query.toLowerCase();

        // Check if this is a POI search
        let poiTag = null;
        let nameFilter = null;

        for (const [keyword, tags] of Object.entries(this.POI_MAPPINGS)) {
            if (queryLower.includes(keyword)) {
                poiTag = Object.entries(tags)[0]; // e.g., ['amenity', 'cafe']
                if (tags.name) {
                    nameFilter = tags.name;
                }
                break;
            }
        }

        if (!poiTag) {
            return null; // Not a POI search, use regular geocoding
        }

        const [tagKey, tagValue] = poiTag;

        // Ultra-simple query: only exact brand matching, no regex at all
        // This is MUCH faster and should work reliably
        const initialRadius = 3000; // 3km radius
        let overpassQuery;

        if (nameFilter) {
            // Brand search - use exact brand tag (fastest possible)
            overpassQuery = `
                [out:json][timeout:5];
                (
                    node["brand"="${nameFilter}"](around:${initialRadius},${currentPosition.lat},${currentPosition.lng});
                    way["brand"="${nameFilter}"](around:${initialRadius},${currentPosition.lat},${currentPosition.lng});
                );
                out center;
            `;
        } else {
            // Generic category search
            overpassQuery = `
                [out:json][timeout:5];
                (
                    node["${tagKey}"="${tagValue}"](around:${initialRadius},${currentPosition.lat},${currentPosition.lng});
                    way["${tagKey}"="${tagValue}"](around:${initialRadius},${currentPosition.lat},${currentPosition.lng});
                );
                out center;
            `;
        }


        console.log('🔍 Overpass query:', overpassQuery);

        // Try each Overpass server until one succeeds
        for (const server of this.OVERPASS_SERVERS) {
            console.log(`🌐 Trying Overpass server: ${server}`);

            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 8000); // 8s per server

                const response = await fetch(server, {
                    method: 'POST',
                    body: `data=${encodeURIComponent(overpassQuery)}`,
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    signal: controller.signal
                });

                clearTimeout(timeout);

                // Check if response is OK
                if (!response.ok) {
                    console.warn(`Overpass server ${server} returned ${response.status}`);
                    continue; // Try next server
                }

                // Check content type to avoid parsing HTML error pages
                const contentType = response.headers.get('content-type');
                if (!contentType || !contentType.includes('application/json')) {
                    console.warn(`Overpass server ${server} returned non-JSON response`);
                    continue; // Try next server
                }

                const data = await response.json();

                if (!data.elements || data.elements.length === 0) {
                    console.log(`📍 No ${query} found within ${radiusMeters}m on ${server}`);
                    return null; // No results is a valid response, don't try other servers
                }

                // Sort by distance and pick nearest
                const results = data.elements.map(el => {
                    const lat = el.lat || el.center?.lat;
                    const lng = el.lon || el.center?.lon;
                    const name = el.tags?.name || el.tags?.brand || query;
                    const dist = this.calculateDistance(
                        currentPosition.lat, currentPosition.lng, lat, lng
                    );
                    return { lat, lng, name, distance: dist };
                }).filter(r => r.lat && r.lng)
                    .sort((a, b) => a.distance - b.distance);

                if (results.length === 0) return null;

                const nearest = results[0];
                console.log(`✅ Found ${nearest.name} at ${(nearest.distance * 1000).toFixed(0)}m via ${server}`);

                return {
                    lat: nearest.lat,
                    lng: nearest.lng,
                    displayName: `${nearest.name} (${(nearest.distance * 1000).toFixed(0)}m away)`
                };
            } catch (error) {
                // Handle timeout or other errors - try next server
                if (error.name === 'AbortError') {
                    console.warn(`Overpass server ${server} timeout (8s)`);
                } else {
                    console.warn(`Overpass server ${server} error:`, error.message);
                }
                // Continue to next server
            }
        }

        // All servers failed
        console.warn('All Overpass servers failed, falling back to Nominatim');
        return null;
    }

    /**
     * Initialize map
     */
    async initMap(containerId) {
        // Load Leaflet dynamically if not present
        if (!window.L) {
            await this.loadLeaflet();
        }

        // Initialize map centered on Seattle (UW area)
        this.map = L.map(containerId, {
            zoomControl: false,
            attributionControl: false
        }).setView([47.6553, -122.3035], 15);

        // Light tile layer (white background theme)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 19
        }).addTo(this.map);

        // Add zoom control to bottom right
        L.control.zoom({ position: 'bottomright' }).addTo(this.map);

        // Setup map click for start location picking
        this.map.on('click', (e) => this.handleMapClick(e));

        console.log('🗺️ Map initialized');
    }

    /**
     * Initialize indoor mini-map (for split-screen indoor mode)
     * Shows user position and predicted path during indoor navigation
     */
    async initIndoorMiniMap(containerId) {
        // Load Leaflet dynamically if not present
        if (!window.L) {
            await this.loadLeaflet();
        }

        // Check if container exists
        const container = document.getElementById(containerId);
        if (!container) {
            console.warn('Indoor mini-map container not found:', containerId);
            return;
        }

        // If mini-map already exists, just invalidate size (container may have changed)
        if (this.indoorMiniMap) {
            this.indoorMiniMap.invalidateSize();
            return;
        }

        // Get current position from main map or use default
        let center = [47.6553, -122.3035]; // Default: Seattle
        if (this.currentMarker) {
            const pos = this.currentMarker.getLatLng();
            center = [pos.lat, pos.lng];
        }

        // Initialize mini-map with simpler controls
        this.indoorMiniMap = L.map(containerId, {
            zoomControl: false,
            attributionControl: false,
            dragging: true,
            touchZoom: true,
            scrollWheelZoom: true
        }).setView(center, 17); // Closer zoom for indoor

        // Light tile layer for better visibility in split screen
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 20
        }).addTo(this.indoorMiniMap);

        // Add marker for current position
        if (!this.indoorMiniMapMarker) {
            const pulseIcon = L.divIcon({
                className: 'current-location-marker indoor-marker',
                html: `
                    <div class="location-pulse" style="border-color: #8b5cf6"></div>
                    <div class="location-dot" style="background: #8b5cf6"></div>
                `,
                iconSize: [20, 20]
            });
            this.indoorMiniMapMarker = L.marker(center, { icon: pulseIcon }).addTo(this.indoorMiniMap);
        }

        console.log('🗺️ Indoor mini-map initialized');
    }

    /**
     * Update indoor mini-map position
     */
    updateIndoorMiniMapPosition(lat, lng) {
        if (this.indoorMiniMap && this.indoorMiniMapMarker) {
            this.indoorMiniMapMarker.setLatLng([lat, lng]);
            this.indoorMiniMap.panTo([lat, lng]);
        }
    }

    /**
     * Handle map click for setting start location
     */
    async handleMapClick(e) {
        const { lat, lng } = e.latlng;

        // Place or update start marker
        if (this.startMarker) {
            this.startMarker.setLatLng([lat, lng]);
        } else {
            const startIcon = L.divIcon({
                className: 'start-location-marker',
                html: '🟢',
                iconSize: [24, 24]
            });
            this.startMarker = L.marker([lat, lng], { icon: startIcon }).addTo(this.map);
        }

        // Reverse geocode to get address
        try {
            const address = await this.reverseGeocode(lat, lng);
            if (this.onStartLocationCallback) {
                this.onStartLocationCallback(lat, lng, address);
            }
        } catch (err) {
            console.warn('Reverse geocode failed:', err);
            if (this.onStartLocationCallback) {
                this.onStartLocationCallback(lat, lng, `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
            }
        }
    }

    /**
     * Set callback for when start location is picked on map
     */
    onStartLocationPicked(callback) {
        this.onStartLocationCallback = callback;
    }

    /**
     * Clear start marker
     */
    clearStartMarker() {
        if (this.startMarker) {
            this.map.removeLayer(this.startMarker);
            this.startMarker = null;
        }
    }

    /**
     * Reverse geocode coordinates to address
     */
    async reverseGeocode(lat, lng) {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'VortexEye/1.0' }
        });
        const data = await response.json();

        if (data.display_name) {
            // Return shortened version
            const parts = data.display_name.split(',');
            return parts.slice(0, 3).join(',').trim();
        }
        throw new Error('No address found');
    }

    /**
     * Draw predicted indoor path from user position to detected object
     * Uses detection angle and distance to calculate endpoint
     */
    drawIndoorPredictedPath(detection, userHeading = 0) {
        if (!this.map || !this.currentMarker) return;

        // Clear previous predicted path
        this.clearIndoorPredictedPath();

        if (!detection || !detection.directionInfo) return;

        // Get user's current position from marker
        const userLatLng = this.currentMarker.getLatLng();
        const userLat = userLatLng.lat;
        const userLng = userLatLng.lng;

        // Get detection info
        const angleDegrees = detection.directionInfo.angleDegrees || 0;
        const distanceMeters = detection.distanceMeters || 5;

        // Calculate absolute bearing (user heading + detection angle)
        // Default heading is 0 (north) if not provided
        const absoluteBearing = (userHeading + angleDegrees) % 360;
        const bearingRad = (absoluteBearing * Math.PI) / 180;

        // Calculate target position using haversine-like approximation
        // 1 degree ≈ 111,320 meters at equator
        const metersPerDegreeLat = 111320;
        const metersPerDegreeLng = 111320 * Math.cos((userLat * Math.PI) / 180);

        const deltaLat = (distanceMeters * Math.cos(bearingRad)) / metersPerDegreeLat;
        const deltaLng = (distanceMeters * Math.sin(bearingRad)) / metersPerDegreeLng;

        const targetLat = userLat + deltaLat;
        const targetLng = userLng + deltaLng;

        // Create midpoint for curved path (offset perpendicular to line)
        const midLat = (userLat + targetLat) / 2;
        const midLng = (userLng + targetLng) / 2;

        // Slight curve offset
        const curveOffset = distanceMeters * 0.0001;
        const perpBearing = bearingRad + Math.PI / 2;
        const curveMidLat = midLat + curveOffset * Math.cos(perpBearing);
        const curveMidLng = midLng + curveOffset * Math.sin(perpBearing);

        // Draw curved predicted path (green dashed line)
        const pathPoints = [
            [userLat, userLng],
            [curveMidLat, curveMidLng],
            [targetLat, targetLng]
        ];

        this.indoorPredictedPath = L.polyline(pathPoints, {
            color: '#10b981',
            weight: 4,
            opacity: 0.8,
            dashArray: '8, 12',
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(this.map);

        // Add target marker (detected object icon)
        const targetIcon = L.divIcon({
            className: 'detected-target-marker',
            html: `<span style="font-size: 24px;">${detection.emoji || '🎯'}</span>`,
            iconSize: [30, 30]
        });

        this.detectedTargetMarker = L.marker([targetLat, targetLng], {
            icon: targetIcon
        }).addTo(this.map);

        console.log(`📍 Predicted path: ${angleDegrees}° @ ${distanceMeters}m → [${targetLat.toFixed(5)}, ${targetLng.toFixed(5)}]`);
    }

    /**
     * Clear indoor predicted path
     */
    clearIndoorPredictedPath() {
        if (this.indoorPredictedPath) {
            this.map.removeLayer(this.indoorPredictedPath);
            this.indoorPredictedPath = null;
        }
        if (this.detectedTargetMarker) {
            this.map.removeLayer(this.detectedTargetMarker);
            this.detectedTargetMarker = null;
        }
    }

    /**
     * Load Leaflet.js dynamically
     */
    loadLeaflet() {
        return new Promise((resolve, reject) => {
            const existingScript = document.querySelector('script[src="vendor/leaflet/leaflet.js"]');
            if (existingScript || window.L) {
                resolve();
                return;
            }

            const css = document.querySelector('link[href="vendor/leaflet/leaflet.css"]');
            if (!css) {
                const cssTag = document.createElement('link');
                cssTag.rel = 'stylesheet';
                cssTag.href = 'vendor/leaflet/leaflet.css';
                document.head.appendChild(cssTag);
            }

            const script = document.createElement('script');
            script.src = 'vendor/leaflet/leaflet.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    /**
     * Update current position on map
     */
    /**
     * Update current position on map and check speed for mode switching
     */
    updatePosition(lat, lng, speed = 0, heading = 0) {
        if (!this.map) return;

        // Check for dynamic mode switch based on speed
        // Only check if we have valid speed (m/s)
        if (speed !== null && speed >= 0) {
            this.checkDynamicTransportMode(speed);
        }

        // Create or update current position marker
        if (!this.currentMarker) {
            const pulseIcon = L.divIcon({
                className: 'current-location-marker',
                html: `
                    <div class="location-pulse" style="${this.transportMode === 'driving' ? 'border-color: #ef4444' : ''}"></div>
                    <div class="location-dot" style="${this.transportMode === 'driving' ? 'background: #ef4444' : ''}"></div>
                    ${heading ? `<div class="heading-indicator" style="transform: rotate(${heading}deg)">⬆️</div>` : ''}
                `,
                iconSize: [20, 20]
            });
            this.currentMarker = L.marker([lat, lng], { icon: pulseIcon }).addTo(this.map);
        } else {
            this.currentMarker.setLatLng([lat, lng]);

            // Update marker style if mode changed (red for driving, blue for walking)
            const dot = this.currentMarker.getElement()?.querySelector('.location-dot');
            if (dot) {
                dot.style.background = this.transportMode === 'driving' ? '#ef4444' : 'var(--accent-primary)';
            }
        }

        // Always center map on current position to enable live tracking
        this.map.panTo([lat, lng]);

        // Also update the indoor minimap if it is active
        if (this.indoorMiniMap) {
            this.indoorMiniMap.panTo([lat, lng]);

            // Ensure there is a tracking marker on the mini-map
            if (!this.indoorCurrentMarker) {
                const miniIcon = L.divIcon({
                    className: 'current-location-marker',
                    html: `
                        <div class="location-pulse" style="${this.transportMode === 'driving' ? 'border-color: #ef4444' : ''}"></div>
                        <div class="location-dot" style="${this.transportMode === 'driving' ? 'background: #ef4444' : ''}"></div>
                        ${heading ? `<div class="heading-indicator" style="transform: rotate(${heading}deg)">⬆️</div>` : ''}
                    `,
                    iconSize: [20, 20]
                });
                this.indoorCurrentMarker = L.marker([lat, lng], { icon: miniIcon }).addTo(this.indoorMiniMap);
                this.quadrantLayers = this.quadrantLayers || [];
                this.quadrantLayers.push(this.indoorCurrentMarker);
            } else {
                this.indoorCurrentMarker.setLatLng([lat, lng]);
            }
        }

        // Update connection line to transition point if it exists
        this.drawConnectionToTransition();
    }

    /**
     * Check speed and switch transport mode if needed
     */
    checkDynamicTransportMode(speed) {
        // Debounce checks
        const now = Date.now();
        if (now - this.lastSpeedCheck < 2000) return;
        this.lastSpeedCheck = now;

        // If moving faster than 10km/h (2.8m/s) and currently walking, switch to driving
        if (speed > this.SPEED_THRESHOLD_DRIVING && this.transportMode === 'walking') {
            console.log(`🚗 Speed detected (${(speed * 3.6).toFixed(1)} km/h). Switching to DRIVING mode.`);
            this.setTransportMode('driving');

            // Notify user via UI/Toast
            if (window.app && window.app.voice) {
                window.app.voice.speak('Moving fast. Switching to driving mode.');
            }
        }
        // Note: We do NOT switch back to walking automatically to avoid flip-flopping 
        // at traffic lights. User can manually reset session to go back to walking.
    }

    /**
     * Set transport mode (walking/driving)
     */
    setTransportMode(mode) {
        if (this.OSRM_PROFILES[mode]) {
            this.transportMode = mode;
            this.OSRM_API = this.OSRM_PROFILES[mode];
            console.log(`🔄 Navigation mode set to: ${mode}`);

            // If currently navigating, we might want to reroute? 
            // For now, next route will use new mode.
        }
    }

    /**
     * Geocode address to coordinates with location bias
     * First tries POI search (Overpass), then falls back to Nominatim
     * @param {string} address - The search query
     * @param {object} currentPosition - Optional {lat, lng} to bias results nearby
     */
    async geocode(address, currentPosition = null) {
        const startTime = Date.now();

        // Log the query
        if (window.vxLog) {
            window.vxLog.query(address, {
                position: currentPosition,
                method: 'geocode'
            });
        }

        try {
            // First, try POI search if we have current position
            if (currentPosition) {
                const poiResult = await this.searchNearbyPOI(address, currentPosition);
                if (poiResult) {
                    const duration = Date.now() - startTime;
                    if (window.vxLog) {
                        window.vxLog.result(address, poiResult, duration);
                    }
                    return poiResult;
                }
            }

            // Fallback to Nominatim for addresses
            if (window.vxLog) {
                window.vxLog.info('Geocode', 'Trying Nominatim fallback', { query: address });
            }

            // For brand searches, add location context to improve local relevance
            let searchQuery = address;
            const brandKeywords = ['starbucks', 'mcdonalds', 'target', 'walmart', 'costco', 'safeway'];
            if (brandKeywords.some(brand => address.toLowerCase().includes(brand))) {
                // Adding geographic context helps Nominatim return local results
                searchQuery = `${address} Seattle WA`;
                console.log(`📍 Enhanced brand search: "${searchQuery}"`);
            }

            const params = new URLSearchParams({
                q: searchQuery,
                format: 'json',
                limit: 50,  // Get more results to find nearest
                addressdetails: 1
            });

            // Add location bias if we have current position
            if (currentPosition) {
                // Create a viewbox around current location (~50km radius)
                const delta = 0.5; // ~50km in degrees
                const viewbox = [
                    currentPosition.lng - delta, // left
                    currentPosition.lat + delta, // top
                    currentPosition.lng + delta, // right
                    currentPosition.lat - delta  // bottom
                ].join(',');

                params.append('viewbox', viewbox);
                params.append('bounded', '1'); // STRICT: Only return results in viewbox
            }

            const response = await fetch(`${this.NOMINATIM_API}?${params}`, {
                headers: { 'User-Agent': 'VortexEye/1.0' }
            });

            const results = await response.json();

            if (results.length === 0) {
                throw new Error('Address not found');
            }

            // If we have current position, sort results by distance and filter to nearby
            if (currentPosition && results.length > 0) {
                // Calculate distance for each result
                const resultsWithDistance = results.map(r => ({
                    ...r,
                    distance: this.calculateDistance(
                        currentPosition.lat, currentPosition.lng,
                        parseFloat(r.lat), parseFloat(r.lon)
                    )
                }));

                // Sort by distance
                resultsWithDistance.sort((a, b) => a.distance - b.distance);

                // Filter to only results within 50km (for POI searches like "starbucks")
                const MAX_DISTANCE_KM = 50;
                const nearbyResults = resultsWithDistance.filter(r => r.distance <= MAX_DISTANCE_KM);

                if (nearbyResults.length > 0) {
                    const nearest = nearbyResults[0];
                    console.log(`📍 Found ${nearest.display_name} at ${(nearest.distance).toFixed(1)}km`);

                    const duration = Date.now() - startTime;
                    const result = {
                        lat: parseFloat(nearest.lat),
                        lng: parseFloat(nearest.lon),
                        displayName: nearest.display_name
                    };

                    if (window.vxLog) {
                        window.vxLog.result(address, result, duration);
                    }

                    return result;
                } else {
                    // All results are too far away
                    console.warn(`📍 No results within ${MAX_DISTANCE_KM}km. Nearest is ${resultsWithDistance[0]?.distance.toFixed(1)}km`);
                    throw new Error(`No ${address} found within ${MAX_DISTANCE_KM}km`);
                }
            }

            // Fallback: return first result if no position for distance calc
            return {
                lat: parseFloat(results[0].lat),
                lng: parseFloat(results[0].lon),
                displayName: results[0].display_name
            };
        } catch (error) {
            console.error('Geocoding error:', error);
            if (window.vxLog) {
                window.vxLog.error('Geocode', `Failed: ${error.message}`, { query: address });
            }
            throw error;
        }
    }

    /**
     * Calculate distance between two points using Haversine formula
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in km
        const dLat = this.toRad(lat2 - lat1);
        const dLon = this.toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c; // Distance in km
    }

    toRad(deg) {
        return deg * (Math.PI / 180);
    }

    /**
     * Calculate route from current position to destination
     */
    async getRoute(origin, destination) {
        try {
            const url = `${this.OSRM_API}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=true`;

            const response = await fetch(url);
            const data = await response.json();

            if (data.code !== 'Ok' || !data.routes.length) {
                throw new Error('Route not found');
            }

            const route = data.routes[0];

            this.currentRoute = {
                distance: route.distance, // meters
                duration: route.duration, // seconds
                geometry: route.geometry,
                steps: route.legs[0].steps.map(step => ({
                    instruction: this.formatInstruction(step),
                    distance: step.distance,
                    duration: step.duration,
                    maneuver: step.maneuver
                }))
            };

            this.instructions = this.currentRoute.steps;
            this.currentStepIndex = 0;

            return this.currentRoute;
        } catch (error) {
            console.error('Routing error:', error);
            throw error;
        }
    }

    /**
     * Format OSRM instruction to human-readable text
     */
    formatInstruction(step) {
        const maneuver = step.maneuver;
        const name = step.name || 'the road';

        switch (maneuver.type) {
            case 'depart':
                return `Start on ${name}`;
            case 'arrive':
                return 'You have arrived!';
            case 'turn':
                return `Turn ${maneuver.modifier} onto ${name}`;
            case 'continue':
                return `Continue on ${name}`;
            case 'roundabout':
                return `Take the roundabout, exit onto ${name}`;
            default:
                return `Continue on ${name}`;
        }
    }

    /**
     * Display route on map with color-coded segments
     * Blue = Outdoor GPS navigation
     * Purple = Indoor camera navigation
     */
    displayRoute(destination, hasIndoorSegment = false) {
        if (!this.map || !this.currentRoute) return;

        // Clear previous route layers
        if (this.routeLine) {
            this.map.removeLayer(this.routeLine);
        }
        if (this.indoorLine) {
            this.map.removeLayer(this.indoorLine);
        }
        if (this.destinationMarker) {
            this.map.removeLayer(this.destinationMarker);
        }
        if (this.routeLegend) {
            this.map.removeControl(this.routeLegend);
        }
        if (this.connectionLine) {
            this.map.removeLayer(this.connectionLine);
            this.connectionLine = null;
        }
        this.transitionPoint = null;

        // Route colors
        const COLORS = {
            outdoor: '#3b82f6',      // Blue - GPS outdoor
            indoor: '#8b5cf6',       // Purple - Camera indoor
            transition: '#f59e0b'    // Orange - Transition zone
        };

        // Draw main outdoor route (blue)
        this.routeLine = L.geoJSON(this.currentRoute.geometry, {
            style: {
                color: COLORS.outdoor,
                weight: 6,
                opacity: 0.9,
                lineCap: 'round',
                lineJoin: 'round'
            }
        }).addTo(this.map);

        // If there's an indoor segment, add it at the start
        if (hasIndoorSegment && this.currentRoute.geometry.coordinates.length > 0) {
            const coords = this.currentRoute.geometry.coordinates;
            const startPoint = coords[0];

            // Create indoor segment (first ~50m or 5% of route)
            const indoorEndIndex = Math.min(
                Math.floor(coords.length * 0.05),
                Math.max(3, Math.floor(coords.length * 0.02))
            );

            const indoorCoords = coords.slice(0, indoorEndIndex + 1);
            const polylinePoints = indoorCoords.map(c => [c[1], c[0]]); // GeoJSON is [lng, lat], Leaflet is [lat, lng]

            // Draw indoor segment with dashed line (purple) on Main Map
            this.indoorLine = L.polyline(polylinePoints, {
                color: '#8b5cf6', // Purple
                weight: 6,
                opacity: 0.9,
                dashArray: '10, 10',
                lineCap: 'round'
            }).addTo(this.map);

            // Add transition marker
            const transitionPoint = indoorCoords[indoorCoords.length - 1];
            L.circleMarker([transitionPoint[1], transitionPoint[0]], {
                radius: 8,
                color: COLORS.transition,
                fillColor: COLORS.transition,
                fillOpacity: 1,
                weight: 2
            }).addTo(this.map).bindPopup('🚪 Exit building here<br/>GPS navigation begins');

            // --- SPLIT SCREEN ROUTE LINE REPLICATION ---
            if (this.indoorMiniMap) {
                if (this.indoorMiniMapLine) {
                    this.indoorMiniMap.removeLayer(this.indoorMiniMapLine);
                }

                this.indoorMiniMapLine = L.polyline(polylinePoints, {
                    color: '#8b5cf6', // Matches outdoor equivalent
                    weight: 6,
                    opacity: 0.9,
                    dashArray: '10, 10',
                    lineCap: 'round'
                }).addTo(this.indoorMiniMap);

                this.quadrantLayers = this.quadrantLayers || [];
                if (!this.quadrantLayers.includes(this.indoorMiniMapLine)) {
                    this.quadrantLayers.push(this.indoorMiniMapLine);
                }
            }

            // Store transition point for dynamic connection
            this.transitionPoint = transitionPoint;

            // Draw initial connection line from user position to transition point
            this.drawConnectionToTransition();
        }


        // Add destination marker
        const destIcon = L.divIcon({
            className: 'destination-marker',
            html: '📍',
            iconSize: [30, 30]
        });
        this.destinationMarker = L.marker([destination.lat, destination.lng], { icon: destIcon }).addTo(this.map);

        // --- REPLICATE FULL ROUTE ON SPLIT-SCREEN MINI-MAP ---
        if (this.indoorMiniMap) {
            this.quadrantLayers = this.quadrantLayers || [];

            // Draw outdoor route (blue) on mini-map
            const miniRoute = L.geoJSON(this.currentRoute.geometry, {
                style: {
                    color: COLORS.outdoor,
                    weight: 5,
                    opacity: 0.9,
                    lineCap: 'round',
                    lineJoin: 'round'
                }
            }).addTo(this.indoorMiniMap);
            this.quadrantLayers.push(miniRoute);

            // Add destination marker on mini-map
            const miniDest = L.marker([destination.lat, destination.lng], {
                icon: L.divIcon({
                    className: 'destination-marker',
                    html: '📍',
                    iconSize: [30, 30]
                })
            }).addTo(this.indoorMiniMap);
            this.quadrantLayers.push(miniDest);

            // Fit mini-map bounds to whole route
            this.indoorMiniMap.fitBounds(miniRoute.getBounds(), { padding: [30, 30] });
        }

        // Fit map to route bounds
        this.map.fitBounds(this.routeLine.getBounds(), { padding: [50, 50] });

        if (window.vxLog) {
            window.vxLog.navigation('Route displayed', {
                hasIndoorSegment,
                distance: this.currentRoute.distance
            });
        }
    }

    /**
     * Replicate existing route layers onto mini-map after it's initialized.
     * Called from app.js after initIndoorMiniMap since displayRoute runs before the mini-map exists.
     */
    replicateRouteToMiniMap() {
        if (!this.indoorMiniMap || !this.currentRoute) return;

        this.quadrantLayers = this.quadrantLayers || [];

        const COLORS = {
            outdoor: '#3b82f6',
            indoor: '#8b5cf6',
            transition: '#f59e0b'
        };

        // 1. Draw full outdoor route (blue)
        const miniRoute = L.geoJSON(this.currentRoute.geometry, {
            style: {
                color: COLORS.outdoor,
                weight: 5,
                opacity: 0.9,
                lineCap: 'round',
                lineJoin: 'round'
            }
        }).addTo(this.indoorMiniMap);
        this.quadrantLayers.push(miniRoute);

        // 2. Draw indoor segment (purple dashed) if it exists
        if (this.indoorLine) {
            const indoorLatLngs = this.indoorLine.getLatLngs();
            if (indoorLatLngs.length > 0) {
                this.indoorMiniMapLine = L.polyline(indoorLatLngs, {
                    color: COLORS.indoor,
                    weight: 6,
                    opacity: 0.9,
                    dashArray: '10, 10',
                    lineCap: 'round'
                }).addTo(this.indoorMiniMap);
                this.quadrantLayers.push(this.indoorMiniMapLine);
            }
        }

        // 3. Draw transition marker (orange dot) if it exists
        if (this.transitionPoint) {
            const tLatLng = [this.transitionPoint[1], this.transitionPoint[0]];
            this.indoorTransitionMarker = L.circleMarker(tLatLng, {
                radius: 8,
                color: COLORS.transition,
                fillColor: COLORS.transition,
                fillOpacity: 1,
                weight: 2
            }).addTo(this.indoorMiniMap);
            this.quadrantLayers.push(this.indoorTransitionMarker);
        }

        // 4. Draw destination marker
        if (this.destinationMarker) {
            const destLatLng = this.destinationMarker.getLatLng();
            const miniDest = L.marker([destLatLng.lat, destLatLng.lng], {
                icon: L.divIcon({
                    className: 'destination-marker',
                    html: '📍',
                    iconSize: [30, 30]
                })
            }).addTo(this.indoorMiniMap);
            this.quadrantLayers.push(miniDest);
        }

        // 5. Draw connection line from user to transition
        this.drawConnectionToTransition();

        // 6. Fit bounds to show entire route
        this.indoorMiniMap.fitBounds(miniRoute.getBounds(), { padding: [30, 30] });

        console.log('🗺️ Full route replicated to indoor mini-map');
    }

    /**
     * Draw connection line from user's current position to transition point
     * Works with or without GPS by using last known position or map center
     */
    drawConnectionToTransition() {
        if (!this.transitionPoint) return;

        // Get user position: currentMarker > startMarker > map center
        let userLatLng;
        if (this.currentMarker) {
            userLatLng = this.currentMarker.getLatLng();
        } else if (this.startMarker) {
            userLatLng = this.startMarker.getLatLng();
        } else if (this.map) {
            // Use map center as fallback (indoor with no GPS)
            userLatLng = this.map.getCenter();
        } else {
            return;
        }

        const transitionLatLng = [this.transitionPoint[1], this.transitionPoint[0]]; // [lng, lat] → [lat, lng]

        // --- MAIN MAP ---
        if (this.map) {
            // Clear existing connection
            if (this.connectionLine) {
                this.map.removeLayer(this.connectionLine);
            }

            // Draw dashed line from user to transition point (green for indoor path)
            this.connectionLine = L.polyline([
                [userLatLng.lat, userLatLng.lng],
                transitionLatLng
            ], {
                color: '#10b981', // Green for indoor segment
                weight: 5,
                opacity: 0.9,
                dashArray: '8, 12',
                lineCap: 'round'
            }).addTo(this.map);

            // Add user start marker if not present
            if (!this.currentMarker && !this.startMarker) {
                const userIcon = L.divIcon({
                    className: 'user-start-marker',
                    html: '🟢',
                    iconSize: [24, 24]
                });
                this.startMarker = L.marker([userLatLng.lat, userLatLng.lng], { icon: userIcon })
                    .addTo(this.map)
                    .bindPopup('📍 You are here (indoors)');
            }
        }

        // --- SPLIT-SCREEN MINI-MAP ---
        if (this.indoorMiniMap) {
            if (this.indoorConnectionLine) {
                this.indoorMiniMap.removeLayer(this.indoorConnectionLine);
            }

            this.indoorConnectionLine = L.polyline([
                [userLatLng.lat, userLatLng.lng],
                transitionLatLng
            ], {
                color: '#10b981', // Green for indoor segment
                weight: 5,
                opacity: 0.9,
                dashArray: '8, 12',
                lineCap: 'round'
            }).addTo(this.indoorMiniMap);

            // Ensure array exists
            this.quadrantLayers = this.quadrantLayers || [];

            // Track the line for cleanup
            if (!this.quadrantLayers.includes(this.indoorConnectionLine)) {
                this.quadrantLayers.push(this.indoorConnectionLine);
            }

            // Ensure transition marker is visible on mini-map
            if (!this.indoorTransitionMarker) {
                this.indoorTransitionMarker = L.circleMarker(transitionLatLng, {
                    radius: 8,
                    color: COLORS.transition,
                    fillColor: COLORS.transition,
                    fillOpacity: 1,
                    weight: 2
                }).addTo(this.indoorMiniMap);
                this.quadrantLayers.push(this.indoorTransitionMarker);
            } else {
                this.indoorTransitionMarker.setLatLng(transitionLatLng);
            }
        }

        console.log(`🔗 Connection line drawn: [${userLatLng.lat.toFixed(5)}, ${userLatLng.lng.toFixed(5)}] → transition point`);
    }

    /**
     * Start turn-by-turn navigation
     */
    startNavigation() {
        this.isNavigating = true;
        this.currentStepIndex = 0;
        console.log('🧭 Navigation started');
    }

    /**
     * Stop navigation
     */
    stopNavigation() {
        this.isNavigating = false;
        this.currentStepIndex = 0;

        if (this.routeLine) {
            this.map.removeLayer(this.routeLine);
            this.routeLine = null;
        }
        if (this.destinationMarker) {
            this.map.removeLayer(this.destinationMarker);
            this.destinationMarker = null;
        }
        if (this.connectionLine) {
            this.map.removeLayer(this.connectionLine);
            this.connectionLine = null;
        }
        this.transitionPoint = null;

        console.log('🧭 Navigation stopped');
    }

    /**
     * Get current navigation instruction
     */
    getNextInstruction() {
        if (!this.instructions.length) return null;
        return this.instructions[this.currentStepIndex] || null;
    }

    /**
     * Get direction emoji for maneuver
     */
    getDirectionEmoji(maneuver) {
        if (!maneuver) return '➡️';

        const modifier = maneuver.modifier || '';

        if (modifier.includes('left')) return '⬅️';
        if (modifier.includes('right')) return '➡️';
        if (modifier.includes('straight')) return '⬆️';
        if (maneuver.type === 'arrive') return '🏁';
        if (maneuver.type === 'depart') return '🚀';

        return '➡️';
    }

    /**
     * Format distance for display (in miles/feet for US users)
     */
    formatDistance(meters) {
        const feet = meters * 3.28084;
        const miles = meters / 1609.344;

        if (miles < 0.1) {
            // Less than 0.1 miles, show in feet
            return `${Math.round(feet)} ft`;
        } else if (miles < 10) {
            // Show one decimal for distances under 10 miles
            return `${miles.toFixed(1)} mi`;
        } else {
            // Round to whole number for longer distances
            return `${Math.round(miles)} mi`;
        }
    }

    /**
     * Format duration for display (calculated for walking at ~3 mph)
     * Walking speed: average 3 mph = 20 min per mile = 1.34 m/s
     */
    formatDuration(seconds, distanceMeters = null) {
        let mins;

        if (distanceMeters && this.transportMode === 'walking') {
            // Calculate walking time: 3 mph = 80.47 meters per minute
            const WALKING_SPEED_METERS_PER_MIN = 80.47;
            mins = Math.round(distanceMeters / WALKING_SPEED_METERS_PER_MIN);
        } else {
            // Use provided seconds (from routing API)
            mins = Math.round(seconds / 60);
        }

        if (mins < 1) {
            return '< 1 min';
        } else if (mins < 60) {
            return `${mins} min`;
        } else {
            const hours = Math.floor(mins / 60);
            const remainingMins = mins % 60;
            if (remainingMins === 0) {
                return `${hours} hr`;
            }
            return `${hours} hr ${remainingMins} min`;
        }
    }

    /**
     * Draw the current outdoor route on the indoor mini-map
     */
    drawOutdoorRouteOnMiniMap() {
        if (!this.indoorMiniMap || !this.routeLine) return;

        // Clear existing quadrant layers first to avoid clutter
        this.clearQuadrantOverlay();

        const latLngs = this.routeLine.getLatLngs();

        // Create a new polyline for the mini-map
        const routeLayer = L.polyline(latLngs, {
            color: '#3b82f6', // Blue for outdoor route
            weight: 5,
            opacity: 0.8,
            lineCap: 'round'
        }).addTo(this.indoorMiniMap);

        this.quadrantLayers.push(routeLayer);

        // Calculate dynamic bounds between user and the near transition point
        const pointsToFit = [];

        // Also draw current position marker (user position)
        if (this.currentMarker) {
            if (!this.indoorCurrentMarker) {
                this.indoorCurrentMarker = L.marker(this.currentMarker.getLatLng(), {
                    icon: this.currentMarker.options.icon
                }).addTo(this.indoorMiniMap);
                this.quadrantLayers.push(this.indoorCurrentMarker);
            } else {
                this.indoorCurrentMarker.setLatLng(this.currentMarker.getLatLng());
            }
            pointsToFit.push(this.currentMarker.getLatLng());
        } else if (this.startMarker) {
            pointsToFit.push(this.startMarker.getLatLng());
        }

        // Add the transition point (orange bubble) to the bound calculations
        if (this.transitionPoint) {
            pointsToFit.push(L.latLng(this.transitionPoint[1], this.transitionPoint[0]));
        } else if (this.destinationMarker) {
            pointsToFit.push(this.destinationMarker.getLatLng());
        }

        // And actual destination marker
        if (this.destinationMarker) {
            const marker = L.marker(this.destinationMarker.getLatLng(), {
                icon: this.destinationMarker.options.icon
            }).addTo(this.indoorMiniMap);
            this.quadrantLayers.push(marker);
        }

        // Fit bounds tightly to show the user's immediate vicinity and heading towards the door
        if (pointsToFit.length > 0) {
            const tightBounds = L.latLngBounds(pointsToFit);
            this.indoorMiniMap.fitBounds(tightBounds, {
                padding: [20, 20],
                maxZoom: 19 // Ensure tight zoom tracking user towards transition point
            });
        }
    }

    /**
     * Draw the indoor quadrant grid overlay on the mini-map
     * @param {IndoorPositioningService} posService - Positioning service with grid data
     */
    drawQuadrantGrid(posService) {
        const mapToUse = this.indoorMiniMap || this.map;
        if (!mapToUse || !posService) return;

        // Clear previous grid overlay
        this.clearQuadrantOverlay();

        const grid = posService.getGrid();
        const config = posService.getGridConfig();
        const anchor = posService.getAnchorPosition();
        if (!grid || !anchor) return;

        this.quadrantLayers = [];

        const metersPerDegreeLat = 111320;
        const metersPerDegreeLng = 111320 * Math.cos((anchor.lat * Math.PI) / 180);
        const cellSize = config.cellSize || 5;

        for (let r = 0; r < grid.length; r++) {
            for (let c = 0; c < grid[r].length; c++) {
                const q = grid[r][c];

                // Calculate GPS bounds for this cell
                const lat1 = anchor.lat + (r * cellSize) / metersPerDegreeLat;
                const lng1 = anchor.lng + (c * cellSize) / metersPerDegreeLng;
                const lat2 = anchor.lat + ((r + 1) * cellSize) / metersPerDegreeLat;
                const lng2 = anchor.lng + ((c + 1) * cellSize) / metersPerDegreeLng;

                /* 
                 * Grid lines/boxes hidden per user request suitable for cleaner UI
                 * Only drawing relevant items like the route and current position
                 */

                // Add label ONLY for POIs (hide generic hallways/rooms to reduce clutter)
                if (q.pois.length > 0) {
                    const centerLat = (lat1 + lat2) / 2;
                    const centerLng = (lng1 + lng2) / 2;
                    const emoji = this.getPoiEmoji(q.pois[0]);

                    // Only show simple icon for POIs, no text label background box
                    const labelIcon = L.divIcon({
                        className: 'quadrant-poi-marker',
                        html: `<span style="font-size:16px;">${emoji}</span>`,
                        iconSize: [20, 20]
                    });
                    const labelMarker = L.marker([centerLat, centerLng], { icon: labelIcon, interactive: false }).addTo(mapToUse);
                    this.quadrantLayers.push(labelMarker);
                }
            }
        }

        // Highlight current quadrant
        this.highlightCurrentQuadrant(posService);

        // Fit map to grid bounds
        const totalLat = anchor.lat + (grid.length * cellSize) / metersPerDegreeLat;
        const totalLng = anchor.lng + (grid[0].length * cellSize) / metersPerDegreeLng;
        mapToUse.fitBounds([[anchor.lat, anchor.lng], [totalLat, totalLng]], { padding: [20, 20] });

        console.log('🗺️ Quadrant grid drawn on mini-map');
    }

    /**
     * Highlight the user's current quadrant on the grid
     */
    highlightCurrentQuadrant(posService) {
        const mapToUse = this.indoorMiniMap || this.map;
        if (!mapToUse || !posService) return;

        // Remove previous highlight
        if (this.currentQuadrantHighlight) {
            mapToUse.removeLayer(this.currentQuadrantHighlight);
        }

        const anchor = posService.getAnchorPosition();
        const current = posService.getCurrentQuadrant();
        const config = posService.getGridConfig();
        if (!anchor || !config) return;

        const cellSize = config.cellSize || 5;
        const metersPerDegreeLat = 111320;
        const metersPerDegreeLng = 111320 * Math.cos((anchor.lat * Math.PI) / 180);

        const lat1 = anchor.lat + (current.row * cellSize) / metersPerDegreeLat;
        const lng1 = anchor.lng + (current.col * cellSize) / metersPerDegreeLng;
        const lat2 = anchor.lat + ((current.row + 1) * cellSize) / metersPerDegreeLat;
        const lng2 = anchor.lng + ((current.col + 1) * cellSize) / metersPerDegreeLng;

        this.currentQuadrantHighlight = L.rectangle([[lat1, lng1], [lat2, lng2]], {
            color: '#10b981',
            weight: 3,
            fillColor: '#10b981',
            fillOpacity: 0.3,
            dashArray: '6, 4'
        }).addTo(mapToUse);
    }

    /**
     * Draw the A*-computed quadrant route on the mini-map
     * @param {Array} route - Array of {row, col} from calculateRoute
     * @param {IndoorPositioningService} posService - For coordinate conversion
     */
    drawQuadrantRoute(route, posService) {
        const mapToUse = this.indoorMiniMap || this.map;
        if (!mapToUse || !route || !posService) return;

        // Clear previous route
        if (this.quadrantRouteLine) {
            mapToUse.removeLayer(this.quadrantRouteLine);
        }
        if (this.quadrantRouteMarkers) {
            this.quadrantRouteMarkers.forEach(m => mapToUse.removeLayer(m));
        }
        this.quadrantRouteMarkers = [];

        // Clear any stale transition logic since quadrant routes are purely indoor
        this.transitionPoint = null;
        if (this.connectionLine) {
            this.map?.removeLayer(this.connectionLine);
            this.connectionLine = null;
        }
        if (this.indoorConnectionLine) {
            this.indoorMiniMap?.removeLayer(this.indoorConnectionLine);
            this.indoorConnectionLine = null;
        }
        if (this.indoorTransitionMarker) {
            this.indoorMiniMap?.removeLayer(this.indoorTransitionMarker);
            this.indoorTransitionMarker = null;
        }

        const anchor = posService.getAnchorPosition();
        const config = posService.getGridConfig();
        if (!anchor || !config) return;

        const cellSize = config.cellSize || 5;
        const metersPerDegreeLat = 111320;
        const metersPerDegreeLng = 111320 * Math.cos((anchor.lat * Math.PI) / 180);

        // Convert route quadrants to GPS points (center of each cell)
        const points = route.map(wp => {
            const lat = anchor.lat + ((wp.row + 0.5) * cellSize) / metersPerDegreeLat;
            const lng = anchor.lng + ((wp.col + 0.5) * cellSize) / metersPerDegreeLng;
            return [lat, lng];
        });

        // Draw route line
        this.quadrantRouteLine = L.polyline(points, {
            color: '#f59e0b',
            weight: 4,
            opacity: 0.9,
            dashArray: '10, 6',
            lineCap: 'round'
        }).addTo(mapToUse);

        // Add destination marker at end of route
        if (points.length > 0) {
            const endPoint = points[points.length - 1];
            const grid = posService.getGrid();
            const endWp = route[route.length - 1];
            const endQ = grid[endWp.row][endWp.col];
            const emoji = endQ.pois.length > 0 ? this.getPoiEmoji(endQ.pois[0]) : '🎯';

            const destIcon = L.divIcon({
                className: 'quadrant-dest-marker',
                html: `<span style="font-size:22px;">${emoji}</span>`,
                iconSize: [28, 28]
            });
            const destMarker = L.marker(endPoint, { icon: destIcon }).addTo(mapToUse);
            this.quadrantRouteMarkers.push(destMarker);
        }
    }

    /**
     * Clear all quadrant grid overlay layers
     */
    clearQuadrantOverlay() {
        const mapToUse = this.indoorMiniMap || this.map;
        if (!mapToUse) return;

        if (this.quadrantLayers) {
            this.quadrantLayers.forEach(layer => mapToUse.removeLayer(layer));
            this.quadrantLayers = [];
        }
        if (this.currentQuadrantHighlight) {
            mapToUse.removeLayer(this.currentQuadrantHighlight);
            this.currentQuadrantHighlight = null;
        }
        if (this.quadrantRouteLine) {
            mapToUse.removeLayer(this.quadrantRouteLine);
            this.quadrantRouteLine = null;
        }
        if (this.indoorConnectionLine) {
            mapToUse.removeLayer(this.indoorConnectionLine);
            this.indoorConnectionLine = null;
        }
        if (this.indoorTransitionMarker) {
            mapToUse.removeLayer(this.indoorTransitionMarker);
            this.indoorTransitionMarker = null;
        }
        if (this.quadrantRouteMarkers) {
            this.quadrantRouteMarkers.forEach(m => mapToUse.removeLayer(m));
            this.quadrantRouteMarkers = [];
        }
    }

    /**
     * Get emoji for a POI type
     */
    getPoiEmoji(poiType) {
        const emojiMap = {
            'exit': '🚪', 'door': '🚪', 'elevator': '🛗', 'stairs': '🪜',
            'emergency_exit': '🆘', 'restroom': '🚻', 'signboard': '🪧',
            'cafe': '☕', 'office': '🏢'
        };
        return emojiMap[poiType] || '📍';
    }
}

// Add CSS for map markers
const markerStyles = document.createElement('style');
markerStyles.textContent = `
    .current-location-marker {
        position: relative;
    }
    
    .location-dot {
        width: 14px;
        height: 14px;
        background: #6366f1;
        border: 3px solid white;
        border-radius: 50%;
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        box-shadow: 0 0 10px rgba(99, 102, 241, 0.5);
    }
    
    .location-pulse {
        width: 30px;
        height: 30px;
        background: rgba(99, 102, 241, 0.3);
        border-radius: 50%;
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        animation: locationPulse 2s infinite;
    }
    
    @keyframes locationPulse {
        0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
    }
    
    .destination-marker {
        font-size: 24px;
        text-shadow: 0 2px 4px rgba(0,0,0,0.5);
    }
`;
document.head.appendChild(markerStyles);

// Export global instance
window.OutdoorNavigation = OutdoorNavigation;
