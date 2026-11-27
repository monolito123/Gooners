# PdfBox-Android já traz regras próprias (security handlers); aqui só silenciamos dependências opcionais.
-dontwarn com.tom_roush.**
-dontwarn org.bouncycastle.**
-dontwarn com.gemalto.jp2.**
-dontwarn javax.xml.**
-dontwarn org.slf4j.**
-keep class com.tom_roush.pdfbox.filter.** { *; }

# Decodificador FFmpeg é carregado por reflexão pelo DefaultRenderersFactory
-keep class androidx.media3.decoder.ffmpeg.FfmpegAudioRenderer { <init>(...); }
-keep class androidx.media3.decoder.ffmpeg.FfmpegLibrary { *; }
# Dependências opcionais de compressão e logging
-dontwarn org.slf4j.**
-dontwarn org.brotli.**
-dontwarn com.github.luben.zstd.**
-dontwarn org.objectweb.asm.**
-dontwarn io.airlift.compress.**
-dontwarn java.nio.file.**
-dontwarn javax.annotation.**
