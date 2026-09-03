package com.nocturne.vault

import android.app.admin.DevicePolicyManager
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtectedSpaceChallengeStateTest {
    @Test fun requiresRestrictionAndNonUnifiedCredential() {
        assertFalse(state(restriction = false, unified = false, sufficient = true).configured)
        assertFalse(state(restriction = true, unified = true, sufficient = true).configured)
        assertFalse(state(restriction = true, unified = false, sufficient = false).configured)
    }

    @Test fun acceptsEitherOfficialCredentialEvidence() {
        assertTrue(state(restriction = true, unified = false, sufficient = true).configured)
        assertTrue(
            state(
                restriction = true,
                unified = false,
                sufficient = false,
                complexity = DevicePolicyManager.PASSWORD_COMPLEXITY_LOW,
            ).configured,
        )
    }

    @Test fun doesNotTreatASeparateProfileWithoutCredentialEvidenceAsConfigured() {
        assertFalse(state(restriction = true, unified = false, sufficient = false).configured)
        assertFalse(state(restriction = true, unified = true, sufficient = true).configured)
        assertFalse(state(restriction = false, unified = false, sufficient = true).configured)
    }

    private fun state(
        restriction: Boolean,
        unified: Boolean?,
        sufficient: Boolean?,
        complexity: Int? = DevicePolicyManager.PASSWORD_COMPLEXITY_NONE,
    ) = ProtectedSpaceChallengeState(restriction, unified, sufficient, complexity)
}
