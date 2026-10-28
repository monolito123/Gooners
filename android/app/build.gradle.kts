plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "br.com.gooners.pdf"
    compileSdk = 35

    defaultConfig {
        applicationId = "br.com.gooners.pdf"
        minSdk = 21
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        vectorDrawables.useSupportLibrary = true
    }

    // Assina o release com a chave definida nas variáveis de ambiente (CI); sem elas, usa a chave de debug
    // para que o APK gerado continue instalável.
    signingConfigs {
        create("release") {
            val ks = System.getenv("GPDF_KEYSTORE")
            if (ks != null && file(ks).exists()) {
                storeFile = file(ks)
                storePassword = System.getenv("GPDF_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("GPDF_KEY_ALIAS")
                keyPassword = System.getenv("GPDF_KEY_PASSWORD")
            } else {
                val debug = getByName("debug")
                storeFile = debug.storeFile
                storePassword = debug.storePassword
                keyAlias = debug.keyAlias
                keyPassword = debug.keyPassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
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
        buildConfig = true
    }
    androidResources {
        localeFilters += listOf("pt", "en")
    }
    packaging {
        resources {
            // recursos do BouncyCastle (criptografia pós-quântica) não usados pelo PdfBox: ~8 MB a menos
            excludes += listOf("META-INF/*.kotlin_module", "META-INF/DEPENDENCIES", "META-INF/LICENSE*", "META-INF/NOTICE*", "kotlin/**", "DebugProbesKt.bin",
                "org/bouncycastle/pqc/**", "org/bouncycastle/x509/**", "META-INF/versions/9/OSGI-INF/**")
        }
    }
    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.all {
            // baixa o android-all do Robolectric pelo espelho do Maven Central
            it.systemProperty("robolectric.dependency.repo.url", "https://maven-central.storage-download.googleapis.com/maven2")
        }
    }
    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    implementation("androidx.documentfile:documentfile:1.0.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    // Edição de PDF (mesclar, dividir, criptografar, formulários, anotações, texto)
    implementation("com.tom-roush:pdfbox-android:2.0.27.0")
    // OCR e digitalizador de documentos via Google Play Services (modelos baixados sob demanda: APK continua leve)
    implementation("com.google.android.gms:play-services-mlkit-text-recognition:19.0.1")
    implementation("com.google.android.gms:play-services-mlkit-document-scanner:16.0.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.test:core:1.6.1")
}
