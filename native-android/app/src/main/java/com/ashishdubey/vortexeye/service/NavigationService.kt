package com.ashishdubey.vortexeye.service

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.math.*

data class GeoPoint(val lat: Double, val lng: Double, val name: String = "")

data class RouteInfo(
    val distance: Double, val duration: Double,
    val steps: List<RouteStep>, val geometry: List<GeoPoint>
)

data class RouteStep(
    val instruction: String, val distance: Double,
    val duration: Double, val maneuver: String
)

class NavigationService {

    private val OSRM_FOOT = "https://router.project-osrm.org/route/v1/foot"
    private val NOMINATIM = "https://nominatim.openstreetmap.org/search"
    private val OVERPASS_SERVERS = listOf(
        "https://overpass.kumi.systems/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
        "https://overpass-api.de/api/interpreter"
    )

    data class PoiTag(val key: String, val value: String, val brand: String? = null)

    private val POI_MAP = mapOf(
        "starbucks" to PoiTag("amenity", "cafe", "Starbucks"),
        "coffee" to PoiTag("amenity", "cafe"),
        "cafe" to PoiTag("amenity", "cafe"),
        "restaurant" to PoiTag("amenity", "restaurant"),
        "food" to PoiTag("amenity", "restaurant"),
        "gas" to PoiTag("amenity", "fuel"),
        "gas station" to PoiTag("amenity", "fuel"),
        "pharmacy" to PoiTag("amenity", "pharmacy"),
        "hospital" to PoiTag("amenity", "hospital"),
        "bank" to PoiTag("amenity", "bank"),
        "atm" to PoiTag("amenity", "atm"),
        "parking" to PoiTag("amenity", "parking"),
        "hotel" to PoiTag("tourism", "hotel"),
        "bus stop" to PoiTag("highway", "bus_stop"),
        "bus" to PoiTag("highway", "bus_stop"),
        "subway" to PoiTag("railway", "station"),
        "train" to PoiTag("railway", "station"),
        "supermarket" to PoiTag("shop", "supermarket"),
        "grocery" to PoiTag("shop", "supermarket"),
        "mall" to PoiTag("shop", "mall"),
        "park" to PoiTag("leisure", "park")
    )

    suspend fun searchNearbyPOI(query: String, pos: GeoPoint, radius: Int = 3000): GeoPoint? = withContext(Dispatchers.IO) {
        val qLower = query.lowercase()
        var tag: PoiTag? = null

        for ((keyword, poiTag) in POI_MAP) {
            if (qLower.contains(keyword)) { tag = poiTag; break }
        }
        if (tag == null) return@withContext null

        // Progressive radius: try closer first
        val radii = listOf(500, 1500, 3000)
        for (searchRadius in radii) {
            val oq = if (tag.brand != null) {
                """[out:json][timeout:5];(node["brand"="${tag.brand}"](around:$searchRadius,${pos.lat},${pos.lng});way["brand"="${tag.brand}"](around:$searchRadius,${pos.lat},${pos.lng}););out center;"""
            } else {
                """[out:json][timeout:5];(node["${tag.key}"="${tag.value}"](around:$searchRadius,${pos.lat},${pos.lng});way["${tag.key}"="${tag.value}"](around:$searchRadius,${pos.lat},${pos.lng}););out center;"""
            }

            for (server in OVERPASS_SERVERS) {
                try {
                    val conn = URL(server).openConnection() as HttpURLConnection
                    conn.requestMethod = "POST"
                    conn.connectTimeout = 6000; conn.readTimeout = 6000
                    conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                    conn.doOutput = true
                    OutputStreamWriter(conn.outputStream).use { it.write("data=${URLEncoder.encode(oq, "UTF-8")}") }

                    if (conn.responseCode != 200) continue
                    val body = conn.inputStream.bufferedReader().readText()
                    val data = JSONObject(body)
                    val elements = data.optJSONArray("elements") ?: continue
                    if (elements.length() == 0) break // no results at this radius, expand

                    var closest: GeoPoint? = null; var minDist = Double.MAX_VALUE
                    for (i in 0 until elements.length()) {
                        val el = elements.getJSONObject(i)
                        val lat: Double
                        val lng: Double
                        if (el.has("lat")) {
                            lat = el.getDouble("lat"); lng = el.getDouble("lon")
                        } else {
                            val ctr = el.optJSONObject("center") ?: continue
                            lat = ctr.getDouble("lat"); lng = ctr.getDouble("lon")
                        }
                        val tags = el.optJSONObject("tags")
                        val name = tags?.optString("name", "") ?: ""
                        val brand = tags?.optString("brand", "") ?: ""
                        val displayName = name.ifBlank { brand.ifBlank { query } }
                        val d = haversine(pos.lat, pos.lng, lat, lng)
                        if (d < minDist) {
                            minDist = d
                            val distTxt = if (d < 1000) "${d.toInt()}m" else "%.1fkm".format(d / 1000)
                            closest = GeoPoint(lat, lng, "$displayName ($distTxt away)")
                        }
                    }
                    if (closest != null) return@withContext closest
                } catch (_: Exception) { continue }
            }
        }
        null
    }

