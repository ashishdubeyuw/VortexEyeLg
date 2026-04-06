package com.ashishdubey.vortexeye.service

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class OfflinePackManager(private val ctx: Context) {

    private val rootDir: File by lazy {
        File(ctx.filesDir, "offline_packs").apply { mkdirs() }
    }

    suspend fun cacheIndoorGraphJson(graphId: String, jsonPayload: String): Boolean = withContext(Dispatchers.IO) {
        return@withContext try {
            File(rootDir, "indoor_graph_$graphId.json").writeText(jsonPayload)
            true
        } catch (_: Exception) {
            false
        }
    }

    suspend fun getIndoorGraphJson(graphId: String): String? = withContext(Dispatchers.IO) {
        val file = File(rootDir, "indoor_graph_$graphId.json")
        if (!file.exists()) return@withContext null
        return@withContext try {
            file.readText()
        } catch (_: Exception) {
            null
        }
    }

    suspend fun cacheLastOutdoorRoute(destination: String, route: RouteInfo): Boolean = withContext(Dispatchers.IO) {
        val json = JSONObject().apply {
            put("destination", destination)
            put("distance", route.distance)
            put("duration", route.duration)
            put("geometry", JSONArray().apply {
                route.geometry.forEach { point ->
                    put(JSONObject().apply {
                        put("lat", point.lat)
                        put("lng", point.lng)
                    })
                }
            })
            put("steps", JSONArray().apply {
                route.steps.forEach { step ->
                    put(JSONObject().apply {
                        put("instruction", step.instruction)
                        put("distance", step.distance)
                        put("duration", step.duration)
                        put("maneuver", step.maneuver)
                    })
                }
            })
        }
        return@withContext try {
            File(rootDir, "last_outdoor_route.json").writeText(json.toString())
            true
        } catch (_: Exception) {
            false
        }
    }

    suspend fun hasOfflineData(): Boolean = withContext(Dispatchers.IO) {
        rootDir.exists() && (rootDir.listFiles()?.isNotEmpty() == true)
    }
}
