plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "br.com.gooners.pay"
    compileSdk = 37

    defaultConfig {
        applicationId = "br.com.gooners.pay"
        minSdk = 30 // docs/05 §2.1: Android 11, NFC with ISO-DEP
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
        // The sandbox server an emulator reaches on the host machine.
        buildConfigField("String", "DEFAULT_API_URL", "\"http://10.0.2.2:8080\"")
        // Certificate pinning of the platform's API host: the SPKI hashes ("sha256/…") of its
        // current key and a backup key, set for release builds with
        // -Pgoonerspay.pins=sha256/AAA…,sha256/BBB… (payments/mobile/README.md).
        buildConfigField("String", "PINNED_HOST", "\"${providers.gradleProperty("goonerspay.pinnedHost").getOrElse("api.goonerspay.com.br")}\"")
        buildConfigField("String", "API_PINS", "\"${providers.gradleProperty("goonerspay.pins").getOrElse("")}\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf("META-INF/versions/9/OSGI-INF/MANIFEST.MF", "META-INF/*.kotlin_module")
    }
}

dependencies {
    implementation(project(":core"))
    implementation(libs.secp256k1.jni.android)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.material3)
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.biometric)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.zxing.core)
    implementation(libs.zxing.embedded) // the owner's phone reads a new phone's npub QR
}
