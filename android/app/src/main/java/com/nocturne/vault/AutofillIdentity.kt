package com.nocturne.vault

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import java.security.MessageDigest

internal fun packageSigningDigest(context: Context, packageName: String): String {
    if (packageName.isBlank()) return ""
    val signatures = runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val info = context.packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
            val signing = info.signingInfo ?: return@runCatching emptyArray()
            (if (signing.hasMultipleSigners()) signing.apkContentsSigners else signing.signingCertificateHistory) ?: emptyArray()
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNATURES).signatures ?: emptyArray()
        }
    }.getOrDefault(emptyArray())
    return signatures
        .map { signature -> MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()).toHex() }
        .distinct()
        .sorted()
        .joinToString(",")
}

private fun ByteArray.toHex(): String = joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
