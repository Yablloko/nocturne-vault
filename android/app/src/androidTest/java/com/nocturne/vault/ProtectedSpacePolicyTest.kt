package com.nocturne.vault

import android.app.admin.DevicePolicyManager
import android.app.AlarmManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.UserManager
import android.os.Build
import android.os.SystemClock
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Assume.assumeFalse
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ProtectedSpacePolicyTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Test fun profilePoliciesAndSignedSessionFailClosed() {
        assumeTrue(ProtectedSpaceManager.isProfileOwner(context))
        ProtectedSpacePolicy.apply(context)
        val policy = context.getSystemService(DevicePolicyManager::class.java)
        val admin = ComponentName(context, ProtectedSpaceAdminReceiver::class.java)
        val users = context.getSystemService(UserManager::class.java)
        val requestedPermissions = context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.GET_PERMISSIONS,
        ).requestedPermissions.orEmpty()
        assertTrue(android.Manifest.permission.REQUEST_PASSWORD_COMPLEXITY in requestedPermissions)
        assertTrue(users.hasUserRestriction(UserManager.DISALLOW_UNIFIED_PASSWORD))
        assertTrue(users.hasUserRestriction(UserManager.DISALLOW_SHARE_INTO_MANAGED_PROFILE))
        assertTrue(users.hasUserRestriction(UserManager.DISALLOW_CROSS_PROFILE_COPY_PASTE))
        assertTrue(policy.getScreenCaptureDisabled(admin))
        assertEquals(DevicePolicyManager.PERMISSION_POLICY_AUTO_DENY, policy.getPermissionPolicy(admin))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            assertEquals(DevicePolicyManager.PASSWORD_COMPLEXITY_LOW, policy.requiredPasswordComplexity)
        } else {
            @Suppress("DEPRECATION")
            assertEquals(DevicePolicyManager.PASSWORD_QUALITY_SOMETHING, policy.getPasswordQuality(admin))
        }
        assertTrue(policy.getPermittedCrossProfileNotificationListeners(admin).orEmpty().isEmpty())
        assertEquals(
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
            context.packageManager.getComponentEnabledSetting(ComponentName(context, ProtectedSpaceActivity::class.java)),
        )
        @Suppress("DEPRECATION")
        val controllerInfo = context.packageManager.getActivityInfo(
            ComponentName(context, ProtectedSpaceActivity::class.java),
            PackageManager.MATCH_DISABLED_COMPONENTS,
        )
        assertTrue(controllerInfo.directBootAware)
        assertEquals(
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            context.packageManager.getComponentEnabledSetting(ComponentName(context, MainActivity::class.java)),
        )
        val controller = ProtectedSpaceContract.intent().resolveActivity(context.packageManager)
        assertEquals(context.packageName, controller?.packageName)
        assertEquals(ProtectedSpaceActivity::class.java.name, controller?.className)

        val identity = ProtectedSpaceProtocol.createIdentity()
        ProtectedSpacePolicy.savePublicKey(context, identity.publicKey)
        val (afterOpen, open) = ProtectedSpaceProtocol.sign(identity, ProtectedSpaceProtocol.ACTION_OPEN)
        val openResult = ProtectedSpacePolicy.authorize(context, open)
        if (!ProtectedSpacePolicy.hasSeparateChallenge(context)) {
            assertEquals("SET_SEPARATE_CHALLENGE", openResult.reason)
            assertFalse(ProtectedSpacePolicy.sessionActive(context))
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()) {
            assertEquals("EXACT_LOCK_UNAVAILABLE", openResult.reason)
            assertFalse(ProtectedSpacePolicy.sessionActive(context))
            return
        }
        assertTrue(openResult.accepted)
        assertTrue(ProtectedSpacePolicy.sessionActive(context))
        assertEquals("REPLAYED_COMMAND", ProtectedSpacePolicy.authorize(context, open).reason)

        // lockNow(FLAG_EVICT_CREDENTIAL_ENCRYPTION_KEY) intentionally kills every process in
        // this user, including the instrumentation runner. Verify the same fail-closed state
        // here without evicting the runner; key eviction is covered from the personal profile.
        ProtectedSpacePolicy.prepareClosedState(context)
        assertFalse(ProtectedSpacePolicy.sessionActive(context))

        val (afterReopen, reopen) = ProtectedSpaceProtocol.sign(afterOpen, ProtectedSpaceProtocol.ACTION_OPEN)
        assertTrue(ProtectedSpacePolicy.authorize(context, reopen).accepted)

        val (_, lock) = ProtectedSpaceProtocol.sign(afterReopen, ProtectedSpaceProtocol.ACTION_LOCK)
        assertEquals("INVALID_SIGNATURE", ProtectedSpacePolicy.authorize(context, lock.copy(packageName = "tampered")).reason)

        // A direct launch without a signed command must close the existing session. Do not wait
        // for global UI idleness: Compose deliberately has long-lived effects and never becomes
        // globally idle on several OEM builds.
        context.startActivity(Intent(context, ProtectedSpaceActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val directLaunchDeadline = SystemClock.elapsedRealtime() + 5_000
        while (ProtectedSpacePolicy.sessionActive(context) && SystemClock.elapsedRealtime() < directLaunchDeadline) {
            SystemClock.sleep(50)
        }
        assertFalse(ProtectedSpacePolicy.sessionActive(context))
    }

    @Test fun trustedPersonalRepairReplacesKeyAndCannotBeReplayed() {
        assumeTrue(ProtectedSpaceManager.isProfileOwner(context))
        ProtectedSpacePolicy.apply(context)
        val replacement = ProtectedSpaceProtocol.createIdentity()
        val (_, repair) = ProtectedSpaceProtocol.sign(
            replacement,
            ProtectedSpaceProtocol.ACTION_REPAIR,
        )
        assertEquals("REPAIR_AUTHENTICATION_REQUIRED", ProtectedSpacePolicy.authorize(context, repair).reason)
        val repaired = ProtectedSpacePolicy.authorizeRepairFromTrustedPersonalProfile(context, repair)
        if (!ProtectedSpacePolicy.hasSeparateChallenge(context)) {
            assertEquals("SET_SEPARATE_CHALLENGE", repaired.reason)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()) {
            assertEquals("EXACT_LOCK_UNAVAILABLE", repaired.reason)
        } else {
            assertTrue(repaired.accepted)
            assertEquals("REPLAYED_COMMAND", ProtectedSpacePolicy.authorizeRepairFromTrustedPersonalProfile(context, repair).reason)
            ProtectedSpacePolicy.prepareClosedState(context)
            assertFalse(ProtectedSpacePolicy.sessionActive(context))
        }
    }

    @Test fun personalAppCanResolveProtectedProfileController() {
        assumeFalse(ProtectedSpaceManager.isProfileOwner(context))
        assumeTrue(ProtectedSpaceManager.isProvisioned(context))
        assertTrue(ProtectedSpaceManager.canOpen(context))
    }

    @Test fun hiddenGuestRemainsDiscoverableAfterRepeatedPolicyApplication() {
        assumeTrue(ProtectedSpaceManager.isProfileOwner(context))
        val guestPackage = "com.nocturne.vault"
        val policy = context.getSystemService(DevicePolicyManager::class.java)
        val admin = ComponentName(context, ProtectedSpaceAdminReceiver::class.java)
        val candidateExists = runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.packageManager.getApplicationInfo(
                    guestPackage,
                    PackageManager.ApplicationInfoFlags.of(PackageManager.MATCH_UNINSTALLED_PACKAGES.toLong()),
                )
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getApplicationInfo(guestPackage, PackageManager.MATCH_UNINSTALLED_PACKAGES)
            }
        }.isSuccess
        assumeTrue(candidateExists)
        policy.setApplicationHidden(admin, guestPackage, false)
        policy.setPackagesSuspended(admin, arrayOf(guestPackage), false)
        ProtectedSpacePolicy.apply(context)
        assertTrue(policy.isApplicationHidden(admin, guestPackage))
        assertTrue(ProtectedSpacePolicy.guestApps(context).any { it.packageName == guestPackage })
        ProtectedSpacePolicy.apply(context)
        assertTrue(ProtectedSpacePolicy.guestApps(context).any { it.packageName == guestPackage })
        ProtectedSpacePolicy.apply(context)
        assertTrue(policy.isApplicationHidden(admin, guestPackage))
        assertTrue(ProtectedSpacePolicy.guestApps(context).any { it.packageName == guestPackage })
    }

    @Test fun systemSupportAppsAreIsolatedWhileClosed() {
        assumeTrue(ProtectedSpaceManager.isProfileOwner(context))
        val policy = context.getSystemService(DevicePolicyManager::class.java)
        val admin = ComponentName(context, ProtectedSpaceAdminReceiver::class.java)
        val candidate = listOf("com.android.vending", "com.google.android.contacts", "com.google.android.documentsui")
            .firstOrNull { packageName ->
                runCatching {
                    val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        context.packageManager.getApplicationInfo(
                            packageName,
                            PackageManager.ApplicationInfoFlags.of(PackageManager.MATCH_UNINSTALLED_PACKAGES.toLong()),
                        )
                    } else {
                        @Suppress("DEPRECATION")
                        context.packageManager.getApplicationInfo(packageName, PackageManager.MATCH_UNINSTALLED_PACKAGES)
                    }
                    info.flags and android.content.pm.ApplicationInfo.FLAG_SYSTEM != 0
                }.getOrDefault(false)
            }
        assumeTrue(candidate != null)
        policy.setApplicationHidden(admin, candidate!!, false)
        ProtectedSpacePolicy.prepareClosedState(context)
        assertTrue(
            policy.isApplicationHidden(admin, candidate) ||
                policy.isPackageSuspended(admin, candidate),
        )
        assertFalse(policy.isApplicationHidden(admin, "com.android.settings"))
    }

    @Test fun personalAppCanReadProtectedProfilePauseState() {
        assumeFalse(ProtectedSpaceManager.isProfileOwner(context))
        assumeTrue(ProtectedSpaceManager.isProvisioned(context))
        assertEquals(
            context.getSystemService(android.os.UserManager::class.java).isQuietModeEnabled(
                context.getSystemService(android.content.pm.CrossProfileApps::class.java).targetUserProfiles.first(),
            ),
            ProtectedSpaceManager.isPaused(context),
        )
    }
}