    suspend fun geocode(query: String, bias: GeoPoint? = null): GeoPoint? = withContext(Dispatchers.IO) {
        try {
            if (bias != null) {
                val poi = searchNearbyPOI(query, bias)
                if (poi != null) return@withContext poi
            }

            val enc = URLEncoder.encode(query, "UTF-8")
            val vp = if (bias != null) "&viewbox=${bias.lng-0.5},${bias.lat+0.5},${bias.lng+0.5},${bias.lat-0.5}&bounded=1" else ""
            val url = "$NOMINATIM?q=$enc&format=json&limit=50&addressdetails=1$vp"
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.setRequestProperty("User-Agent", "VortexEye/1.0")
            conn.connectTimeout = 10000; conn.readTimeout = 10000
            val json = conn.inputStream.bufferedReader().readText()
            val arr = JSONArray(json)
            if (arr.length() == 0) return@withContext null

            if (bias != null) {
                var best: JSONObject? = null; var bestDist = Double.MAX_VALUE
                for (i in 0 until arr.length()) {
                    val obj = arr.getJSONObject(i)
                    val lat = obj.getDouble("lat"); val lng = obj.getDouble("lon")
                    val d = haversine(bias.lat, bias.lng, lat, lng)
                    if (d < bestDist && d < 50000) { bestDist = d; best = obj }
                }
                if (best != null) {
                    return@withContext GeoPoint(best.getDouble("lat"), best.getDouble("lon"), best.optString("display_name", query))
                }
            }

            val obj = arr.getJSONObject(0)
            GeoPoint(obj.getDouble("lat"), obj.getDouble("lon"), obj.optString("display_name", query))
        } catch (_: Exception) { null }
    }

    suspend fun getRoute(from: GeoPoint, to: GeoPoint): RouteInfo? = withContext(Dispatchers.IO) {
        try {
            val url = "$OSRM_FOOT/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true"
            val json = JSONObject(URL(url).readText())
            val routes = json.getJSONArray("routes")
            if (routes.length() == 0) return@withContext null
            val r = routes.getJSONObject(0)
            val leg = r.getJSONArray("legs").getJSONObject(0)

            val stepsArr = leg.getJSONArray("steps")
            val stepList = mutableListOf<RouteStep>()
            for (i in 0 until stepsArr.length()) {
                val s = stepsArr.getJSONObject(i)
                val m = s.getJSONObject("maneuver")
                stepList.add(RouteStep(
                    instruction = fmtInstr(s), distance = s.getDouble("distance"),
                    duration = s.getDouble("duration"), maneuver = m.optString("type", "")
                ))
            }

            val geom = r.getJSONObject("geometry").getJSONArray("coordinates")
            val pts = mutableListOf<GeoPoint>()
            for (i in 0 until geom.length()) {
                val c = geom.getJSONArray(i)
                pts.add(GeoPoint(c.getDouble(1), c.getDouble(0)))
            }

            RouteInfo(r.getDouble("distance"), r.getDouble("duration"), stepList, pts)
        } catch (_: Exception) { null }
    }

    private fun fmtInstr(step: JSONObject): String {
        val m = step.getJSONObject("maneuver")
        val type = m.optString("type", ""); val mod = m.optString("modifier", "")
        val name = step.optString("name", ""); val road = if (name.isNotBlank()) " onto $name" else ""
        return when (type) {
            "turn" -> "Turn $mod$road"; "depart" -> "Head $mod$road"
            "arrive" -> "Arrive at destination"; "continue" -> "Continue$road"
            else -> "${type.replaceFirstChar { it.uppercase() }} $mod$road"
        }.trim()
    }

    fun formatDistance(meters: Double): String {
        val miles = meters / 1609.34
        return if (miles < 0.1) "${(meters * 3.281).toInt()} ft" else "%.1f mi".format(miles)
    }

    fun formatDuration(seconds: Double, meters: Double): String {
        val walkMin = (meters / 83.33).toInt()
        return if (walkMin < 1) "< 1 min" else "$walkMin min"
    }

    fun haversine(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 6371000.0
        val dLat = Math.toRadians(lat2 - lat1); val dLon = Math.toRadians(lon2 - lon1)
        val a = sin(dLat / 2).pow(2) + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2).pow(2)
        return r * 2 * atan2(sqrt(a), sqrt(1 - a))
    }
}
