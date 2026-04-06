package com.ashishdubey.vortexeye.service

import android.content.Context
import com.ashishdubey.vortexeye.data.IndoorEdge
import com.ashishdubey.vortexeye.data.IndoorFloor
import com.ashishdubey.vortexeye.data.IndoorGraph
import com.ashishdubey.vortexeye.data.IndoorNode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

interface IndoorGraphRepository {
    suspend fun loadGraph(graphId: String = "demo"): IndoorGraph?
    fun getCachedGraph(): IndoorGraph?
}

class AssetIndoorGraphRepository(
    private val ctx: Context,
    private val defaultAssetName: String = "indoor_graph_demo.json"
) : IndoorGraphRepository {

    @Volatile
    private var cached: IndoorGraph? = null

    override suspend fun loadGraph(graphId: String): IndoorGraph? = withContext(Dispatchers.IO) {
        cached?.let { return@withContext it }
        return@withContext try {
            val assetName = if (graphId == "demo") defaultAssetName else "indoor_graph_${graphId}.json"
            val json = ctx.assets.open(assetName).bufferedReader().use { it.readText() }
            val graph = parseGraph(JSONObject(json))
            cached = graph
            graph
        } catch (_: Exception) {
            null
        }
    }

    override fun getCachedGraph(): IndoorGraph? = cached

    private fun parseGraph(root: JSONObject): IndoorGraph {
        val floorsJson = root.getJSONArray("floors")
        val floors = buildList {
            for (i in 0 until floorsJson.length()) {
                val fl = floorsJson.getJSONObject(i)
                add(
                    IndoorFloor(
                        level = fl.getInt("level"),
                        name = fl.optString("name", "F${fl.getInt("level")}")
                    )
                )
            }
        }

        val nodesJson = root.getJSONArray("nodes")
        val nodes = buildList {
            for (i in 0 until nodesJson.length()) {
                val nd = nodesJson.getJSONObject(i)
                val tagsJson = nd.optJSONArray("tags")
                val tags = buildSet {
                    if (tagsJson != null) {
                        for (j in 0 until tagsJson.length()) add(tagsJson.getString(j))
                    }
                }
                add(
                    IndoorNode(
                        id = nd.getString("id"),
                        label = nd.optString("label", nd.getString("id")),
                        floor = nd.getInt("floor"),
                        xMeters = nd.optDouble("x", 0.0),
                        yMeters = nd.optDouble("y", 0.0),
                        lat = nd.getDouble("lat"),
                        lng = nd.getDouble("lng"),
                        tags = tags,
                        accessible = nd.optBoolean("accessible", true)
                    )
                )
            }
        }

        val edgesJson = root.getJSONArray("edges")
        val edges = buildList {
            for (i in 0 until edgesJson.length()) {
                val ed = edgesJson.getJSONObject(i)
                add(
                    IndoorEdge(
                        fromNodeId = ed.getString("from"),
                        toNodeId = ed.getString("to"),
                        lengthMeters = ed.optDouble("length", 1.0),
                        bidirectional = ed.optBoolean("bidirectional", true),
                        edgeType = ed.optString("type", "corridor"),
                        accessible = ed.optBoolean("accessible", true),
                        congestionPenalty = ed.optDouble("congestionPenalty", 0.0)
                    )
                )
            }
        }

        return IndoorGraph(
            id = root.optString("id", "demo"),
            name = root.optString("name", "Indoor Graph"),
            floors = floors,
            nodes = nodes,
            edges = edges
        )
    }
}
