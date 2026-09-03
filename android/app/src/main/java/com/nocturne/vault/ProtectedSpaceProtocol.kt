package com.nocturne.vault

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

data class ProtectedSpaceIdentity(
    val publicKey: String,
    val privateKey: String,
    val counter: Long = 0,
)

data class ProtectedSpaceCommand(
    val action: String,
    val packageName: String,
    val pairingKey: String,
    val counter: Long,
    val issuedAt: Long,
    val expiresAt: Long,
    val sessionUntil: Long,
    val nonce: String,
    val signature: String,
)

data class ProtectedSpaceVerification(
    val accepted: Boolean,
    val reason: String = "",
)

object ProtectedSpaceProtocol {
    const val ACTION_OPEN = "OPEN"
    const val ACTION_LOCK = "LOCK"
    const val ACTION_REPAIR = "REPAIR"
    // The signed command remains single-use (monotonic counter + nonce), but must leave enough
    // time for Android to display and complete the separate work-profile credential screen.
    const val COMMAND_TTL_MS = 2 * 60_000L
    const val REPAIR_COMMAND_TTL_MS = 5 * 60_000L
    const val MAX_SESSION_MS = 5 * 60_000L
    const val CLOCK_SKEW_MS = 10_000L
    private const val VERSION = 3

    fun createIdentity(): ProtectedSpaceIdentity {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"), SecureRandom())
        val pair = generator.generateKeyPair()
        return ProtectedSpaceIdentity(encode(pair.public.encoded), encode(pair.private.encoded))
    }

    fun isValidPublicKey(value: String): Boolean = value.length in 80..1024 && runCatching {
        publicKey(value).algorithm.equals("EC", ignoreCase = true)
    }.getOrDefault(false)

    fun isValidIdentity(value: ProtectedSpaceIdentity): Boolean {
        if (value.counter < 0 || value.publicKey.length !in 80..1024 || value.privateKey.length !in 80..2048) return false
        return runCatching {
            val proof = "nocturne-protected-space-identity-v1".toByteArray(Charsets.UTF_8)
            val signer = Signature.getInstance("SHA256withECDSA").apply {
                initSign(privateKey(value.privateKey))
                update(proof)
            }
            val signature = signer.sign()
            Signature.getInstance("SHA256withECDSA").apply {
                initVerify(publicKey(value.publicKey))
                update(proof)
            }.verify(signature)
        }.getOrDefault(false)
    }

    fun sign(
        identity: ProtectedSpaceIdentity,
        action: String,
        packageName: String = "",
        now: Long = System.currentTimeMillis(),
        sessionDurationMs: Long = MAX_SESSION_MS,
    ): Pair<ProtectedSpaceIdentity, ProtectedSpaceCommand> {
        require(action == ACTION_OPEN || action == ACTION_LOCK || action == ACTION_REPAIR) { "INVALID_ACTION" }
        require(packageName.length <= 255) { "INVALID_PACKAGE" }
        require(action != ACTION_REPAIR || packageName.isEmpty()) { "INVALID_PACKAGE" }
        require(sessionDurationMs in 0..MAX_SESSION_MS) { "INVALID_SESSION" }
        val nextCounter = Math.addExact(identity.counter, 1L)
        val commandTtl = if (action == ACTION_REPAIR) REPAIR_COMMAND_TTL_MS else COMMAND_TTL_MS
        val command = ProtectedSpaceCommand(
            action = action,
            packageName = packageName,
            pairingKey = if (action == ACTION_REPAIR) identity.publicKey else "",
            counter = nextCounter,
            issuedAt = now,
            expiresAt = Math.addExact(now, commandTtl),
            sessionUntil = if (action == ACTION_OPEN) Math.addExact(now, sessionDurationMs) else now,
            nonce = encode(ByteArray(16).also(SecureRandom()::nextBytes)),
            signature = "",
        )
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(privateKey(identity.privateKey))
        signer.update(canonical(command))
        return identity.copy(counter = nextCounter) to command.copy(signature = encode(signer.sign()))
    }

