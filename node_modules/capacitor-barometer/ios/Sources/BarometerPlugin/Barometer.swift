import Foundation
import CoreMotion
import Capacitor

@objc public class Barometer: NSObject {
    private var altimeter: CMAltimeter?
    private var currentPressureData: CMAltitudeData?
    private weak var plugin: CAPPlugin? // To call notifyListeners

    // Initialize with the plugin instance to allow callbacks
    public init(plugin: CAPPlugin) {
        self.plugin = plugin
        super.init()
        if CMAltimeter.isRelativeAltitudeAvailable() {
            self.altimeter = CMAltimeter()
            print("Barometer (implementation) initialized.")
        } else {
            print("Barometer (implementation): Altimeter not available.")
        }
    }

    @objc public func start(call: CAPPluginCall) {
        guard let altimeter = self.altimeter, CMAltimeter.isRelativeAltitudeAvailable() else {
            print("Barometer (implementation): Cannot start, altimeter not available.")
            call.reject("Barometer not available on this device.")
            return
        }
        print("Barometer (implementation): Starting updates.")
        altimeter.startRelativeAltitudeUpdates(to: OperationQueue.main) { [weak self] (data, error) in
            guard let strongSelf = self else { return }
            if let error = error {
                print("Barometer (implementation) Error: \(error.localizedDescription)")
                // We can't directly reject the call here as it might have already resolved.
                // Notify an error state if needed, or rely on continuous updates.
                // For now, just log it.
                return
            }
            guard let data = data else {
                print("Barometer (implementation): No data received.")
                return
            }
            
            strongSelf.currentPressureData = data
            let pressureInKPa = data.pressure.doubleValue
            let pressureInHPa = pressureInKPa * 10.0
            
            var ret = JSObject()
            ret["pressure"] = pressureInHPa
            strongSelf.plugin?.notifyListeners("onPressureChange", data: ret, retainUntilConsumed: true)
        }
        call.resolve()
    }

    @objc public func stop(call: CAPPluginCall) {
        print("Barometer (implementation): Stopping updates.")
        altimeter?.stopRelativeAltitudeUpdates()
        call.resolve()
    }

    @objc public func getPressure(call: CAPPluginCall) {
        guard let data = self.currentPressureData else {
            print("Barometer (implementation): Pressure data not available.")
            call.reject("Pressure data not yet available or barometer not started.")
            return
        }
        let pressureInKPa = data.pressure.doubleValue
        let pressureInHPa = pressureInKPa * 10.0
        var ret = JSObject()
        ret["pressure"] = pressureInHPa
        call.resolve(ret)
    }

    @objc public func isAvailable(call: CAPPluginCall) {
        let available = CMAltimeter.isRelativeAltitudeAvailable()
        print("Barometer (implementation) Available: \(available)")
        var ret = JSObject()
        ret["available"] = available
        call.resolve(ret)
    }

    @objc public func echo(_ value: String) -> String {
        print("Barometer (implementation) Echo: \(value)")
        return value
    }
}
