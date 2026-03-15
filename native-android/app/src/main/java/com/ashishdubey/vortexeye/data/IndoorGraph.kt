package com.ashishdubey.vortexeye.data

data class IndoorGraph(
    val id: String,
    val name: String,
    val floors: List<IndoorFloor>,
    val nodes: List<IndoorNode>,
    val edges: List<IndoorEdge>
)

data class IndoorFloor(
    val level: Int,
    val name: String
)

data class IndoorNode(
    val id: String,
    val label: String,
    val floor: Int,
    val xMeters: Double,
    val yMeters: Double,
    val lat: Double,
    val lng: Double,
    val tags: Set<String>,
    val accessible: Boolean
)

data class IndoorEdge(
    val fromNodeId: String,
    val toNodeId: String,
    val lengthMeters: Double,
    val bidirectional: Boolean,
    val edgeType: String,
    val accessible: Boolean,
    val congestionPenalty: Double
)
