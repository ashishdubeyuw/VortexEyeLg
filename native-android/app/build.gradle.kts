plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.ashishdubey.vortexeye"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.ashishdubey.vortexeye"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"

        ndk {
            abiFilters.add("arm64-v8a")
        }

        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.1"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.6.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.6.2")
    implementation("androidx.activity:activity-compose:1.8.0")

    // Compose
    implementation(platform("androidx.compose:compose-bom:2023.08.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    // Changed to implementation to ensure ComposeViewAdapter is found by the Preview renderer
    implementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    // App Center (Analytics, Crashes, and Distribute for OTA updates)
    val appCenterSdkVersion = "5.0.6"
    implementation("com.microsoft.appcenter:appcenter-analytics:$appCenterSdkVersion")
    implementation("com.microsoft.appcenter:appcenter-crashes:$appCenterSdkVersion")
    implementation("com.microsoft.appcenter:appcenter-distribute:$appCenterSdkVersion")

    // Google Play Services (Location)
    implementation("com.google.android.gms:play-services-location:21.0.1")

    // OSMDroid (Free Map)
    implementation("org.osmdroid:osmdroid-android:6.1.18")

    // CameraX
    val cameraxVersion = "1.3.0-rc01"
    implementation("androidx.camera:camera-core:$cameraxVersion")
    implementation("androidx.camera:camera-camera2:$cameraxVersion")
    implementation("androidx.camera:camera-lifecycle:$cameraxVersion")
    implementation("androidx.camera:camera-view:$cameraxVersion")

    // TensorFlow Lite
    implementation("org.tensorflow:tensorflow-lite:2.14.0")
    implementation("org.tensorflow:tensorflow-lite-support:0.4.4")

    // ML Kit Text Recognition (OCR - on device)
    implementation("com.google.mlkit:text-recognition:16.0.0")
}
