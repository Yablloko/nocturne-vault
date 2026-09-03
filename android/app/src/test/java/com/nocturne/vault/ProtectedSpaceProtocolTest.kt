package com.nocturne.vault

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtectedSpaceProtocolTest {
    @Test fun backupIdentityMustContainAMatchingKeyPair() {
        val identity = ProtectedSpaceProtocol.createIdentity()
        val other = ProtectedSpaceProtocol.createIdentity()
        assertTrue(ProtectedSpaceProtocol.isValidIdentity(identity))
        assertFalse(ProtectedSpaceProtocol.isValidIdentity(identity.copy(privateKey = other.privateKey)))
        assertFalse(ProtectedSpaceProtocol.isValidIdentity(identity.copy(counter = -1)))
        assertFalse(ProtectedSpaceProtocol.isValidIdentity(identity.copy(privateKey = "not-a-private-key")))
    }

    @Test fun protectedLaunchRequiresAClosingSafetyWindow() {
        assertFalse(ProtectedSpacePolicy.hasLaunchBudget(4_999))
        assertTrue(ProtectedSpacePolicy.hasLaunchBudget(5_000))
    }

    private val now = 1_800_000_000_000L

    @Test fun validCommandIsAcceptedOnce() {
        val identity = ProtectedSpaceProtocol.createIdentity()
        val (_, command) = ProtectedSpaceProtocol.sign(identity, ProtectedSpaceProtocol.ACTION_OPEN, now = now)
        assertTrue(ProtectedSpaceProtocol.verify(command, identity.publicKey, 0, now).accepted)
        assertEquals("REPLAYED_COMMAND", ProtectedSpaceProtocol.verify(command, identity.publicKey, command.counter, now).reason)
    }

    @Test fun tamperedCommandIsRejected() {
        val identity = ProtectedSpaceProtocol.createIdentity()
        val (_, command) = ProtectedSpaceProtocol.sign(identity, ProtectedSpaceProtocol.ACTION_OPEN, "safe.app", now)
        val result = ProtectedSpaceProtocol.verify(command.copy(packageName = "evil.app"), identity.publicKey, 0, now)
        assertFalse(result.accepted)
        assertEquals("INVALID_SIGNATURE", result.reason)
    }

    @Test fun wrongKeyIsRejected() {
        val identity = ProtectedSpaceProtocol.createIdentity()
        val other = ProtectedSpaceProtocol.createIdentity()
        val (_, command) = ProtectedSpaceProtocol.sign(identity, ProtectedSpaceProtocol.ACTION_LOCK, now = now)
        assertEquals("INVALID_SIGNATURE", ProtectedSpaceProtocol.verify(command, other.publicKey, 0, now).reason)
    }

    @Test fun expiredAndFutureCommandsAreRejected() {
        val identity = ProtectedSpaceProtocol.createIdentity()
        val (_, expired) = ProtectedSpaceProtocol.sign(identity, ProtectedSpaceProtocol.ACTION_OPEN, now = now)
        assertEquals("EXPIRED_COMMAND", ProtectedSpaceProtocol.verify(expired, identity.publicKey, 0, now + ProtectedSpaceProtocol.COMMAND_TTL_MS + 1).reason)
        val (_, future) = ProtectedSpaceProtocol.sign(identity, ProtectedSpaceProtocol.ACTION_OPEN, now = now + ProtectedSpaceProtocol.CLOCK_SKEW_MS + 1)
        assertEquals("COMMAND_FROM_FUTURE", ProtectedSpaceProtocol.verify(future, identity.publicKey, 0, now).reason)
    }

    @Test fun actionAndSessionBoundsAreEnforcedBeforeSignature() {
        val identity = ProtectedSpaceProtocol.createIdentity()
        val (_, command) = ProtectedSpaceProtocol.sign(identity, ProtectedSpaceProtocol.ACTION_OPEN, now = now)
        assertEquals("INVALID_ACTION", ProtectedSpaceProtocol.verify(command.copy(action = "WIPE"), identity.publicKey, 0, now).reason)
        assertEquals("INVALID_SESSION", ProtectedSpaceProtocol.verify(command.copy(sessionUntil = now + ProtectedSpaceProtocol.MAX_SESSION_MS + 1), identity.publicKey, 0, now).reason)
    }

    @Test fun repairCommandProvesPossessionOfReplacementKey() {
        val replacement = ProtectedSpaceProtocol.createIdentity()
        val (_, command) = ProtectedSpaceProtocol.sign(
            replacement,
            ProtectedSpaceProtocol.ACTION_REPAIR,
            now = now,
        )
        assertTrue(ProtectedSpaceProtocol.verifyRepair(command, now).accepted)
        assertEquals("INVALID_SIGNATURE", ProtectedSpaceProtocol.verifyRepair(command.copy(pairingKey = ProtectedSpaceProtocol.createIdentity().publicKey), now).reason)
        assertEquals("INVALID_ACTION", ProtectedSpaceProtocol.verify(command, replacement.publicKey, 0, now).reason)
        assertEquals("INVALID_SESSION", ProtectedSpaceProtocol.verifyRepair(command.copy(sessionUntil = now + 1), now).reason)
    }

    @Test fun repairAllowsChallengeSetupWindowButStillExpires() {
        val replacement = ProtectedSpaceProtocol.createIdentity()
        val (_, command) = ProtectedSpaceProtocol.sign(
            replacement,
            ProtectedSpaceProtocol.ACTION_REPAIR,
            now = now,
        )
        assertTrue(ProtectedSpaceProtocol.verifyRepair(command, now + ProtectedSpaceProtocol.COMMAND_TTL_MS + 1).accepted)
        assertEquals(
            "EXPIRED_COMMAND",
            ProtectedSpaceProtocol.verifyRepair(command, now + ProtectedSpaceProtocol.REPAIR_COMMAND_TTL_MS + 1).reason,
        )
    }
}
