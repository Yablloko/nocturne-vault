package com.nocturne.vault

import android.content.Context
import android.content.Intent
import android.os.SystemClock
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeFalse
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SafeDebugLogTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Test fun diagnosticsAreOptInBoundedAndClearedWhenDisabled() {
        SafeDebugLog.setEnabled(context, false)
        SafeDebugLog.record(context, "ignored.event", "reason" to "IGNORED")
        assertFalse(SafeDebugLog.report(context).contains("ignored.event"))

        SafeDebugLog.setEnabled(context, true)
        assertTrue(SafeDebugLog.report(context).contains("diagnostics.enabled"))
        repeat(240) { SafeDebugLog.record(context, "test.event", "index" to it) }
        val report = SafeDebugLog.report(context)
        assertTrue(report.contains("test.event"))
        assertTrue(report.contains("entries=200"))

        SafeDebugLog.setEnabled(context, false)
        val cleared = SafeDebugLog.report(context)
        assertTrue(cleared.contains("entries=0"))
        assertFalse(SafeDebugLog.isEnabled(context))
    }

    @Test fun protectedProfileCanAcknowledgeTheExactPendingRequest() {
        // The PendingIntent is created by the personal-side controller and is completed by
        // the managed-profile copy. Running this receiver assertion inside the profile-owner
        // process reverses that production relationship and is therefore not applicable.
        assumeFalse(ProtectedSpaceManager.isProfileOwner(context))
        val (requestId, callback) = ProtectedSpaceDeliveryTracker.begin(context, "test")
        callback.send(
            context,
            0,
            Intent()
                .putExtra(ProtectedSpaceContract.EXTRA_DELIVERY_STAGE, ProtectedSpaceDeliveryTracker.STAGE_OPENED)
                .putExtra(ProtectedSpaceContract.EXTRA_DELIVERY_REASON, ""),
        )
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        val deadline = SystemClock.elapsedRealtime() + 2_000
        var state = ProtectedSpaceDeliveryTracker.snapshot(context)
        while (state?.stage != ProtectedSpaceDeliveryTracker.STAGE_OPENED && SystemClock.elapsedRealtime() < deadline) {
            SystemClock.sleep(50)
            state = ProtectedSpaceDeliveryTracker.snapshot(context)
        }
        assertEquals(requestId, state?.requestId)
        assertEquals(ProtectedSpaceDeliveryTracker.STAGE_OPENED, state?.stage)
        assertEquals("test", state?.operation)
        callback.send(
            context,
            0,
            Intent().putExtra(
                ProtectedSpaceContract.EXTRA_DELIVERY_STAGE,
                ProtectedSpaceDeliveryTracker.STAGE_RECEIVED,
            ),
        )
        SystemClock.sleep(200)
        assertEquals(ProtectedSpaceDeliveryTracker.STAGE_OPENED, ProtectedSpaceDeliveryTracker.snapshot(context)?.stage)
    }

    @Test fun sameProfileCallbackCannotAuthorizePairingRepair() {
        val (requestId, callback) = ProtectedSpaceDeliveryTracker.begin(context, "repair-test")
        val request = ProtectedSpaceContract.attachDeliveryCallback(
            ProtectedSpaceContract.intent(),
            requestId,
            callback,
        )
        assertFalse(ProtectedSpaceContract.hasTrustedPersonalDeliveryCallback(context, request))
        assertFalse(
            ProtectedSpaceContract.hasTrustedPersonalDeliveryCallback(
                context,
                request.putExtra(ProtectedSpaceContract.EXTRA_REQUEST_ID, "not-a-uuid"),
            ),
        )
    }

    @Test fun managedControllerAcknowledgesTheCrossProfileRoute() {
        assumeFalse(ProtectedSpaceManager.isProfileOwner(context))
        assumeTrue(ProtectedSpaceManager.isProvisioned(context))
        assumeTrue(ProtectedSpaceManager.canOpen(context))
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val activity = instrumentation.startActivitySync(
            Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK),
        )
        try {
            val identity = ProtectedSpaceProtocol.createIdentity()
            val (afterRepair, repair) = ProtectedSpaceProtocol.sign(identity, ProtectedSpaceProtocol.ACTION_REPAIR)
            assertTrue(ProtectedSpaceManager.sendRepairCommand(activity, repair).isSuccess)
            val deadline = SystemClock.elapsedRealtime() + 45_000
            var state = ProtectedSpaceDeliveryTracker.snapshot(context)
            while (
                !repairRouteReachedStableState(state) && SystemClock.elapsedRealtime() < deadline
            ) {
                SystemClock.sleep(100)
                state = ProtectedSpaceDeliveryTracker.snapshot(context)
            }
            assertTrue(
                state?.stage in setOf(
                    ProtectedSpaceDeliveryTracker.STAGE_SETUP_REQUIRED,
                    ProtectedSpaceDeliveryTracker.STAGE_REPAIR_READY,
                    ProtectedSpaceDeliveryTracker.STAGE_REPAIRED,
                ),
            )
            if (state?.stage == ProtectedSpaceDeliveryTracker.STAGE_REPAIRED) {
                val (_, lock) = ProtectedSpaceProtocol.sign(afterRepair, ProtectedSpaceProtocol.ACTION_LOCK)
                assertTrue(ProtectedSpaceManager.sendSignedCommand(activity, lock, "lock-test").isSuccess)
                val lockDeadline = SystemClock.elapsedRealtime() + 20_000
                while (
                    ProtectedSpaceDeliveryTracker.snapshot(context)?.stage != ProtectedSpaceDeliveryTracker.STAGE_LOCKED &&
                    SystemClock.elapsedRealtime() < lockDeadline
                ) {
                    SystemClock.sleep(100)
                }
                assertEquals(
                    ProtectedSpaceDeliveryTracker.STAGE_LOCKED,
                    ProtectedSpaceDeliveryTracker.snapshot(context)?.stage,
                )
            }
        } finally {
            activity.finishAndRemoveTask()
        }
    }

    private fun repairRouteReachedStableState(state: ProtectedSpaceDeliveryTracker.State?): Boolean {
        if (state == null) return false
        if (state.stage in setOf(
                ProtectedSpaceDeliveryTracker.STAGE_SETUP_REQUIRED,
                ProtectedSpaceDeliveryTracker.STAGE_REPAIRED,
                ProtectedSpaceDeliveryTracker.STAGE_FAILED,
                ProtectedSpaceDeliveryTracker.STAGE_REJECTED,
            )
        ) return true
        return state.stage == ProtectedSpaceDeliveryTracker.STAGE_REPAIR_READY &&
            !state.reason.startsWith("AUTO_")
    }
}