    fun verify(command: ProtectedSpaceCommand, publicKey: String, lastCounter: Long, now: Long = System.currentTimeMillis()): ProtectedSpaceVerification {
        if (command.action != ACTION_OPEN && command.action != ACTION_LOCK) return rejected("INVALID_ACTION")
        if (command.packageName.length > 255) return rejected("INVALID_PACKAGE")
        if (command.pairingKey.isNotEmpty()) return rejected("INVALID_PAIRING_DATA")
        if (command.counter <= lastCounter || command.counter <= 0) return rejected("REPLAYED_COMMAND")
        if (command.issuedAt > now + CLOCK_SKEW_MS) return rejected("COMMAND_FROM_FUTURE")
        if (command.expiresAt < now || command.expiresAt < command.issuedAt || command.expiresAt - command.issuedAt > COMMAND_TTL_MS) return rejected("EXPIRED_COMMAND")
        if (command.action == ACTION_OPEN && (command.sessionUntil < now || command.sessionUntil - command.issuedAt > MAX_SESSION_MS)) return rejected("INVALID_SESSION")
        if (command.action == ACTION_LOCK && command.sessionUntil != command.issuedAt) return rejected("INVALID_SESSION")
        if (decodeOrNull(command.nonce)?.size != 16) return rejected("INVALID_NONCE")
        val verifier = runCatching { Signature.getInstance("SHA256withECDSA").apply { initVerify(publicKey(publicKey)); update(canonical(command)) } }.getOrNull()
            ?: return rejected("INVALID_KEY")
        val valid = runCatching { verifier.verify(decode(command.signature)) }.getOrDefault(false)
        return if (valid) ProtectedSpaceVerification(true) else rejected("INVALID_SIGNATURE")
    }

    fun verifyRepair(command: ProtectedSpaceCommand, now: Long = System.currentTimeMillis()): ProtectedSpaceVerification {
        if (command.action != ACTION_REPAIR) return rejected("INVALID_ACTION")
        if (command.packageName.isNotEmpty()) return rejected("INVALID_PACKAGE")
        if (!isValidPublicKey(command.pairingKey)) return rejected("INVALID_KEY")
        if (command.counter <= 0) return rejected("INVALID_COUNTER")
        if (command.issuedAt > now + CLOCK_SKEW_MS) return rejected("COMMAND_FROM_FUTURE")
        if (command.expiresAt < now || command.expiresAt < command.issuedAt || command.expiresAt - command.issuedAt > REPAIR_COMMAND_TTL_MS) return rejected("EXPIRED_COMMAND")
        if (command.sessionUntil != command.issuedAt) return rejected("INVALID_SESSION")
        if (decodeOrNull(command.nonce)?.size != 16) return rejected("INVALID_NONCE")
        val verifier = runCatching { Signature.getInstance("SHA256withECDSA").apply { initVerify(publicKey(command.pairingKey)); update(canonical(command)) } }.getOrNull()
            ?: return rejected("INVALID_KEY")
        val valid = runCatching { verifier.verify(decode(command.signature)) }.getOrDefault(false)
        return if (valid) ProtectedSpaceVerification(true) else rejected("INVALID_SIGNATURE")
    }

    private fun canonical(command: ProtectedSpaceCommand): ByteArray {
        val output = ByteArrayOutputStream()
        DataOutputStream(output).use { stream ->
            stream.writeInt(VERSION)
            listOf(command.action, command.packageName, command.pairingKey, command.nonce).forEach { value ->
                val bytes = value.toByteArray(Charsets.UTF_8)
                stream.writeInt(bytes.size)
                stream.write(bytes)
            }
            stream.writeLong(command.counter)
            stream.writeLong(command.issuedAt)
            stream.writeLong(command.expiresAt)
            stream.writeLong(command.sessionUntil)
        }
        return output.toByteArray()
    }

    private fun privateKey(value: String): PrivateKey = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(decode(value)))
    private fun publicKey(value: String): PublicKey = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(decode(value)))
    private fun encode(value: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(value)
    private fun decode(value: String): ByteArray = Base64.getUrlDecoder().decode(value)
    private fun decodeOrNull(value: String): ByteArray? = runCatching { decode(value) }.getOrNull()
    private fun rejected(reason: String) = ProtectedSpaceVerification(false, reason)
}
