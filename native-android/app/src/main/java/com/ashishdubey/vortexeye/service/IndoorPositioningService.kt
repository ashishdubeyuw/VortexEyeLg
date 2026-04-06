package com.ashishdubey.vortexeye.service

import com.ashishdubey.vortexeye.data.BuildingConfig
import com.ashishdubey.vortexeye.data.Cell
import java.util.PriorityQueue
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

data class Quadrant(val row: Int, val col: Int)

data class RouteResult(
    val label: String, val target: Quadrant, val route: List<Quadrant>,
    val pathLength: Int, val score: Float
)

class IndoorPositioningService {

    var anchorLat = 0.0; var anchorLng = 0.0
    var currentQuadrant = Quadrant(0, 0)
        private set
    var wheelchairMode = false
        private set

    private var config: BuildingConfig? = null
    private var grid: List<Cell> = emptyList()
    private var rows = 0; private var cols = 0; private var cellSize = 0
    private var currentRoute: List<Quadrant>? = null
    private var routeIdx = 0
    private var allCandidates: List<RouteResult> = emptyList()

    private val ekf = AntigravityEKF()
    private var meterX = 0f; private var meterY = 0f

    fun setWheelchairMode(on: Boolean) { wheelchairMode = on }

    fun initGrid(cfg: BuildingConfig) {
        config = cfg; grid = cfg.cells; rows = cfg.rows; cols = cfg.cols; cellSize = cfg.cellSize
        currentQuadrant = Quadrant(cfg.entryRow, cfg.entryCol)
        meterX = cfg.entryCol * cellSize.toFloat(); meterY = cfg.entryRow * cellSize.toFloat()

        val walkable = Array(rows) { r -> BooleanArray(cols) { c ->
            val cell = grid.firstOrNull { it.row == r && it.col == c }
            cell?.walkable == true && (!wheelchairMode || cell.accessible)
        }}
        ekf.init(rows, cols, cellSize, walkable)
    }

    fun setAnchor(lat: Double, lng: Double) {
        anchorLat = lat; anchorLng = lng; ekf.setAnchor(lat, lng)
    }

    fun updatePosition(steps: StepData, heading: Float) {
        ekf.updateHeading(heading)
        if (steps.stepCount > 0) ekf.predictStep(true, 0.5f)

        meterX = ekf.state.x; meterY = ekf.state.y
        val newQ = Quadrant(
            (meterY / cellSize).toInt().coerceIn(0, rows - 1),
            (meterX / cellSize).toInt().coerceIn(0, cols - 1)
        )
        if (newQ != currentQuadrant) {
            currentQuadrant = newQ
            checkRouteProgress()
        }
    }

    fun updateFromBluetooth(bx: Float, by: Float) {
        ekf.updateBLE(bx * cellSize, by * cellSize)
    }

    fun selectOptimalTarget(type: String): RouteResult? {
        val candidates = findCandidates(type)
        if (candidates.isEmpty()) return null

        val ranked = candidates.map { cell ->
            val to = Quadrant(cell.row, cell.col)
            val route = astar(currentQuadrant, to) ?: return@map null
            val dist = route.size.toFloat()
            val score = 100f / dist.coerceAtLeast(1f)
            RouteResult(cell.label, to, route, route.size, score)
        }.filterNotNull().sortedByDescending { it.score }

        allCandidates = ranked
        val best = ranked.firstOrNull() ?: return null
        currentRoute = best.route; routeIdx = 0
        return best
    }

    fun getAllCandidates() = allCandidates
    fun getCurrentRoute() = currentRoute

    fun getNextInstruction(): Pair<String, String> {
        val rt = currentRoute ?: return "📸" to "Point camera to scan for objects"
        if (routeIdx >= rt.size) return "🎯" to "You have arrived!"
        val next = rt[routeIdx]
        val dr = next.row - currentQuadrant.row
        val dc = next.col - currentQuadrant.col
        val dir = when {
            dr < 0 -> "⬆️" to "Go forward"
            dr > 0 -> "⬇️" to "Go backward"
            dc > 0 -> "➡️" to "Turn right"
            dc < 0 -> "⬅️" to "Turn left"
            else -> "📍" to "Continue straight"
        }
        val cell = grid.firstOrNull { it.row == next.row && it.col == next.col }
        return dir.first to "${dir.second} toward ${cell?.label ?: "next area"}"
    }

    private fun findCandidates(type: String): List<Cell> {
        return grid.filter { it.pois.contains(type) && it.walkable && (!wheelchairMode || it.accessible) }
    }

    private fun checkRouteProgress() {
        val rt = currentRoute ?: return
        val idx = rt.indexOfFirst { it == currentQuadrant }
        if (idx >= 0) routeIdx = idx + 1
    }

    fun astar(from: Quadrant, to: Quadrant): List<Quadrant>? {
        data class Node(val q: Quadrant, val g: Int, val f: Int, val parent: Node?)
        val heuristic = { a: Quadrant, b: Quadrant -> abs(a.row - b.row) + abs(a.col - b.col) }

        val open = PriorityQueue<Node>(compareBy { it.f })
        val closed = mutableSetOf<Pair<Int, Int>>()
        open.add(Node(from, 0, heuristic(from, to), null))

        while (open.isNotEmpty()) {
            val cur = open.poll()!!
            if (cur.q == to) {
                val path = mutableListOf<Quadrant>()
                var n: Node? = cur
                while (n != null) { path.add(0, n.q); n = n.parent }
                return path
            }
            val key = cur.q.row to cur.q.col
            if (key in closed) continue
            closed.add(key)

            val dirs = listOf(-1 to 0, 1 to 0, 0 to -1, 0 to 1)
            for ((dr, dc) in dirs) {
                val nr = cur.q.row + dr; val nc = cur.q.col + dc
                if (nr !in 0 until rows || nc !in 0 until cols) continue
                if ((nr to nc) in closed) continue
                val cell = grid.firstOrNull { it.row == nr && it.col == nc } ?: continue
                if (!cell.walkable || (wheelchairMode && !cell.accessible)) continue
                val ng = cur.g + 1
                open.add(Node(Quadrant(nr, nc), ng, ng + heuristic(Quadrant(nr, nc), to), cur))
            }
        }
        return null
    }

    fun ekf() = ekf
    fun getGrid() = grid
    fun getConfig() = config
}
