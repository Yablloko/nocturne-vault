package com.nocturne.vault

import android.app.AlarmManager
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import android.os.UserManager
import android.view.inputmethod.InputMethod
import androidx.annotation.RequiresApi

internal object ProtectedSpacePolicy {
    private const val PREFS = "protected_space_state"
    private const val PUBLIC_KEY = "public_key"
    private const val LAST_COUNTER = "last_counter"
    private const val LAST_REPAIR_NONCE = "last_repair_nonce"
    private const val SESSION_UNTIL_ELAPSED = "session_until_elapsed"
    private const val GUEST_PACKAGES = "guest_packages"
    private const val LAUNCHABLE_GUEST_PACKAGES = "launchable_guest_packages"
    private const val PROFILE_ACTIVATED = "profile_activated"
    private const val POLICY_VERSION = "policy_version"
    private const val CLOSED_POLICY_APPLIED = "closed_policy_applied"
    private const val LEGACY_CHALLENGE_CONFIRMED = "challenge_confirmed"
    private const val CURRENT_POLICY_VERSION = 10
    private const val LOCK_REQUEST = 7126
    private const val MIN_LAUNCH_REMAINING_MS = 5_000L
    private val controlledSystemPackages = setOf(
        "com.android.vending",
        "com.huawei.appmarket",
        "com.sec.android.app.samsungapps",
        "com.google.android.contacts",
        "com.google.android.documentsui",
        "com.android.documentsui",
        "com.android.providers.downloads.ui",
    )
    private val knownSystemInputMethods = setOf(
        "com.google.android.inputmethod.latin",
        "com.samsung.android.honeyboard",
        "com.huawei.ohos.inputmethod",
        "com.baidu.input_huawei",
    )

    private fun storage(context: Context) = context.createDeviceProtectedStorageContext()
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun admin(context: Context) = ComponentName(context, ProtectedSpaceAdminReceiver::class.java)
    private fun manager(context: Context) = context.getSystemService(DevicePolicyManager::class.java)

    fun savePublicKey(context: Context, value: String) {
        require(ProtectedSpaceProtocol.isValidPublicKey(value)) { "INVALID_PAIRING_KEY" }
        check(storage(context).edit().putString(PUBLIC_KEY, value).putLong(LAST_COUNTER, 0).commit()) { "PAIRING_KEY_NOT_PERSISTED" }
    }

