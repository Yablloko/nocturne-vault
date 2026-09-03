package com.nocturne.vault

import android.content.Intent
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtectedSpaceLifecycleReceiverTest {
    @Test fun userUnlockDoesNotImmediatelyRelockProfile() {
        assertFalse(protectedSpaceLifecycleResetsSession(Intent.ACTION_USER_UNLOCKED))
    }

    @Test fun packageInstallDoesNotDestroyAuthenticatedFlow() {
        assertFalse(protectedSpaceLifecycleResetsSession(Intent.ACTION_PACKAGE_ADDED))
        assertFalse(protectedSpaceLifecycleResetsSession(Intent.ACTION_PACKAGE_REPLACED))
        assertFalse(protectedSpaceLifecycleResetsSession(Intent.ACTION_PACKAGE_CHANGED))
    }

    @Test fun lockedBootAndControllerUpdateStartClosed() {
        assertTrue(protectedSpaceLifecycleResetsSession(Intent.ACTION_LOCKED_BOOT_COMPLETED))
        assertTrue(protectedSpaceLifecycleResetsSession(Intent.ACTION_MY_PACKAGE_REPLACED))
    }

    @Test fun bootCompletedAfterCredentialUnlockDoesNotRaceTheOpenCommand() {
        assertFalse(protectedSpaceLifecycleResetsSession(Intent.ACTION_BOOT_COMPLETED))
    }
}
