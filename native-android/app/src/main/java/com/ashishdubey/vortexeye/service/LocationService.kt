package com.ashishdubey.vortexeye.service

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.GnssMeasurementsEvent
import android.location.Location
import android.location.LocationManager
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.location.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

data class VxPosition(
    val lat: Double,
    val lng: Double,
    val accuracy: Float,
    val altitude: Double?,
    val heading: Float?,
    val speed: Float?,
    val ts: Long
)

data class GeoPolygon(val id: Long, val isBuilding: Boolean, val isRoad: Boolean, val points: List<VxPosition>)

enum class NavMode { INDOOR, OUTDOOR }

enum class NavState { IDLE, EGRESS, OUTDOOR_NAV, INDOOR_NAV, INGRESS }

class LocationService(private val ctx: Context) {

    private val fusedClient: FusedLocationProviderClient =
        LocationServices.getFusedLocationProviderClient(ctx)

    private val _pos = MutableStateFlow<VxPosition?>(null)
    val position: StateFlow<VxPosition?> = _pos

    private val _mode = MutableStateFlow(NavMode.OUTDOOR)
    val mode: StateFlow<NavMode> = _mode

    var navState = NavState.IDLE
    var indoorAnchor: VxPosition? = null
        private set

    private val GPS_STRONG = 10f
    private val GPS_LOST = 50f

    private var lockedMode: NavMode? = null
    private var callback: LocationCallback? = null
    
    private val locationManager = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private var gnssCallback: GnssMeasurementsEvent.Callback? = null

    // For debouncing mode switches
    private var lastModeChangeTime = 0L
    private val MODE_DEBOUNCE_MS = 3000L // 3 seconds before allowing another switch
    
    // Multiple Overpass API servers for failover
    private val OVERPASS_SERVERS = listOf(
        "https://overpass.kumi.systems/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
        "https://overpass-api.de/api/interpreter"
    )

    @android.annotation.SuppressLint("MissingPermission")
    fun start() {
        val hasFine = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val hasCoarse = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!hasFine && !hasCoarse) return

