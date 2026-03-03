package dev.emmanuelrobinson.capcitorbarometer;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.util.Log;

import com.getcapacitor.JSObject;
// Removed: import com.getcapacitor.Plugin;

public class Barometer implements SensorEventListener {
    private BarometerPlugin pluginInstance;
    private SensorManager sensorManager;
    private Sensor barometerSensor;
    private float currentPressure;
    private boolean isListening = false;

    public Barometer(BarometerPlugin plugin) {
        this.pluginInstance = plugin;
    }

    public void loadImplementation() {
        Context context = pluginInstance.getContext();
        sensorManager = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager != null) {
            barometerSensor = sensorManager.getDefaultSensor(Sensor.TYPE_PRESSURE);
            Log.d("BarometerLogic", "Barometer sensor: " + (barometerSensor != null ? "Found" : "Not found"));
        } else {
            Log.e("BarometerLogic", "SensorManager is null");
        }
    }

    public void startListening() {
        if (barometerSensor != null && !isListening) {
            boolean registered = sensorManager.registerListener(this, barometerSensor, SensorManager.SENSOR_DELAY_NORMAL);
            if(registered) {
                isListening = true;
                Log.d("BarometerLogic", "Started listening to barometer sensor.");
            } else {
                Log.e("BarometerLogic", "Failed to register listener for barometer sensor.");
            }
        } else if (barometerSensor == null) {
            Log.w("BarometerLogic", "Cannot start listening, barometer sensor is null.");
        } else {
            Log.d("BarometerLogic", "Already listening or no sensor.");
        }
    }

    public void stopListening() {
        if (sensorManager != null && isListening) {
            sensorManager.unregisterListener(this);
            isListening = false;
            Log.d("BarometerLogic", "Stopped listening to barometer sensor.");
        }
    }

    public void handleOnDestroy() {
        stopListening();
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event.sensor.getType() == Sensor.TYPE_PRESSURE) {
            currentPressure = event.values[0]; // hPa
            JSObject ret = new JSObject();
            ret.put("pressure", currentPressure);
            pluginInstance.notifyPressureChange(ret);
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        Log.d("BarometerLogic", "Accuracy changed: " + accuracy);
    }

    public boolean isSensorAvailable() {
        return barometerSensor != null;
    }

    public float getCurrentPressure() {
        return currentPressure;
    }

    public String echo(String value) {
        Log.d("BarometerLogic", "Echo: " + value);
        return value;
    }
}
