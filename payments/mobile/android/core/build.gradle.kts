import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// The platform-independent core: money, Nostr (NIP-01, BIP-340, NIP-19), NIP-98, DPoP, the
// API client, the checkout state machine and the sandbox card reader. Plain Kotlin on the
// JVM, so every rule is unit-tested against payments/mobile/conformance/vectors.json.
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    api(libs.kotlinx.coroutines.core)
    api(libs.kotlinx.serialization.json)
    api(libs.okhttp)
    api(libs.secp256k1.kmp)
    testImplementation(libs.secp256k1.jni.jvm)
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}

tasks.test {
    systemProperty("conformance.vectors", rootProject.file("../conformance/vectors.json").absolutePath)
    systemProperty("nostr.examples", rootProject.file("../../nostr/examples").absolutePath)
}

// The desktop native secp256k1 used by the JVM tests (not shipped in the app) needs Java 21;
// the library itself stays on Java 17 bytecode for Android.
listOf("testCompileClasspath", "testRuntimeClasspath").forEach { name ->
    configurations.named(name) { attributes { attribute(TargetJvmVersion.TARGET_JVM_VERSION_ATTRIBUTE, 21) } }
}
tasks.named<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>("compileTestKotlin") {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_21) }
}
tasks.named<JavaCompile>("compileTestJava") {
    sourceCompatibility = "21"
    targetCompatibility = "21"
}
