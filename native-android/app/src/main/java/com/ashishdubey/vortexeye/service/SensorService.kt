package com.ashishdubey.vortexeye.service

import android.content.Context
import android.content.SharedPreferences
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlin.math.abs
import kotlin.math.roundToInt

class SensorService(ctx: Context) : SensorEventListener {

    private val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val prefs: SharedPreferences = ctx.getSharedPreferences("sensor_service", Context.MODE_PRIVATE)
    private var running = false

    private val _pressure = MutableStateFlow(0f)
    val pressure: StateFlow<Float> = _pressure

    private val _heading = MutableStateFlow(0f)
    val heading: StateFlow<Float> = _heading

    private val _gyro = MutableStateFlow(FloatArray(3))
    val gyro: StateFlow<FloatArray> = _gyro

    private val _relAltitude = MutableStateFlow(0f)
    val relAltitude: StateFlow<Float> = _relAltitude

    private val _floor = MutableStateFlow(1)
    val floor: StateFlow<Int> = _floor

    private val _floorConfidence = MutableStateFlow(0f)
    val floorConfidence: StateFlow<Float> = _floorConfidence

    private val _floorResolved = MutableStateFlow(false)
    val floorResolved: StateFlow<Boolean> = _floorResolved

    private var gravity = FloatArray(3)
    private var geomag = FloatArray(3)
    private var hasGravity = false
    private var hasGeomag = false

    // Heading stabilization: EMA + dead-zone
    private var smoothedHeading = 0f
    private var headingInit = false
    private val headingAlpha = 0.03f // Strictly slow down HUD jitter
    private val headingDeadZone = 4.0f // Require a 4 degree turn to update the screen
    private var lastEmittedHeading = 0f

    // Pressure calibration: reference = ground floor
    private var refPressure = 0f
    private var pressureCalibrated = false
    private val pressureSamples = mutableListOf<Float>()
    private val calibrationCount = 20
    private var smoothedPressure = 0f
    private val pressureAlpha = 0.15f
    private var floorHeight = 3.5f

    private var seaLevelHpa = 1013.25f
    private var seaLevelReliable = false
    private var configuredGroundAltitudeM: Float? = null
    private var configuredGroundFloor = 0
    private var startupPressureReady = false

    private var floorCandidate = 1
    private var floorCandidateHits = 0
    private val floorConfirmWindow = 4

    private val calibrationMaxAgeMs = 12 * 60 * 60 * 1000L
    private val keySeaLevelHpa = "sea_level_hpa"
    private val keySeaLevelTs = "sea_level_ts"