        callback?.let { fusedClient.removeLocationUpdates(it) }

        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 2000)
            .setMinUpdateIntervalMillis(1000)
            .build()

        callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { handle(it) }
            }
        }
        fusedClient.requestLocationUpdates(req, callback!!, Looper.getMainLooper())

        gnssCallback = object : GnssMeasurementsEvent.Callback() {
            override fun onGnssMeasurementsReceived(event: GnssMeasurementsEvent) {
                var strongSats = 0
                for (m in event.measurements) {
                    if (m.cn0DbHz > 25.0) strongSats++
                }
                
                // Pure GNSS Heuristic: If we have NO satellites above 25 DbHz,
                // it is mathematically proven we are under heavy roof attenuation (deep indoor).
                if (event.measurements.isNotEmpty() && strongSats == 0) {
                    if (lockedMode == null && (System.currentTimeMillis() - lastModeChangeTime > MODE_DEBOUNCE_MS)) {
                        _mode.value = NavMode.INDOOR
                        lastModeChangeTime = System.currentTimeMillis()
                    }
                }
            }
        }
        locationManager.registerGnssMeasurementsCallback(ContextCompat.getMainExecutor(ctx), gnssCallback!!)

        fusedClient.lastLocation.addOnSuccessListener { loc ->
            if (loc != null && _pos.value == null) handle(loc)
        }
    }

    fun stop() {
        callback?.let { fusedClient.removeLocationUpdates(it) }
        gnssCallback?.let { locationManager.unregisterGnssMeasurementsCallback(it) }
    }

    private fun handle(loc: Location) {
        val p = VxPosition(
            lat = loc.latitude,
            lng = loc.longitude,
            accuracy = loc.accuracy,
            altitude = if (loc.hasAltitude()) loc.altitude else null,
            heading = if (loc.hasBearing()) loc.bearing else null,
            speed = if (loc.hasSpeed()) loc.speed else null,
            ts = loc.time
        )
        _pos.value = p

        val now = System.currentTimeMillis()

        // Determine proposed new mode based on highly sticky hysteresis
        val proposedMode = if (_mode.value == NavMode.INDOOR) {
            // HYSTERESIS: If we are INDOOR, violently resist switching to OUTDOOR unless we clearly break out
            if (loc.accuracy < GPS_STRONG && onRoad) {
                NavMode.OUTDOOR // We are clearly walking outside
            } else if (loc.accuracy < 6f && !insideBuilding) {
                NavMode.OUTDOOR // Extreme precision outside building bounds
            } else {
                NavMode.INDOOR // Stick to indoor
            }
        } else {
            // We are OUTDOOR right now. Switch to INDOOR only if signal dies or known to be inside a building without roads
            if (loc.accuracy > GPS_LOST) {
                NavMode.INDOOR
            } else if (!onRoad && insideBuilding) {
                NavMode.INDOOR
            } else {
                NavMode.OUTDOOR
            }
        }

        // Only apply if we have a locked mode, or if enough time has passed (debounce)
        val newMode = lockedMode ?: if (proposedMode != _mode.value && (now - lastModeChangeTime > MODE_DEBOUNCE_MS)) {
            proposedMode
        } else {
            _mode.value
        }

        if (newMode != _mode.value) {
            if (newMode == NavMode.INDOOR && _mode.value == NavMode.OUTDOOR) {
                indoorAnchor = p
            }
            _mode.value = newMode
            lastModeChangeTime = now
        }
    }

    fun forceMode(m: NavMode) { 
        lockedMode = m
        if (_mode.value != m) {
            _mode.value = m
            lastModeChangeTime = System.currentTimeMillis()
        }
    }
    fun unlockMode() { lockedMode = null }
    fun heading(): Float = _pos.value?.heading ?: 0f

    fun signalPercent(): Int {
        val acc = _pos.value?.accuracy ?: return 0
        return (100 - (acc / 100f) * 100).toInt().coerceIn(0, 100)
    }

    var insideBuilding = false
        private set
    var onRoad = false
        private set

    private val cachedPolygons = mutableListOf<GeoPolygon>()
    private var lastBoundingBoxQueryCenter: VxPosition? = null

    suspend fun checkEnvironment(lat: Double, lng: Double): Pair<Boolean, Boolean> {
        val now = System.currentTimeMillis()
        val c = lastBoundingBoxQueryCenter
        val distToCenter = if (c != null) distanceMeters(lat, lng, c.lat, c.lng) else Float.MAX_VALUE

        // Fetch spatial data ONCE if cache is empty or we moved more than 300 meters from the last bounding box center
        if (cachedPolygons.isEmpty() || distToCenter > 300f) {
            fetchSpatialData(lat, lng)
        }

        // Pure offline mathematical check (< 1ms) without waking the cellular radio
        var foundInside = false
        var foundRoad = false

        for (poly in cachedPolygons) {
            if (poly.isBuilding && isPointInPolygon(lat, lng, poly)) {
                foundInside = true
            }
            if (poly.isRoad && isNearRoad(lat, lng, poly)) {
                foundRoad = true
            }
            if (foundInside && foundRoad) break
        }

        insideBuilding = foundInside
        onRoad = foundRoad

        if (insideBuilding && !onRoad && lockedMode == null && (now - lastModeChangeTime > MODE_DEBOUNCE_MS)) {
            _mode.value = NavMode.INDOOR
            lastModeChangeTime = now
        } else if (onRoad && !insideBuilding && lockedMode == null && (now - lastModeChangeTime > MODE_DEBOUNCE_MS)) {
            _mode.value = NavMode.OUTDOOR
            lastModeChangeTime = now
        }

        return Pair(insideBuilding, onRoad)
    }

    private suspend fun fetchSpatialData(lat: Double, lng: Double) {
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            // Request coordinate geometry for ways within 500m radius
            val q = """[out:json][timeout:10];(
                way[building](around:500,$lat,$lng);
                way[highway](around:500,$lat,$lng);
            );out geom;"""
            
            for (server in OVERPASS_SERVERS) {
                try {
                    val url = java.net.URL(server)
                    val conn = url.openConnection() as java.net.HttpURLConnection
                    conn.requestMethod = "POST"
                    conn.connectTimeout = 5000; conn.readTimeout = 5000
                    conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                    conn.doOutput = true
                    java.io.OutputStreamWriter(conn.outputStream).use {
                     it.write("data=${java.net.URLEncoder.encode(q, "UTF-8")}")
                    }
                    
                    if (conn.responseCode == 200) {
                        val body = conn.inputStream.bufferedReader().readText()
                        val json = org.json.JSONObject(body)
                        val elements = json.optJSONArray("elements") ?: continue
                        
                        val newPolys = mutableListOf<GeoPolygon>()
                        for (i in 0 until elements.length()) {
                            val el = elements.getJSONObject(i)
                            val tags = el.optJSONObject("tags") ?: continue
                            val isBuilding = tags.has("building")
                            val isRoad = tags.has("highway")
                            
                            val geometry = el.optJSONArray("geometry") ?: continue
                            val pts = mutableListOf<VxPosition>()
                            for (j in 0 until geometry.length()) {
                                val pt = geometry.getJSONObject(j)
                                pts.add(VxPosition(pt.getDouble("lat"), pt.getDouble("lon"), 0f, null, null, null, 0))
                            }
                            if (pts.isNotEmpty()) {
                                newPolys.add(GeoPolygon(el.optLong("id"), isBuilding, isRoad, pts))
                            }
                        }
                        cachedPolygons.clear()
                        cachedPolygons.addAll(newPolys)
                        lastBoundingBoxQueryCenter = VxPosition(lat, lng, 0f, null, null, null, 0)
                        break 
                    }
                } catch (e: Exception) { continue }
            }
        }
    }

    private fun isPointInPolygon(lat: Double, lng: Double, polygon: GeoPolygon): Boolean {
        var inside = false
        var j = polygon.points.size - 1
        for (i in polygon.points.indices) {
            val pi = polygon.points[i]
            val pj = polygon.points[j]
            if (((pi.lng > lng) != (pj.lng > lng)) &&
                (lat < (pj.lat - pi.lat) * (lng - pi.lng) / (pj.lng - pi.lng) + pi.lat)) {
                inside = !inside
            }
            j = i
        }
        return inside
    }

    private fun distanceMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Float {
        val results = FloatArray(1)
        Location.distanceBetween(lat1, lon1, lat2, lon2, results)
        return results[0]
    }

    private fun distanceToLineSegment(px: Double, py: Double, ax: Double, ay: Double, bx: Double, by: Double): Double {
        val l2 = Math.pow(ax - bx, 2.0) + Math.pow(ay - by, 2.0)
        if (l2 == 0.0) return distanceMeters(px, py, ax, ay).toDouble()
        var t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2
        t = Math.max(0.0, Math.min(1.0, t))
        val projX = ax + t * (bx - ax)
        val projY = ay + t * (by - ay)
        return distanceMeters(px, py, projX, projY).toDouble()
    }

    private fun isNearRoad(lat: Double, lng: Double, polygon: GeoPolygon): Boolean {
        for (i in 0 until polygon.points.size - 1) {
            val p1 = polygon.points[i]
            val p2 = polygon.points[i+1]
            val d = distanceToLineSegment(lat, lng, p1.lat, p1.lng, p2.lat, p2.lng)
            if (d < 15.0) return true // within 15 meters of road centerline
        }
        return false
    }
}

