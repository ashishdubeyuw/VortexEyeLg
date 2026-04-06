# VortexEye Native Android — Bare Minimum Runtime File Set

This file defines the **minimum practical file set** required to build and run the current Android app.

## 1) Root build system (required)

- `settings.gradle.kts`
- `build.gradle.kts`
- `gradle.properties`
- `gradlew`
- `gradlew.bat`
- `gradle/wrapper/gradle-wrapper.properties`
- `gradle/gradle-daemon-jvm.properties` (recommended for reproducible local builds)

## 2) App module build + manifest (required)

- `app/build.gradle.kts`
- `app/src/main/AndroidManifest.xml`

## 3) Kotlin source (required)

- `app/src/main/java/com/ashishdubey/vortexeye/MainActivity.kt`
- `app/src/main/java/com/ashishdubey/vortexeye/VortexApplication.kt`
- `app/src/main/java/com/ashishdubey/vortexeye/viewmodel/VortexViewModel.kt`
- `app/src/main/java/com/ashishdubey/vortexeye/ui/MainScreen.kt`
- `app/src/main/java/com/ashishdubey/vortexeye/ui/theme/LiquidGlassTheme.kt`
- `app/src/main/java/com/ashishdubey/vortexeye/data/BuildingConfig.kt`
- `app/src/main/java/com/ashishdubey/vortexeye/data/IndoorGraph.kt`
- `app/src/main/java/com/ashishdubey/vortexeye/service/LocationService.kt`
- `app/src/main/java/com/ashishdubey/vortexeye/service/NavigationService.kt`
- `app/src/main/java/com/ashishdubey/vortexeye/service/VisionService.kt`
- `app/src/main/java/com/ashishdubey/vortexeye/service/SensorService.kt`
- `app/src/main/java/com/ashishdubey/vortexeye/service/StepCounterService.kt`
- `app/src/main/java/com/ashishdubey/vortexeye/service/AntigravityEKF.kt`
- `app/src/main/java/com/ashishdubey/vortexeye/service/IndoorPositioningService.kt`
- `app/src/main/java/com/ashishdubey/vortexeye/service/TelephonyService.kt`
- `app/src/main/java/com/ashishdubey/vortexeye/service/IndoorGraphRepository.kt`
- `app/src/main/java/com/ashishdubey/vortexeye/service/IndoorGraphRouter.kt`
- `app/src/main/java/com/ashishdubey/vortexeye/service/HybridRouter.kt`
- `app/src/main/java/com/ashishdubey/vortexeye/service/LocalCopilotService.kt`
- `app/src/main/java/com/ashishdubey/vortexeye/service/OfflinePackManager.kt`

## 4) Resources (required)

- `app/src/main/res/values/themes.xml`
- `app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
- `app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml`

## 5) Assets (required for current startup behavior)

- `app/src/main/assets/detect.tflite`
- `app/src/main/assets/labelmap.txt`
- `app/src/main/assets/indoor_graph_demo.json`

## 6) Not required to run app (do not push as runtime set)

- `build/`, `app/build/`, `.gradle/`, `.idea/`
- `local.properties` (machine-local SDK path)
- `.DS_Store`
- `app/src/main/AndroidManifest.xml.orig`, `app/src/main/AndroidManifest.xml.rej`
- docs (`FREE_ONLY_ARCHITECTURE.md`, `VORTEXEYE_ARCHITECTURE_BRIEF_UW.md`) are optional for runtime

## 7) Suggested minimal push policy

Push the files above plus `.gitignore`, and explicitly exclude machine-specific/generated artifacts.
