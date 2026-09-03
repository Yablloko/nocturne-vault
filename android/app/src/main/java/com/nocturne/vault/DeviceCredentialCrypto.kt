package com.nocturne.vault

import android.os.Build
import androidx.annotation.RequiresApi
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class DeviceCredentialCrypto {
    private val alias = "nocturne.system.quick.v3"
    private val legacyAliases = arrayOf("nocturne.system.quick.v2", "nocturne.system.quick.v1")

    fun isSupported(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R

    @RequiresApi(Build.VERSION_CODES.R)
    fun encryptCipher(): Cipher {
        require(isSupported()) { "SYSTEM_AUTH_UNSUPPORTED" }
        return Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.ENCRYPT_MODE, getOrCreateKey())
            updateAAD(AAD)
        }
    }

    @RequiresApi(Build.VERSION_CODES.R)
    fun decryptCipher(iv: ByteArray): Cipher {
        require(isSupported()) { "SYSTEM_AUTH_UNSUPPORTED" }
        return Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
            updateAAD(AAD)
        }
    }

    fun delete() {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (store.containsAlias(alias)) store.deleteEntry(alias)
        legacyAliases.filter(store::containsAlias).forEach(store::deleteEntry)
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun getOrCreateKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        legacyAliases.filter(store::containsAlias).forEach(store::deleteEntry)
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(true)
            .setUserAuthenticationParameters(
                0,
                KeyProperties.AUTH_BIOMETRIC_STRONG,
            )
            .setInvalidatedByBiometricEnrollment(true)
            .build()
        generator.init(spec)
        return generator.generateKey()
    }

    companion object {
        private val AAD = "nocturne-system-quick-v3".toByteArray(Charsets.UTF_8)
    }
}
