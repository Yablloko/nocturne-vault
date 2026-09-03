package com.nocturne.vault

import java.security.SecureRandom
import java.io.InputStream
import java.io.OutputStream
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

data class CipherBlob(val iv: ByteArray, val ciphertext: ByteArray)

object CryptoBox {
    private const val TAG_BITS = 128
    private const val KEY_BITS = 256
    const val MASTER_ITERATIONS = 600_000
    const val QUICK_ITERATIONS = 210_000
    private val random = SecureRandom()

    fun randomBytes(size: Int): ByteArray = ByteArray(size).also(random::nextBytes)

    fun derive(password: CharArray, salt: ByteArray, iterations: Int): ByteArray {
        require(password.isNotEmpty() && salt.size >= 16 && iterations >= 100_000)
        val spec = PBEKeySpec(password, salt, iterations, KEY_BITS)
        return try {
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
        }
    }

    fun encrypt(key: ByteArray, plain: ByteArray, aad: String): CipherBlob {
        require(key.size == 32)
        val iv = randomBytes(12)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, iv))
        cipher.updateAAD(aad.toByteArray(Charsets.UTF_8))
        return CipherBlob(iv, cipher.doFinal(plain))
    }

    fun decrypt(key: ByteArray, blob: CipherBlob, aad: String): ByteArray {
        require(key.size == 32 && blob.iv.size == 12)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, blob.iv))
        cipher.updateAAD(aad.toByteArray(Charsets.UTF_8))
        return cipher.doFinal(blob.ciphertext)
    }

    fun encryptStream(
        key: ByteArray,
        input: InputStream,
        output: OutputStream,
        aad: String,
        maxPlainBytes: Long,
        onProgress: (Long) -> Unit = {},
    ): Pair<ByteArray, Long> {
        require(key.size == 32)
        val iv = randomBytes(12)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        cipher.updateAAD(aad.toByteArray(Charsets.UTF_8))
        output.write(iv)
        val buffer = ByteArray(256 * 1024)
        var total = 0L
        try {
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                total += read
                require(total <= maxPlainBytes) { "FILE_TOO_LARGE" }
                cipher.update(buffer, 0, read)?.let(output::write)
                buffer.fill(0, 0, read)
                onProgress(total)
            }
            output.write(cipher.doFinal())
            return iv to total
        } finally { buffer.fill(0) }
    }

    fun decryptStream(key: ByteArray, input: InputStream, output: OutputStream, aad: String) {
        require(key.size == 32)
        val data = java.io.DataInputStream(input)
        val ivSize = data.readInt()
        require(ivSize == 12) { "INVALID_BLOB" }
        val iv = ByteArray(ivSize).also(data::readFully)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        cipher.updateAAD(aad.toByteArray(Charsets.UTF_8))
        val buffer = ByteArray(256 * 1024)
        try {
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                cipher.update(buffer, 0, read)?.let(output::write)
                buffer.fill(0, 0, read)
            }
            output.write(cipher.doFinal())
        } finally { buffer.fill(0); iv.fill(0) }
    }
}
