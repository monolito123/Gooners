# kotlinx.serialization: keep generated serializers of the API models.
-keepclassmembers class br.com.gooners.pay.core.** { *** Companion; }
-keepclasseswithmembers class br.com.gooners.pay.core.** { kotlinx.serialization.KSerializer serializer(...); }
# secp256k1 JNI bindings are called from native code.
-keep class fr.acinq.secp256k1.** { *; }
