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
        versionCode = 2
        versionName = "2.0.0"
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
        // traz APIs do Java 8+ (inclusive java.nio.file usado pelas bibliotecas de compactação) para o Android 5–7
        isCoreLibraryDesugaringEnabled = true
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
    // Além do APK universal, gera APKs menores por processador (a maioria dos celulares usa arm64-v8a)
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64", "x86")
            isUniversalApk = true
        }
    }
    packaging {
        // bibliotecas nativas compactadas no APK (extraídas na instalação): APK bem menor
        jniLibs {
            useLegacyPackaging = true
        }
        resources {
            // recursos do BouncyCastle (criptografia pós-quântica) não usados pelo PdfBox: ~8 MB a menos
            excludes += listOf("META-INF/*.kotlin_module", "META-INF/DEPENDENCIES", "META-INF/LICENSE*", "META-INF/NOTICE*", "kotlin/**", "DebugProbesKt.bin",
                "org/bouncycastle/pqc/**", "org/bouncycastle/x509/**", "META-INF/versions/9/OSGI-INF/**",
                // tabelas fonéticas do commons-codec (dependência do commons-compress, não usadas)
                "org/apache/commons/codec/language/**")
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
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs_nio:2.1.5")
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
    // Vídeo, áudio e streaming (HLS, DASH, RTSP) com decodificadores do aparelho + FFmpeg para áudio (AC3, E-AC3, DTS, TrueHD…)
    val media3 = "1.8.0"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-exoplayer-dash:$media3")
    implementation("androidx.media3:media3-exoplayer-rtsp:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    implementation("androidx.media3:media3-session:$media3")
    implementation("org.jellyfin.media3:media3-ffmpeg-decoder:1.8.0+1")
    // Arquivos compactados: 7z, TAR, GZ, BZ2, XZ, LZMA, AR, CPIO, ARJ e RAR (até a versão 4)
    implementation("org.apache.commons:commons-compress:1.28.0")
    implementation("org.tukaani:xz:1.10")
    implementation("com.github.junrar:junrar:7.5.5")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.test:core:1.6.1")
}
