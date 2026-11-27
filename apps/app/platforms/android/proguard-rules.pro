# R8 / ProGuard rules for Ignit Android release builds

# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class dev.ignit.**$$serializer { *; }
-keepclassmembers class dev.ignit.** {
    *** Companion;
}
-keepclasseswithmembers class dev.ignit.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Ktor client & OkHttp engine
-keep class io.ktor.** { *; }
-dontwarn io.ktor.**
-dontwarn kotlinx.atomicfu.**
-dontwarn org.slf4j.**

# Domain & persistence models
-keep class dev.ignit.domain.** { *; }
-keep class dev.ignit.local.** { *; }
