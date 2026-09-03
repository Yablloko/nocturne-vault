package com.nocturne.vault

import java.nio.ByteBuffer
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.math.pow

object Totp {
    fun parseUri(value: String): OtpItem {
        val normalized = value.trim()
        require(normalized.length in 1..MAX_OTP_URI_LENGTH) { "INVALID_OTP_URI" }
        val uri = android.net.Uri.parse(normalized)
        require(uri.scheme.equals("otpauth", true) && uri.host.equals("totp", true)) { "INVALID_OTP_URI" }
        val label = uri.pathSegments.firstOrNull().orEmpty()
        val secret = uri.getQueryParameter("secret").orEmpty()
        decodeBase32(secret)
        val issuerFromLabel = label.substringBefore(':', "")
        val account = if (':' in label) label.substringAfter(':') else label
        val issuer = uri.getQueryParameter("issuer").orEmpty().ifBlank { issuerFromLabel }
        require(issuer.isNotBlank() || account.isNotBlank()) { "INVALID_OTP_URI" }
        require(issuer.length <= MAX_OTP_LABEL_LENGTH && account.length <= MAX_OTP_LABEL_LENGTH) { "INVALID_OTP_URI" }
        return OtpItem(issuer = issuer, account = account, secret = secret.filterNot(Char::isWhitespace).uppercase())
    }
    fun code(secret: String, nowMillis: Long = System.currentTimeMillis(), digits: Int = 6, period: Int = 30): String {
        val key = decodeBase32(secret)
        val counter = nowMillis / 1000L / period
        val mac = Mac.getInstance("HmacSHA1")
        mac.init(SecretKeySpec(key, "HmacSHA1"))
        val hash = mac.doFinal(ByteBuffer.allocate(8).putLong(counter).array())
        val offset = hash.last().toInt() and 0x0f
        val binary = ((hash[offset].toInt() and 0x7f) shl 24) or
            ((hash[offset + 1].toInt() and 0xff) shl 16) or
            ((hash[offset + 2].toInt() and 0xff) shl 8) or
            (hash[offset + 3].toInt() and 0xff)
        return (binary % 10.0.pow(digits).toInt()).toString().padStart(digits, '0')
    }

    fun remaining(nowMillis: Long = System.currentTimeMillis(), period: Int = 30): Int = period - ((nowMillis / 1000L) % period).toInt()

    fun decodeBase32(input: String): ByteArray {
        val clean = input.uppercase().replace(Regex("[^A-Z2-7]"), "")
        require(clean.length >= 16) { "INVALID_OTP_SECRET" }
        val output = ArrayList<Byte>()
        var buffer = 0
        var bits = 0
        for (char in clean) {
            val value = if (char in 'A'..'Z') char - 'A' else char - '2' + 26
            buffer = (buffer shl 5) or value
            bits += 5
            if (bits >= 8) {
                bits -= 8
                output.add(((buffer shr bits) and 0xff).toByte())
            }
        }
        return output.toByteArray()
    }

    private const val MAX_OTP_URI_LENGTH = 4_096
    private const val MAX_OTP_LABEL_LENGTH = 200
}