    fun start() {
        if (running) return
        running = true
        loadPersistedSeaLevelCalibration()
        sm.getDefaultSensor(Sensor.TYPE_PRESSURE)?.let {
            sm.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
        }
        sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let {
            sm.registerListener(this, it, SensorManager.SENSOR_DELAY_UI)
        }
        sm.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)?.let {
            sm.registerListener(this, it, SensorManager.SENSOR_DELAY_UI)
        }
        sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)?.let {
            sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME)
        }
    }

    fun stop() {
        if (!running) return
        sm.unregisterListener(this)
        running = false
    }

    fun recalibratePressure() {
        pressureCalibrated = false
        pressureSamples.clear()
        startupPressureReady = false
        floorCandidateHits = 0
        _floorConfidence.value = 0f
        _floorResolved.value = false
    }

    fun configureBuildingFloorModel(
        groundAltitudeM: Float?,
        floorHeightMeters: Float = 3.5f,
        groundFloorNumber: Int = 0
    ) {
        configuredGroundAltitudeM = groundAltitudeM
        floorHeight = floorHeightMeters.coerceAtLeast(2.4f)
        configuredGroundFloor = groundFloorNumber
        if (!pressureCalibrated) {
            _floor.value = groundFloorNumber
        }
    }

    fun seedSeaLevelFromGps(
        altitudeMeters: Double?,
        accuracyMeters: Float,
        isLikelyIndoor: Boolean
    ) {
        val alt = altitudeMeters ?: return
        if (isLikelyIndoor) return
        if (accuracyMeters > 8f) return
        val pressure = if (smoothedPressure > 0f) smoothedPressure else _pressure.value
        if (pressure <= 0f) return

        val base = 1.0 - (alt / 44330.0)
        if (base <= 0.01) return
        val estimate = (pressure / Math.pow(base, 5.255)).toFloat()
        if (estimate !in 870f..1085f) return

        seaLevelHpa = if (seaLevelReliable) {
            seaLevelHpa + 0.15f * (estimate - seaLevelHpa)
        } else {
            estimate
        }
        seaLevelReliable = true
        persistSeaLevelCalibration(seaLevelHpa)
    }

    override fun onSensorChanged(e: SensorEvent?) {
        val ev = e ?: return
        when (ev.sensor.type) {
            Sensor.TYPE_PRESSURE -> handlePressure(ev.values[0])
            Sensor.TYPE_ACCELEROMETER -> {
                gravity = ev.values.clone()
                hasGravity = true
                computeHeading()
            }
            Sensor.TYPE_MAGNETIC_FIELD -> {
                geomag = ev.values.clone()
                hasGeomag = true
                computeHeading()
            }
            Sensor.TYPE_GYROSCOPE -> _gyro.value = ev.values.clone()
        }
    }

    private fun handlePressure(hpa: Float) {
        if (hpa <= 0f) return
        _pressure.value = hpa

        // Calibration: average first N samples as ground-floor reference
        if (!pressureCalibrated) {
            pressureSamples.add(hpa)
            if (pressureSamples.size >= calibrationCount) {
                val sorted = pressureSamples.sorted()
                refPressure = sorted[sorted.size / 2]
                smoothedPressure = refPressure
                pressureCalibrated = true
                startupPressureReady = true
            }
            return
        }

        // EMA smooth the pressure to prevent jitter
        smoothedPressure += pressureAlpha * (hpa - smoothedPressure)

        // Relative altitude from reference using barometric formula
        // deltaH = 44330 * (1 - (P/P0)^(1/5.255))  where P0 is reference pressure
        val relAlt = 44330f * (1f - Math.pow(
            (smoothedPressure / refPressure).toDouble(), 1.0 / 5.255
        ).toFloat())

        _relAltitude.value = relAlt

        val fallbackFloor = configuredGroundFloor + (relAlt / floorHeight).roundToInt()

        val absoluteAlt = if (seaLevelReliable) {
            44330f * (1f - Math.pow((smoothedPressure / seaLevelHpa).toDouble(), 1.0 / 5.255).toFloat())
        } else null

        val absoluteFloor = if (absoluteAlt != null && configuredGroundAltitudeM != null) {
            configuredGroundFloor + ((absoluteAlt - configuredGroundAltitudeM!!) / floorHeight).roundToInt()
        } else null

        when {
            absoluteFloor != null -> {
                val proposed = absoluteFloor.coerceIn(-5, 200)
                applyStabilizedFloor(proposed, resolved = true)
            }
            startupPressureReady && abs(relAlt) >= floorHeight * 0.7f -> {
                val proposed = fallbackFloor.coerceIn(-5, 200)
                applyStabilizedFloor(proposed, resolved = false)
            }
            else -> {
                _floorConfidence.value = 0.1f
                _floorResolved.value = false
            }
        }
    }

    private fun applyStabilizedFloor(proposedFloor: Int, resolved: Boolean) {
        if (proposedFloor == _floor.value) {
            floorCandidate = proposedFloor
            floorCandidateHits = floorConfirmWindow
            _floorConfidence.value = if (resolved) 1f else 0.55f
            _floorResolved.value = resolved
            return
        }

        if (proposedFloor != floorCandidate) {
            floorCandidate = proposedFloor
            floorCandidateHits = 1
            _floorConfidence.value = if (resolved) 0.4f else 0.2f
            _floorResolved.value = false
            return
        }

        floorCandidateHits += 1
        _floorConfidence.value = ((floorCandidateHits.toFloat() / floorConfirmWindow) * if (resolved) 1f else 0.6f).coerceAtMost(1f)
        if (floorCandidateHits >= floorConfirmWindow) {
            _floor.value = floorCandidate
            floorCandidateHits = floorConfirmWindow
            _floorConfidence.value = if (resolved) 1f else 0.6f
            _floorResolved.value = resolved
        }
    }

    private fun loadPersistedSeaLevelCalibration() {
        val ts = prefs.getLong(keySeaLevelTs, 0L)
        val now = System.currentTimeMillis()
        if (ts <= 0L || now - ts > calibrationMaxAgeMs) return
        val cached = prefs.getFloat(keySeaLevelHpa, -1f)
        if (cached in 870f..1085f) {
            seaLevelHpa = cached
            seaLevelReliable = true
        }
    }

    private fun persistSeaLevelCalibration(value: Float) {
        prefs.edit()
            .putFloat(keySeaLevelHpa, value)
            .putLong(keySeaLevelTs, System.currentTimeMillis())
            .apply()
    }

    private fun computeHeading() {
        if (!hasGravity || !hasGeomag) return
        val r = FloatArray(9)
        val i = FloatArray(9)
        if (SensorManager.getRotationMatrix(r, i, gravity, geomag)) {
            val orient = FloatArray(3)
            SensorManager.getOrientation(r, orient)
            var rawDeg = Math.toDegrees(orient[0].toDouble()).toFloat()
            if (rawDeg < 0) rawDeg += 360f

            if (!headingInit) {
                smoothedHeading = rawDeg
                lastEmittedHeading = rawDeg
                headingInit = true
                _heading.value = rawDeg
                return
            }

            // EMA with circular wrapping
            var diff = rawDeg - smoothedHeading
            if (diff > 180f) diff -= 360f
            if (diff < -180f) diff += 360f
            smoothedHeading += headingAlpha * diff
            if (smoothedHeading < 0f) smoothedHeading += 360f
            if (smoothedHeading >= 360f) smoothedHeading -= 360f

            // Dead-zone: only emit if change > threshold
            var emitDiff = smoothedHeading - lastEmittedHeading
            if (emitDiff > 180f) emitDiff -= 360f
            if (emitDiff < -180f) emitDiff += 360f
            if (abs(emitDiff) >= headingDeadZone) {
                lastEmittedHeading = smoothedHeading
                _heading.value = smoothedHeading
            }
        }
    }

    override fun onAccuracyChanged(s: Sensor?, a: Int) {}
}
