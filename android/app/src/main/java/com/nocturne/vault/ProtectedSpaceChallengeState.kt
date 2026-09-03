package com.nocturne.vault

import android.app.admin.DevicePolicyManager

/** A null signal means the OEM API was unavailable while the profile was locked. */
internal data class ProtectedSpaceChallengeState(
    val restrictionEnforced: Boolean,
    val usingUnifiedPassword: Boolean?,
    val activePasswordSufficient: Boolean?,
    val passwordComplexity: Int?,
) {
    val configured: Boolean
        get() = restrictionEnforced &&
            usingUnifiedPassword == false &&
            (
                activePasswordSufficient == true ||
                    passwordComplexity?.let { it != DevicePolicyManager.PASSWORD_COMPLEXITY_NONE } == true
                )

    fun diagnosticCode(): String = buildString {
        append("R").append(restrictionEnforced.bit())
        append("_U").append(usingUnifiedPassword.bit())
        append("_S").append(activePasswordSufficient.bit())
        append("_C").append(passwordComplexity ?: "X")
        append("_OK").append(configured.bit())
    }

    private fun Boolean.bit(): Char = if (this) '1' else '0'
    private fun Boolean?.bit(): Char = when (this) {
        true -> '1'
        false -> '0'
        null -> 'X'
    }
}
