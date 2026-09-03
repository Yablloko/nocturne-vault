package com.nocturne.vault

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ActivityNotFoundException
import android.content.pm.PackageManager
import android.os.Build
import android.os.PersistableBundle
import android.os.UserManager
import android.content.pm.CrossProfileApps
import androidx.annotation.RequiresApi

object ProtectedSpaceManager {
    data class Status(
        val supported: Boolean,
        val provisioned: Boolean,
        val paused: Boolean,
        val unlocked: Boolean,
        val routeAvailable: Boolean,
    )

    fun isProfileOwner(context: Context): Boolean = context.getSystemService(DevicePolicyManager::class.java)
        .isProfileOwnerApp(context.packageName)

    fun isProvisioned(context: Context): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && isProvisionedOnAndroid11(context)

    fun canOpen(context: Context): Boolean {
        if (!isProvisioned(context)) return false
        return listOf(ProtectedSpaceContract.intent(), ProtectedSpaceContract.legacyIntent()).any { request ->
            request.resolveActivity(context.packageManager)?.packageName == "android"
        }
    }

    fun isPaused(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false
        return isPausedOnAndroid11(context)
    }

    fun status(context: Context): Status {
        val supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
        if (!supported) return Status(false, false, false, false, false)
        return statusOnAndroid11(context)
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun statusOnAndroid11(context: Context): Status {
        val profile = runCatching {
            context.getSystemService(CrossProfileApps::class.java).targetUserProfiles.firstOrNull()
        }.getOrNull()
        if (profile == null) return Status(true, false, false, false, false)
        val users = context.getSystemService(UserManager::class.java)
        val paused = runCatching { users.isQuietModeEnabled(profile) }.getOrDefault(false)
        val unlocked = runCatching { users.isUserUnlocked(profile) }.getOrDefault(false)
        return Status(true, true, paused, unlocked, canOpen(context))
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun isPausedOnAndroid11(context: Context): Boolean = runCatching {
        val profile = context.getSystemService(CrossProfileApps::class.java).targetUserProfiles.firstOrNull() ?: return false
        context.getSystemService(UserManager::class.java).isQuietModeEnabled(profile)
    }.getOrDefault(false)

    fun provisioningIntent(context: Context, publicKey: String): Intent {
        val admin = ComponentName(context, ProtectedSpaceAdminReceiver::class.java)
        return Intent(DevicePolicyManager.ACTION_PROVISION_MANAGED_PROFILE)
            .putExtra(DevicePolicyManager.EXTRA_PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME, admin)
            .putExtra(DevicePolicyManager.EXTRA_PROVISIONING_SKIP_EDUCATION_SCREENS, true)
            .putExtra(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE, PersistableBundle().apply {
                putString(ProtectedSpaceContract.EXTRA_PUBLIC_KEY, publicKey)
            })
    }

    fun configureControllerActivity(context: Context) {
        val profileOwner = isProfileOwner(context)
        val controllerState = if (profileOwner) {
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        } else {
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        }
        val mainState = if (profileOwner) {
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        } else {
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        }
        val controller = ComponentName(context, ProtectedSpaceActivity::class.java)
        val main = ComponentName(context, MainActivity::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val flags = PackageManager.DONT_KILL_APP or PackageManager.SYNCHRONOUS
            context.packageManager.setComponentEnabledSettings(
                listOf(
                    PackageManager.ComponentEnabledSetting(controller, controllerState, flags),
                    PackageManager.ComponentEnabledSetting(main, mainState, flags),
                ),
            )
        } else {
            context.packageManager.setComponentEnabledSetting(
                controller,
                controllerState,
                PackageManager.DONT_KILL_APP,
            )
            context.packageManager.setComponentEnabledSetting(
                main,
                mainState,
                PackageManager.DONT_KILL_APP,
            )
        }
    }

    fun open(context: Context, repository: VaultRepository): Result<Unit> {
        SafeDebugLog.record(context, "protected.open.clicked")
        return send(context, repository.createProtectedSpaceCommand(ProtectedSpaceProtocol.ACTION_OPEN), "open")
    }

    fun lock(context: Context, repository: VaultRepository): Result<Unit> {
        SafeDebugLog.record(context, "protected.close.clicked")
        if (!repository.isOpen() || !isProvisioned(context) || !canOpen(context)) return Result.success(Unit)
        return send(context, repository.createProtectedSpaceCommand(ProtectedSpaceProtocol.ACTION_LOCK), "lock")
    }

    fun repair(context: Context, repository: VaultRepository): Result<Unit> {
        SafeDebugLog.record(context, "protected.repair.clicked")
        return sendRepairCommand(context, repository.createProtectedSpaceRepairCommand())
    }

    internal fun sendRepairCommand(context: Context, command: ProtectedSpaceCommand): Result<Unit> =
        send(context, command, "repair")

    internal fun sendSignedCommand(
        context: Context,
        command: ProtectedSpaceCommand,
        operation: String,
    ): Result<Unit> = send(context, command, operation)

    private fun send(context: Context, command: ProtectedSpaceCommand, operation: String): Result<Unit> = route(
        context,
        ProtectedSpaceContract.put(ProtectedSpaceContract.intent(), command),
        operation,
    )

    private fun route(context: Context, request: Intent, operation: String): Result<Unit> {
        val (requestId, callback) = ProtectedSpaceDeliveryTracker.begin(context, operation)
        ProtectedSpaceContract.attachDeliveryCallback(request, requestId, callback)
        SafeDebugLog.record(
            context,
            "protected.route.request",
            "action" to request.action,
            "operation" to operation,
        )
        return runCatching {
            check(isProvisioned(context)) { "PROTECTED_PROFILE_NOT_FOUND" }
            var routedRequest = request
            var forwarder = routedRequest.resolveActivity(context.packageManager)
            var method = "system_forwarder_main"
            if (forwarder?.packageName != "android") {
                routedRequest = Intent(ProtectedSpaceContract.legacyIntent()).putExtras(request)
                forwarder = routedRequest.resolveActivity(context.packageManager)
                method = "system_forwarder_legacy"
            }
            check(forwarder?.packageName == "android") { "PROTECTED_PROFILE_ROUTE_UNTRUSTED" }
            routedRequest.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP,
            )
            context.applicationContext.startActivity(routedRequest)
            SafeDebugLog.record(
                context,
                "protected.route.started",
                "method" to method,
                "component" to forwarder.className,
            )
        }.onFailure { failure ->
            ProtectedSpaceDeliveryTracker.record(
                context,
                requestId,
                ProtectedSpaceDeliveryTracker.STAGE_FAILED,
                SafeDebugLog.failureCode(failure),
            )
            SafeDebugLog.record(
                context,
                "protected.route.failed",
                "reason" to SafeDebugLog.failureCode(failure),
                "activityMissing" to (failure is ActivityNotFoundException),
            )
        }
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun isProvisionedOnAndroid11(context: Context): Boolean = context.getSystemService(CrossProfileApps::class.java)
        .targetUserProfiles.isNotEmpty()

}
