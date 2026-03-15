package com.ashishdubey.vortexeye.service

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlin.math.abs
import kotlin.math.sqrt

data class StepData(val stepCount: Int, val distanceMeters: Float)

class StepCounterService(private val ctx: Context) : SensorEventListener {

    private val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private var running = false
    private var stepCount = 0
    private var stride = 0.75f

    // Peak detection
    private val peakThreshold = 1.2f
    private val peakCooldownMs = 350L
    private var lastPeakTs = 0L
    private var prevMag = 0f

    private val _steps = MutableStateFlow(StepData(0, 0f))
    val steps: StateFlow<StepData> = _steps

    fun start() {
        if (running) return
        val accel = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
        sm.registerListener(this, accel, SensorManager.SENSOR_DELAY_GAME)
        running = true
    }

    fun stop() {
        if (!running) return
        sm.unregisterListener(this)
        running = false
    }

    fun reset() { stepCount = 0; _steps.value = StepData(0, 0f) }
    fun setStride(m: Float) { stride = m }

    override fun onSensorChanged(e: SensorEvent?) {
        val ev = e ?: return
        if (ev.sensor.type != Sensor.TYPE_ACCELEROMETER) return

        val mag = sqrt(ev.values[0] * ev.values[0] +
                       ev.values[1] * ev.values[1] +
                       ev.values[2] * ev.values[2]) / SensorManager.GRAVITY_EARTH

        val now = System.currentTimeMillis()

        if (mag > peakThreshold && prevMag <= peakThreshold
            && (now - lastPeakTs) > peakCooldownMs) {
            stepCount++
            lastPeakTs = now
            _steps.value = StepData(stepCount, stepCount * stride)
        }
        prevMag = mag
    }

    override fun onAccuracyChanged(s: Sensor?, a: Int) {}
}
