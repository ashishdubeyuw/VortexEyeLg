package com.ashishdubey.vortexeye.service

import com.ashishdubey.vortexeye.data.IndoorEdge
import com.ashishdubey.vortexeye.data.IndoorGraph
import com.ashishdubey.vortexeye.data.IndoorNode
import java.util.PriorityQueue
import kotlin.math.hypot

data class IndoorRoute(
    val targetLabel: String,
    val nodePath: List<IndoorNode>,
    val geometry: List<GeoPoint>,
    val distanceMeters: Double,
    val instructions: List<String>
)

class IndoorGraphRouter {

    fun routeToPoi(
        graph: IndoorGraph,
        floor: Int,
        xMeters: Double,
        yMeters: Double,
        targetTag: String,
        wheelchairMode: Boolean = false
    ): IndoorRoute? {
        val start = nearestNode(graph, floor, xMeters, yMeters, wheelchairMode) ?: return null
        val candidates = graph.nodes.filter {
            it.tags.contains(targetTag) && (!wheelchairMode || it.accessible)
        }
        if (candidates.isEmpty()) return null

        var bestRoute: List<IndoorNode>? = null
        var bestDist = Double.MAX_VALUE
        var bestTarget: IndoorNode? = null

        for (target in candidates) {
            val path = shortestPath(graph, start.id, target.id, wheelchairMode) ?: continue
            val dist = pathDistance(path)
            if (dist < bestDist) {
                bestDist = dist
                bestRoute = path
                bestTarget = target
            }
        }

        val finalPath = bestRoute ?: return null
        val targetNode = bestTarget ?: return null
        return IndoorRoute(
            targetLabel = targetNode.label,
            nodePath = finalPath,
            geometry = finalPath.map { GeoPoint(it.lat, it.lng) },
            distanceMeters = bestDist,
            instructions = buildInstructions(finalPath)
        )
    }

    private fun nearestNode(
        graph: IndoorGraph,
        floor: Int,
        xMeters: Double,
        yMeters: Double,
        wheelchairMode: Boolean
    ): IndoorNode? {
        val nodes = graph.nodes.filter { it.floor == floor && (!wheelchairMode || it.accessible) }
        return nodes.minByOrNull { hypot(it.xMeters - xMeters, it.yMeters - yMeters) }
    }

    private fun shortestPath(
        graph: IndoorGraph,
        startNodeId: String,
        endNodeId: String,
        wheelchairMode: Boolean
    ): List<IndoorNode>? {
        data class State(val nodeId: String, val cost: Double)

        val nodeById = graph.nodes.associateBy { it.id }
        val adjacency = buildAdjacency(graph.edges, wheelchairMode)

        val dist = mutableMapOf<String, Double>().withDefault { Double.MAX_VALUE }
        val prev = mutableMapOf<String, String?>()
        val pq = PriorityQueue<State>(compareBy { it.cost })

        dist[startNodeId] = 0.0
        prev[startNodeId] = null
        pq.add(State(startNodeId, 0.0))

        while (pq.isNotEmpty()) {
            val cur = pq.poll() ?: break
            if (cur.nodeId == endNodeId) break
            if (cur.cost > dist.getValue(cur.nodeId)) continue

            val edges = adjacency[cur.nodeId] ?: emptyList()
            for ((nextNodeId, edgeCost) in edges) {
                val nextCost = cur.cost + edgeCost
                if (nextCost < dist.getValue(nextNodeId)) {
                    dist[nextNodeId] = nextCost
                    prev[nextNodeId] = cur.nodeId
                    pq.add(State(nextNodeId, nextCost))
                }
            }
        }

        if (!dist.containsKey(endNodeId)) return null
        val pathIds = mutableListOf<String>()
        var cursor: String? = endNodeId
        while (cursor != null) {
            pathIds.add(cursor)
            cursor = prev[cursor]
        }
        pathIds.reverse()
        return pathIds.mapNotNull { nodeById[it] }
    }

    private fun buildAdjacency(
        edges: List<IndoorEdge>,
        wheelchairMode: Boolean
    ): Map<String, List<Pair<String, Double>>> {
        val result = mutableMapOf<String, MutableList<Pair<String, Double>>>()
        fun add(from: String, to: String, cost: Double) {
            result.getOrPut(from) { mutableListOf() }.add(to to cost)
        }

        for (edge in edges) {
            if (wheelchairMode && !edge.accessible) continue
            val edgePenalty = when (edge.edgeType) {
                "stairs" -> if (wheelchairMode) Double.MAX_VALUE else 8.0
                "elevator" -> 2.0
                else -> 0.0
            }
            val cost = edge.lengthMeters + edge.congestionPenalty + edgePenalty
            if (cost.isFinite()) {
                add(edge.fromNodeId, edge.toNodeId, cost)
                if (edge.bidirectional) add(edge.toNodeId, edge.fromNodeId, cost)
            }
        }
        return result
    }

    private fun pathDistance(path: List<IndoorNode>): Double {
        if (path.size <= 1) return 0.0
        var distance = 0.0
        for (i in 1 until path.size) {
            val a = path[i - 1]
            val b = path[i]
            distance += hypot(a.xMeters - b.xMeters, a.yMeters - b.yMeters)
        }
        return distance
    }

    private fun buildInstructions(path: List<IndoorNode>): List<String> {
        if (path.size < 2) return listOf("You are at the destination.")
        val instructions = mutableListOf<String>()
        for (i in 1 until path.size) {
            val next = path[i]
            val prev = path[i - 1]
            instructions.add("Proceed to ${next.label} on floor ${next.floor + 1}.")
            if (next.floor != prev.floor) {
                instructions.add("Transition to floor ${next.floor + 1}.")
            }
        }
        instructions.add("You have arrived at ${path.last().label}.")
        return instructions
    }
}