    fun apply(context: Context, keepPackage: String? = null) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        val policy = manager(context)
        if (!policy.isProfileOwnerApp(context.packageName)) return
        val receiver = admin(context)
        val preferences = storage(context)
        if (preferences.getInt(POLICY_VERSION, 0) < CURRENT_POLICY_VERSION) {
            policyStep("PASSWORD") {
                prepareSeparateChallengeSetup(context)
                policy.setMaximumTimeToLock(receiver, if (hasSeparateChallenge(context)) ProtectedSpaceProtocol.MAX_SESSION_MS else 0)
                policy.setKeyguardDisabledFeatures(
                    receiver,
                    DevicePolicyManager.KEYGUARD_DISABLE_FINGERPRINT or
                        DevicePolicyManager.KEYGUARD_DISABLE_FACE or
                        DevicePolicyManager.KEYGUARD_DISABLE_IRIS or
                        DevicePolicyManager.KEYGUARD_DISABLE_TRUST_AGENTS,
                )
            }
            policyStep("PROFILE_BRIDGES") {
                policy.addUserRestriction(receiver, UserManager.DISALLOW_SHARE_INTO_MANAGED_PROFILE)
                policy.addUserRestriction(receiver, UserManager.DISALLOW_CROSS_PROFILE_COPY_PASTE)
                policy.setCrossProfileCallerIdDisabled(receiver, true)
                policy.setCrossProfileContactsSearchDisabled(receiver, true)
                policy.setBluetoothContactSharingDisabled(receiver, true)
                check(policy.setPermittedCrossProfileNotificationListeners(receiver, emptyList())) { "NOTIFICATION_FILTER_REJECTED" }
                policy.clearCrossProfileIntentFilters(receiver)
                policy.addCrossProfileIntentFilter(
                    receiver,
                    IntentFilter(Intent.ACTION_MAIN).apply {
                        addCategory(ProtectedSpaceContract.CATEGORY_CONTROL)
                        addCategory(Intent.CATEGORY_DEFAULT)
                    },
                    DevicePolicyManager.FLAG_MANAGED_CAN_ACCESS_PARENT,
                )
                policy.addCrossProfileIntentFilter(
                    receiver,
                    IntentFilter(ProtectedSpaceContract.ACTION_CONTROL).apply { addCategory(Intent.CATEGORY_DEFAULT) },
                    DevicePolicyManager.FLAG_MANAGED_CAN_ACCESS_PARENT,
                )
            }
            policyStep("PRIVACY") {
                policy.setScreenCaptureDisabled(receiver, true)
                policy.setPermissionPolicy(receiver, DevicePolicyManager.PERMISSION_POLICY_AUTO_DENY)
                val trustedInputMethods = systemInputMethodPackages(context).toList()
                check(policy.setPermittedInputMethods(receiver, trustedInputMethods)) { "INPUT_METHOD_FILTER_REJECTED" }
            }
            policyStep("ESSENTIAL_APPS") { restoreEssentialPackages(context) }
            check(
                preferences.edit()
                    .remove(LEGACY_CHALLENGE_CONFIRMED)
                    .putInt(POLICY_VERSION, CURRENT_POLICY_VERSION)
                    .commit(),
            ) { "POLICY_VERSION_NOT_PERSISTED" }
        }
        // Component overrides can be reset by OEM package managers during an APK update. Keep the
        // personal launcher disabled and the private controller enabled on every policy pass.
        policyStep("CONTROLLER") { ProtectedSpaceManager.configureControllerActivity(context) }
        policyStep("GUEST_APPS") { suspendGuests(context, except = keepPackage) }
    }

    fun prepareSeparateChallengeSetup(context: Context) {
        check(Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) { "ANDROID_UNSUPPORTED" }
        val policy = manager(context)
        val receiver = admin(context)
        check(policy.isProfileOwnerApp(context.packageName)) { "NOT_PROFILE_OWNER" }
        policy.addUserRestriction(receiver, UserManager.DISALLOW_UNIFIED_PASSWORD)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            policy.requiredPasswordComplexity = DevicePolicyManager.PASSWORD_COMPLEXITY_LOW
        } else {
            @Suppress("DEPRECATION")
            policy.setPasswordQuality(receiver, DevicePolicyManager.PASSWORD_QUALITY_SOMETHING)
        }
    }

    fun completeProvisioning(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        val policy = manager(context)
        check(policy.isProfileOwnerApp(context.packageName)) { "NOT_PROFILE_OWNER" }
        apply(context)
        policy.setProfileName(admin(context), "Nocturne")
        val preferences = storage(context)
        if (!preferences.getBoolean(PROFILE_ACTIVATED, false)) {
            policy.setProfileEnabled(admin(context))
            check(preferences.edit().putBoolean(PROFILE_ACTIVATED, true).commit()) { "PROFILE_STATE_NOT_PERSISTED" }
        }
    }

    fun authorize(
        context: Context,
        command: ProtectedSpaceCommand,
        beforeLockEviction: () -> Unit = {},
    ): ProtectedSpaceVerification {
        if (command.action == ProtectedSpaceProtocol.ACTION_REPAIR) {
            return ProtectedSpaceVerification(false, "REPAIR_AUTHENTICATION_REQUIRED")
        }
        val preferences = storage(context)
        val key = preferences.getString(PUBLIC_KEY, null) ?: return ProtectedSpaceVerification(false, "PROFILE_NOT_PAIRED")
        val result = ProtectedSpaceProtocol.verify(command, key, preferences.getLong(LAST_COUNTER, 0))
        if (!result.accepted) return result
        check(preferences.edit().putLong(LAST_COUNTER, command.counter).commit()) { "COUNTER_NOT_PERSISTED" }
        if (command.action == ProtectedSpaceProtocol.ACTION_LOCK) {
            lockAndEvict(context, beforeLockEviction)
        } else return openSession(context, command.sessionUntil, result)
        return result
    }

    /** Verifies a signed command before Android shows the work-profile credential prompt. */
    fun verifyCommand(context: Context, command: ProtectedSpaceCommand): ProtectedSpaceVerification {
        if (command.action == ProtectedSpaceProtocol.ACTION_REPAIR) {
            return ProtectedSpaceVerification(false, "REPAIR_AUTHENTICATION_REQUIRED")
        }
        val preferences = storage(context)
        val key = preferences.getString(PUBLIC_KEY, null)
            ?: return ProtectedSpaceVerification(false, "PROFILE_NOT_PAIRED")
        return ProtectedSpaceProtocol.verify(command, key, preferences.getLong(LAST_COUNTER, 0))
    }

    /**
     * Replaces the pairing key only for a short-lived request delivered by the authenticated
     * personal-profile Nocturne instance. ProtectedSpaceActivity verifies the cross-profile
     * PendingIntent capability before calling this method. Android still requires a configured,
     * non-unified work challenge and unlocks the profile itself when its credential key is evicted.
     */
    fun authorizeRepairFromTrustedPersonalProfile(
        context: Context,
        command: ProtectedSpaceCommand,
        now: Long = System.currentTimeMillis(),
    ): ProtectedSpaceVerification {
        check(ProtectedSpaceManager.isProfileOwner(context)) { "NOT_PROFILE_OWNER" }
        if (!hasSeparateChallenge(context)) return ProtectedSpaceVerification(false, "SET_SEPARATE_CHALLENGE")
        val preferences = storage(context)
        if (preferences.getString(LAST_REPAIR_NONCE, null) == command.nonce) {
            return ProtectedSpaceVerification(false, "REPLAYED_COMMAND")
        }
        val verified = ProtectedSpaceProtocol.verifyRepair(command, now)
        if (!verified.accepted) return verified
        if (!preciseLockAllowed(context)) return ProtectedSpaceVerification(false, "EXACT_LOCK_UNAVAILABLE")
        val paired = preferences.edit()
            .putString(PUBLIC_KEY, command.pairingKey)
            .putLong(LAST_COUNTER, command.counter)
            .putString(LAST_REPAIR_NONCE, command.nonce)
            .commit()
        check(paired) { "PAIRING_NOT_PERSISTED" }
        return openSession(context, Math.addExact(now, ProtectedSpaceProtocol.MAX_SESSION_MS), verified)
    }

    private fun openSession(
        context: Context,
        sessionUntil: Long,
        accepted: ProtectedSpaceVerification,
    ): ProtectedSpaceVerification {
        val preferences = storage(context)
        if (!hasSeparateChallenge(context)) {
            preferences.edit().putLong(SESSION_UNTIL_ELAPSED, 0).commit()
            runCatching { suspendGuests(context) }
            return ProtectedSpaceVerification(false, "SET_SEPARATE_CHALLENGE")
        }
        manager(context).setMaximumTimeToLock(admin(context), ProtectedSpaceProtocol.MAX_SESSION_MS)
        val remaining = (sessionUntil - System.currentTimeMillis()).coerceIn(0L, ProtectedSpaceProtocol.MAX_SESSION_MS)
        val sessionUntilElapsed = Math.addExact(SystemClock.elapsedRealtime(), remaining)
        val scheduled = runCatching { scheduleLock(context, sessionUntilElapsed) }
        if (scheduled.isFailure) {
            preferences.edit().putLong(SESSION_UNTIL_ELAPSED, 0).commit()
            runCatching { suspendGuests(context) }
            return ProtectedSpaceVerification(false, "EXACT_LOCK_UNAVAILABLE")
        }
        if (!preferences.edit().putLong(SESSION_UNTIL_ELAPSED, sessionUntilElapsed).commit()) {
            cancelLock(context)
            runCatching { suspendGuests(context) }
            return ProtectedSpaceVerification(false, "SESSION_NOT_PERSISTED")
        }
        return accepted
    }

    fun sessionActive(context: Context): Boolean {
        return sessionRemainingMs(context) > 0
    }

    fun sessionRemainingMs(context: Context): Long = (storage(context).getLong(SESSION_UNTIL_ELAPSED, 0) - SystemClock.elapsedRealtime())
        .coerceAtLeast(0)

    internal fun hasLaunchBudget(remainingMs: Long): Boolean = remainingMs >= MIN_LAUNCH_REMAINING_MS

    fun hasSeparateChallenge(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false
        return challengeStateOnAndroid11(context).configured
    }

    fun challengeDiagnosticCode(context: Context): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return "ANDROID_UNSUPPORTED"
        return challengeStateOnAndroid11(context).diagnosticCode()
    }

    fun preciseLockAllowed(context: Context): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
        context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

    @Suppress("DEPRECATION")
    private fun installedGuestApps(context: Context): List<ApplicationInfo> {
        val launchablePackages = launcherPackages(context)
        return (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.packageManager.getInstalledApplications(
            PackageManager.ApplicationInfoFlags.of(
                (PackageManager.MATCH_DISABLED_COMPONENTS or PackageManager.MATCH_UNINSTALLED_PACKAGES).toLong(),
            ),
        )
    } else {
        context.packageManager.getInstalledApplications(PackageManager.MATCH_DISABLED_COMPONENTS or PackageManager.MATCH_UNINSTALLED_PACKAGES)
        })
            .asSequence()
            .filter { applicationInfo(context, it.packageName) != null }
            .filter { it.flags and ApplicationInfo.FLAG_SYSTEM == 0 || it.packageName in launchablePackages }
            .distinctBy { it.packageName }
            .toList()
    }

    @Suppress("DEPRECATION")
    private fun applicationInfo(context: Context, packageName: String): ApplicationInfo? = runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.packageManager.getApplicationInfo(
                packageName,
                PackageManager.ApplicationInfoFlags.of(
                    (PackageManager.MATCH_DISABLED_COMPONENTS or PackageManager.MATCH_UNINSTALLED_PACKAGES).toLong(),
                ),
            )
        } else {
            context.packageManager.getApplicationInfo(
                packageName,
                PackageManager.MATCH_DISABLED_COMPONENTS or PackageManager.MATCH_UNINSTALLED_PACKAGES,
            )
        }
    }.getOrNull()?.takeIf {
        val installedHere = it.flags and ApplicationInfo.FLAG_INSTALLED != 0
        val hiddenHere = runCatching { manager(context).isApplicationHidden(admin(context), it.packageName) }.getOrDefault(false)
        it.packageName !in excludedGuestPackages(context) && (installedHere || hiddenHere)
    }

    @Suppress("DEPRECATION")
    private fun launcherPackages(context: Context): Set<String> {
        val request = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val flags = PackageManager.MATCH_DISABLED_COMPONENTS or PackageManager.MATCH_UNINSTALLED_PACKAGES
        val matches = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.packageManager.queryIntentActivities(request, PackageManager.ResolveInfoFlags.of(flags.toLong()))
        } else {
            context.packageManager.queryIntentActivities(request, flags)
        }
        return matches.mapTo(linkedSetOf()) { it.activityInfo.packageName }
    }

    @Suppress("DEPRECATION")
    private fun excludedGuestPackages(context: Context): Set<String> = buildSet {
        add(context.packageName)
        add("com.android.settings")
        addAll(systemInputMethodPackages(context))
        if (BuildConfig.DEBUG) {
            val instrumentation = context.packageManager.queryInstrumentation(context.packageName, 0)
            instrumentation.mapTo(this) { it.packageName }
        }
    }

    private fun refreshGuestInventory(context: Context): Pair<Set<String>, Set<String>> {
        val preferences = storage(context)
        val installed = installedGuestApps(context)
        val explicitSystemApps = controlledSystemPackages.filter { applicationInfo(context, it) != null }
        val known = (preferences.getStringSet(GUEST_PACKAGES, emptySet()).orEmpty() +
            installed.map { it.packageName } + explicitSystemApps)
            .filterTo(linkedSetOf()) { applicationInfo(context, it) != null }
        val launchable = (preferences.getStringSet(LAUNCHABLE_GUEST_PACKAGES, emptySet()).orEmpty() +
            installed.filter { guestLaunchIntent(context, it.packageName) != null }.map { it.packageName })
            .filterTo(linkedSetOf()) { it in known }
        check(preferences.edit()
            .putStringSet(GUEST_PACKAGES, known)
            .putStringSet(LAUNCHABLE_GUEST_PACKAGES, launchable)
            .commit()) { "GUEST_INVENTORY_NOT_PERSISTED" }
        return known to launchable
    }

    fun guestApps(context: Context): List<ApplicationInfo> = refreshGuestInventory(context).second
        .asSequence()
        .mapNotNull { applicationInfo(context, it) }
        .filter { it.flags and ApplicationInfo.FLAG_SYSTEM == 0 }
        .sortedBy { context.packageManager.getApplicationLabel(it).toString().lowercase() }
        .toList()

    fun launch(context: Context, packageName: String) {
        check(hasSeparateChallenge(context)) { "SET_SEPARATE_CHALLENGE" }
        check(hasLaunchBudget(sessionRemainingMs(context))) { "SESSION_EXPIRING" }
        val allowed = guestApps(context).mapTo(HashSet()) { it.packageName }
        require(packageName in allowed) { "APP_NOT_ALLOWED" }
        launchManagedPackage(context, packageName)
    }

    fun launchInstaller(context: Context): String {
        check(hasSeparateChallenge(context)) { "SET_SEPARATE_CHALLENGE" }
        check(hasLaunchBudget(sessionRemainingMs(context))) { "SESSION_EXPIRING" }
        val all = refreshGuestInventory(context).first
        val packageName = listOf("com.android.vending", "com.huawei.appmarket", "com.sec.android.app.samsungapps")
            .firstOrNull { it in all && applicationInfo(context, it) != null }
            ?: error("WORK_STORE_UNAVAILABLE")
        launchManagedPackage(context, packageName)
        return packageName
    }

    private fun launchManagedPackage(context: Context, packageName: String) {
        try {
            suspendGuests(context, except = packageName)
            if (!hasLaunchBudget(sessionRemainingMs(context))) {
                lockAndEvict(context)
                error("SESSION_EXPIRING")
            }
            val intent = guestLaunchIntent(context, packageName) ?: error("APP_NOT_LAUNCHABLE")
            if (!hasLaunchBudget(sessionRemainingMs(context))) {
                lockAndEvict(context)
                error("SESSION_EXPIRING")
            }
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (failure: Throwable) {
            runCatching { lockAndEvict(context) }
            throw failure
        }
    }

    fun suspendGuests(context: Context, except: String? = null) {
        val policy = manager(context)
        if (!policy.isProfileOwnerApp(context.packageName)) return
        val (all, launchable) = refreshGuestInventory(context)
        val suspend = all.filterNot { it == except }
        if (suspend.isNotEmpty()) {
            val hidden = suspend.associateWith {
                runCatching { setApplicationHidden(policy, context, it, true) }.getOrDefault(false)
            }
            // Some OEMs reject hiding one of their own system packages. Suspension is the
            // supported secondary isolation mechanism; a user-launchable package must satisfy at
            // least one of the two before the closed state is accepted.
            runCatching { policy.setPackagesSuspended(admin(context), suspend.toTypedArray(), true) }
            val isolationFailures = suspend.filter { packageName ->
                if (packageName !in launchable || hidden[packageName] == true) return@filter false
                !runCatching { policy.isPackageSuspended(admin(context), packageName) }.getOrDefault(false)
            }.toSet()
            check(isolationFailures.isEmpty()) {
                "APP_ISOLATION_FAILED:${isolationFailures.joinToString(",")}"
            }
        }
        if (except != null) {
            check(except in all) { "APP_NOT_MANAGED" }
            check(setApplicationHidden(policy, context, except, false)) { "APP_UNHIDING_FAILED:$except" }
            val failures = policy.setPackagesSuspended(admin(context), arrayOf(except), false)
            check(failures.isEmpty()) { "APP_UNSUSPENSION_FAILED:${failures.joinToString(",")}" }
        }
        check(storage(context).edit().putBoolean(CLOSED_POLICY_APPLIED, except == null).commit()) { "CLOSED_STATE_NOT_PERSISTED" }
    }

    fun lockAndEvict(context: Context, beforeCredentialEviction: () -> Unit = {}) {
        val policy = manager(context)
        if (!policy.isProfileOwnerApp(context.packageName)) return
        suspendGuests(context)
        check(storage(context).edit().putLong(SESSION_UNTIL_ELAPSED, 0).commit()) { "SESSION_NOT_CLOSED" }
        cancelLock(context)
        beforeCredentialEviction()
        if (hasSeparateChallenge(context)) policy.lockNow(DevicePolicyManager.FLAG_EVICT_CREDENTIAL_ENCRYPTION_KEY)
    }

    fun prepareClosedState(context: Context) {
        val policy = manager(context)
        if (!policy.isProfileOwnerApp(context.packageName)) return
        val preferences = storage(context)
        if (!preferences.getBoolean(CLOSED_POLICY_APPLIED, false) || !closedPolicyStillApplied(context)) {
            suspendGuests(context)
        }
        check(storage(context).edit().putLong(SESSION_UNTIL_ELAPSED, 0).commit()) { "SESSION_NOT_CLOSED" }
        cancelLock(context)
    }

    private fun closedPolicyStillApplied(context: Context): Boolean {
        val policy = manager(context)
        val launchable = storage(context).getStringSet(LAUNCHABLE_GUEST_PACKAGES, emptySet()).orEmpty()
        return launchable.all { packageName ->
            packageName in excludedGuestPackages(context) ||
                runCatching { policy.isApplicationHidden(admin(context), packageName) }.getOrDefault(false)
        }
    }

    private fun scheduleLock(context: Context, whenElapsed: Long) {
        val alarm = context.getSystemService(AlarmManager::class.java)
        val pending = lockPendingIntent(context)
        check(preciseLockAllowed(context)) { "EXACT_ALARM_UNAVAILABLE" }
        alarm.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, whenElapsed, pending)
    }

    private fun cancelLock(context: Context) = context.getSystemService(AlarmManager::class.java).cancel(lockPendingIntent(context))

    private fun lockPendingIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context,
        LOCK_REQUEST,
        Intent(context, ProtectedSpaceLockReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    @RequiresApi(Build.VERSION_CODES.R)
    private fun challengeStateOnAndroid11(context: Context): ProtectedSpaceChallengeState {
        val policy = manager(context)
        val receiver = admin(context)
        val restriction = runCatching {
            context.getSystemService(UserManager::class.java)
                .hasUserRestriction(UserManager.DISALLOW_UNIFIED_PASSWORD)
        }.getOrDefault(false)
        val unified = runCatching { policy.isUsingUnifiedPassword(receiver) }.getOrNull()
        val sufficient = runCatching { policy.isActivePasswordSufficient }.getOrNull()
        val complexity = runCatching { policy.passwordComplexity }.getOrNull()
        return ProtectedSpaceChallengeState(restriction, unified, sufficient, complexity)
    }

    private fun setApplicationHidden(
        policy: DevicePolicyManager,
        context: Context,
        packageName: String,
        hidden: Boolean,
    ): Boolean {
        val receiver = admin(context)
        return policy.isApplicationHidden(receiver, packageName) == hidden ||
            policy.setApplicationHidden(receiver, packageName, hidden)
    }

    @Suppress("DEPRECATION")
    private fun systemInputMethodPackages(context: Context): Set<String> {
        val flags = PackageManager.MATCH_DISABLED_COMPONENTS or PackageManager.MATCH_UNINSTALLED_PACKAGES
        val services = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.packageManager.queryIntentServices(
                Intent(InputMethod.SERVICE_INTERFACE),
                PackageManager.ResolveInfoFlags.of(flags.toLong()),
            )
        } else {
            context.packageManager.queryIntentServices(Intent(InputMethod.SERVICE_INTERFACE), flags)
        }
        return (services.asSequence()
            .map { it.serviceInfo.applicationInfo }
            .filter { it.flags and ApplicationInfo.FLAG_SYSTEM != 0 }
            .map { it.packageName } + knownSystemInputMethods.asSequence().filter { packageName ->
                applicationInfoForEssentialPackage(context, packageName)?.flags?.and(ApplicationInfo.FLAG_SYSTEM) != 0
            }).toCollection(linkedSetOf())
    }

    @Suppress("DEPRECATION")
    private fun applicationInfoForEssentialPackage(context: Context, packageName: String): ApplicationInfo? = runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.packageManager.getApplicationInfo(
                packageName,
                PackageManager.ApplicationInfoFlags.of(
                    (PackageManager.MATCH_DISABLED_COMPONENTS or PackageManager.MATCH_UNINSTALLED_PACKAGES).toLong(),
                ),
            )
        } else {
            context.packageManager.getApplicationInfo(
                packageName,
                PackageManager.MATCH_DISABLED_COMPONENTS or PackageManager.MATCH_UNINSTALLED_PACKAGES,
            )
        }
    }.getOrNull()

    private fun restoreEssentialPackages(context: Context) {
        val policy = manager(context)
        val packages = excludedGuestPackages(context).filterNot { it == context.packageName }
        packages.forEach { packageName ->
            runCatching { setApplicationHidden(policy, context, packageName, false) }
        }
        if (packages.isNotEmpty()) {
            runCatching { policy.setPackagesSuspended(admin(context), packages.toTypedArray(), false) }
        }
    }

    @Suppress("DEPRECATION")
    private fun guestLaunchIntent(context: Context, packageName: String): Intent? {
        if (applicationInfo(context, packageName) == null) return null
        val request = Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .setPackage(packageName)
        val flags = PackageManager.MATCH_DISABLED_COMPONENTS or PackageManager.MATCH_UNINSTALLED_PACKAGES
        val matches = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.packageManager.queryIntentActivities(request, PackageManager.ResolveInfoFlags.of(flags.toLong()))
        } else {
            context.packageManager.queryIntentActivities(request, flags)
        }
        val activity = matches.firstOrNull()?.activityInfo ?: return null
        return Intent(request).setComponent(ComponentName(activity.packageName, activity.name))
    }

    private inline fun policyStep(name: String, action: () -> Unit) {
        try {
            action()
        } catch (failure: Throwable) {
            throw IllegalStateException("POLICY_$name", failure)
        }
    }
}
