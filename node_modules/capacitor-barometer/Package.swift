// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CapacitorBarometer",
    platforms: [.iOS(.v14)],
    products: [
        .library(
            name: "CapacitorBarometer",
            targets: ["BarometerPluginTarget"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "7.0.0")
    ],
    targets: [
        .target(
            name: "BarometerPluginTarget",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios",
            sources: ["Sources/BarometerPlugin", "Plugin"]
        ),
        .testTarget(
            name: "BarometerPluginTests",
            dependencies: ["BarometerPluginTarget"],
            path: "ios/Tests/BarometerPluginTests")
    ]
)
