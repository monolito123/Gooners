# PdfBox-Android já traz regras próprias (security handlers); aqui só silenciamos dependências opcionais.
-dontwarn com.tom_roush.**
-dontwarn org.bouncycastle.**
-dontwarn com.gemalto.jp2.**
-dontwarn javax.xml.**
-dontwarn org.slf4j.**
-keep class com.tom_roush.pdfbox.filter.** { *; }
