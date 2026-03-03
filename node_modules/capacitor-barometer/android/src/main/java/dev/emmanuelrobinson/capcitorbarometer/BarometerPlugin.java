package dev.emmanuelrobinson.capcitorbarometer;

// No need to implement SensorEventListener here anymore
// import android.hardware.SensorEventListener;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Barometer") // Ensure this matches jsName in iOS and registerPlugin in JS
public class BarometerPlugin extends Plugin {
    private Barometer implementation;

    @Override
    public void load() {
        super.load();
        implementation = new Barometer(this);
        implementation.loadImplementation();
        android.util.Log.d("BarometerPlugin", "Plugin loaded, Barometer implementation created.");
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (implementation.isSensorAvailable()) {
            implementation.startListening();
            call.resolve();
        } else {
            call.reject("Barometer sensor not available.");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        implementation.stopListening();
        call.resolve();
    }

    @Override
    public void handleOnDestroy() {
        if (implementation != null) {
            implementation.handleOnDestroy();
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", implementation.isSensorAvailable());
        call.resolve(ret);
    }

    @PluginMethod
    public void getPressure(PluginCall call) {
        if (!implementation.isSensorAvailable()) {
            call.unavailable("Barometer sensor not found or not started.");
        } else {
            JSObject ret = new JSObject();
            ret.put("pressure", implementation.getCurrentPressure());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void echo(PluginCall call) {
        String value = call.getString("value", "");
        JSObject ret = new JSObject();
        ret.put("value", implementation.echo(value));
        call.resolve(ret);
    }

    public void notifyPressureChange(JSObject data) {
        notifyListeners("onPressureChange", data, true);
    }
}
