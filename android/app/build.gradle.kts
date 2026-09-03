plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.nocturne.vault"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.nocturne.vault"
        minSdk = 26
        targetSdk = 36
        versionCode = 29
        versionName = "0.9.11"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    lint {
        disable += setOf(
            "AccidentalOctal", "AndroidGradlePluginVersion", "AnnotationProcessorOnCompilePath",
            "BomWithoutPlatform", "UseOfBundledGooglePlayServices", "ChromeOsAbiSupport",
            "GradleCompatible", "CoreLibDesugaringV1", "DataBindingWithoutKapt", "GradleDependency",
            "GradleDeprecated", "GradleDeprecatedConfiguration", "OutdatedLibrary", "DevModeObsolete",
            "DuplicatePlatformClasses", "EditedTargetSdkVersion", "ExpiredTargetSdkVersion",
            "ExpiringTargetSdkVersion", "GradleGetter", "GradlePluginVersion", "HighAppVersionCode",
            "GradleIdeError", "InstantAppDeprecation", "JavaPluginLanguageLevel", "JcenterRepositoryObsolete",
            "KaptUsageInsteadOfKsp", "KtxExtensionAvailable", "LifecycleAnnotationProcessorWithJava8",
            "MinSdkTooLow", "SimilarGradleDependency", "NotInterpolated", "GradlePath",
            "PlaySdkIndexDeprecated", "PlaySdkIndexGenericIssues", "PlaySdkIndexNonCompliant",
            "PlaySdkIndexVulnerability", "GradleDynamicVersion", "NewerVersionAvailable", "R8GradualApi",
            "RiskyLibrary", "StringShouldBeInt", "UseTomlInstead", "OldTargetApi",
        )
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isDebuggable = false
            isJniDebuggable = false
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.06.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.10.0")
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.credentials:credentials:1.7.0-alpha03")
    implementation("androidx.fragment:fragment-ktx:1.9.0")
    implementation("androidx.media3:media3-exoplayer:1.11.0")
    implementation("androidx.media3:media3-ui:1.11.0")
    implementation("com.google.zxing:core:3.5.3")
    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

dependencyLocking {
    lockAllConfigurations()
}
