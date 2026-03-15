package com.ashishdubey.vortexeye.service

import kotlin.math.*

data class EkfState(
    var x: Float = 0f, var y: Float = 0f, var z: Float = 0f,
    var vx: Float = 0f, var vy: Float = 0f, var vz: Float = 0f,
    var yaw: Float = 0f
)

class AntigravityEKF {

    val state = EkfState()
    var isInit = false
        private set

    private var px = 1f; private var py = 1f; private var pz = 1f
    private var pYaw = 0.5f
    private val stepLen = 0.75f
    private val processNoise = 0.02f

    private var anchorLat = 0.0; private var anchorLng = 0.0
    private var seaLevelHpa = 1013.25f

    private var gridRows = 0; private var gridCols = 0; private var cellSize = 0
    private var walkGrid: Array<BooleanArray> = emptyArray()

    fun init(rows: Int, cols: Int, cellSize: Int, walkable: Array<BooleanArray>) {
        gridRows = rows; gridCols = cols; this.cellSize = cellSize; walkGrid = walkable
        state.x = 0f; state.y = 0f; state.z = 0f
        state.vx = 0f; state.vy = 0f; state.vz = 0f; state.yaw = 0f
        px = 1f; py = 1f; pz = 1f; pYaw = 0.5f
        isInit = true
    }

    fun setAnchor(lat: Double, lng: Double, heading: Float = 0f) {
        anchorLat = lat; anchorLng = lng; state.yaw = Math.toRadians(heading.toDouble()).toFloat()
    }

    fun predictStep(isStep: Boolean, dt: Float) {
        if (!isInit) return
        if (isStep) {
            state.vx = stepLen * cos(state.yaw) / dt.coerceAtLeast(0.01f)
            state.vy = stepLen * sin(state.yaw) / dt.coerceAtLeast(0.01f)
        } else {
            state.vx *= 0.7f; state.vy *= 0.7f
        }
        val nx = state.x + state.vx * dt
        val ny = state.y + state.vy * dt
        val (cx, cy) = constrain(nx, ny, state.z)
        state.x = cx; state.y = cy
        px += processNoise; py += processNoise
    }

    fun updateHeading(deg: Float, r: Float = 0.5f) {
        val zRad = Math.toRadians(deg.toDouble()).toFloat()
        val k = pYaw / (pYaw + r)
        state.yaw += k * angleDiff(zRad, state.yaw)
        pYaw *= (1 - k)
    }

    fun updateBLE(bx: Float, by: Float, r: Float = 3f) {
        kUpdate(bx, by, r)
    }

    fun updateVision(ax: Float, ay: Float, r: Float = 0.8f) {
        kUpdate(ax, ay, r)
    }

    fun updateGPS(lat: Double, lng: Double, acc: Float) {
        if (anchorLat == 0.0) { setAnchor(lat, lng); return }
        val dx = haversine(anchorLat, anchorLng, anchorLat, lng).toFloat()
        val dy = haversine(anchorLat, anchorLng, lat, anchorLng).toFloat()
        val r = (acc / 2).coerceAtLeast(1f)
        kUpdate(dx, dy, r)
    }

    fun updatePressure(hpa: Float) {
        val alt = 44330f * (1f - (hpa / seaLevelHpa).pow(1f / 5.255f))
        val k = pz / (pz + 0.3f)
        state.z += k * (alt - state.z)
        pz *= (1 - k)
    }

    private fun kUpdate(mx: Float, my: Float, r: Float) {
        val kx = px / (px + r); val ky = py / (py + r)
        val nx = state.x + kx * (mx - state.x)
        val ny = state.y + ky * (my - state.y)
        val (cx, cy) = constrain(nx, ny, state.z)
        state.x = cx; state.y = cy
        px *= (1 - kx); py *= (1 - ky)
    }

    private fun constrain(tx: Float, ty: Float, tz: Float): Pair<Float, Float> {
        if (walkGrid.isEmpty()) return tx to ty
        val col = (tx / cellSize).toInt().coerceIn(0, gridCols - 1)
        val row = (ty / cellSize).toInt().coerceIn(0, gridRows - 1)
        return if (walkGrid[row][col]) tx to ty else state.x to state.y
    }

    private fun angleDiff(a: Float, b: Float): Float {
        var d = a - b
        while (d > Math.PI) d -= (2 * Math.PI).toFloat()
        while (d < -Math.PI) d += (2 * Math.PI).toFloat()
        return d
    }

    private fun haversine(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 6371000.0
        val dLat = Math.toRadians(lat2 - lat1); val dLon = Math.toRadians(lon2 - lon1)
        val a = sin(dLat / 2).pow(2) + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2).pow(2)
        return r * 2 * atan2(sqrt(a), sqrt(1 - a))
    }
}
