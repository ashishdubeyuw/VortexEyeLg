import Foundation
import Capacitor
import CoreMotion // Import CoreMotion for CMAltimeter

/**
 * Please read the Capacitor iOS Plugin Development Guide
 * here: https://capacitorjs.com/docs/plugins/ios
 */
@objc(BarometerPlugin)
public class BarometerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BarometerPlugin"
    public let jsName = "Barometer" // Matches what you want for JS import
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPressure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "echo", returnType: CAPPluginReturnPromise)
    ]
    
    // Pass self (plugin instance) to the implementation so it can call notifyListeners
    private lazy var implementation: Barometer = Barometer(plugin: self)

    override public func load() {
        // Anything specific to plugin loading, if needed beyond implementation init
        print("BarometerPlugin (bridged) loaded.")
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        implementation.isAvailable(call: call)
    }

    @objc func start(_ call: CAPPluginCall) {
        implementation.start(call: call)
    }

    @objc func stop(_ call: CAPPluginCall) {
        implementation.stop(call: call)
    }

    @objc func getPressure(_ call: CAPPluginCall) {
        implementation.getPressure(call: call)
    }

    @objc func echo(_ call: CAPPluginCall) {
        let value = call.getString("value") ?? ""
        // The echo method in Barometer class now returns String, not directly handling CAPPluginCall
        // So, we adapt it here.
        call.resolve(["value": implementation.echo(value)])
    }
}
