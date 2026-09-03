package com.nocturne.vault

import java.security.SecureRandom

data class PasswordRequirement(val label: String, val met: Boolean)

object SecurityPolicy {
    private const val MIN_MASTER_LENGTH = 12
    private val random = SecureRandom()
    private const val LOWER = "abcdefghijkmnopqrstuvwxyz"
    private const val UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    private const val DIGITS = "23456789"
    private const val SYMBOLS = "!@#%&*+-_=?:"
    private val all = LOWER + UPPER + DIGITS + SYMBOLS

    fun masterRequirements(value: String): List<PasswordRequirement> = listOf(
        PasswordRequirement("Не менее $MIN_MASTER_LENGTH символов", value.length >= MIN_MASTER_LENGTH),
        PasswordRequirement("Строчная буква", value.any(Char::isLowerCase)),
        PasswordRequirement("Заглавная буква", value.any(Char::isUpperCase)),
        PasswordRequirement("Цифра", value.any(Char::isDigit)),
        PasswordRequirement("Специальный символ", value.any { !it.isLetterOrDigit() }),
    )

    fun isStrongMaster(value: CharSequence): Boolean = masterRequirements(value.toString()).all { it.met }

    fun isStrongMaster(value: CharArray): Boolean =
        value.size >= MIN_MASTER_LENGTH &&
            value.any(Char::isLowerCase) &&
            value.any(Char::isUpperCase) &&
            value.any(Char::isDigit) &&
            value.any { !it.isLetterOrDigit() }

    fun generate(length: Int = 20): String {
        require(length >= MIN_MASTER_LENGTH)
        val chars = mutableListOf(
            LOWER.randomSecure(), UPPER.randomSecure(), DIGITS.randomSecure(), SYMBOLS.randomSecure(),
        )
        repeat(length - chars.size) { chars += all.randomSecure() }
        for (index in chars.lastIndex downTo 1) {
            val other = random.nextInt(index + 1)
            val tmp = chars[index]
            chars[index] = chars[other]
            chars[other] = tmp
        }
        return chars.joinToString("")
    }

    private fun String.randomSecure() = this[random.nextInt(length)]
}
