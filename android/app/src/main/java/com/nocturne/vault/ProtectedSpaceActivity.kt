package com.nocturne.vault

import android.app.Activity
import android.app.KeyguardManager
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.UserManager
import android.provider.Settings
import android.util.Log
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Android
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity

class ProtectedSpaceActivity : FragmentActivity() {
    private var authorized by mutableStateOf(false)
    private var failure by mutableStateOf("")
    private var apps by mutableStateOf<List<ApplicationInfo>>(emptyList())
    private var launchedPackage: String? = null
    private var pendingCommand: ProtectedSpaceCommand? = null
    private var pendingCommandValidated = false
    private var pendingRepairCommand: ProtectedSpaceCommand? = null
    private var preciseLockAllowed by mutableStateOf(false)
    private var secureChallenge by mutableStateOf(false)
    private var repairInProgress by mutableStateOf(false)
    private var challengeSettingsOpened = false
    private var challengeRefreshInProgress by mutableStateOf(false)
    private var credentialPromptOpened = false
    private var credentialRefreshInProgress = false
    private var preciseLockSettingsOpened = false
    private val sessionHandler = Handler(Looper.getMainLooper())
    private val sessionExpiry = Runnable { closeExpiredSession() }
    private val challengeSettingsLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        challengeSettingsOpened = false
        SafeDebugLog.record(
            this,
            "protected.challenge.settings.result",
            "result" to when (result.resultCode) {
                Activity.RESULT_OK -> "OK"
                Activity.RESULT_CANCELED -> "CANCELED"
                else -> result.resultCode
            },
        )
        beginChallengeRefresh("activity_result")
    }
    private val credentialUnlockLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        credentialPromptOpened = false
        SafeDebugLog.record(
            this,
            "protected.challenge.unlock.result",
            "result" to when (result.resultCode) {
                Activity.RESULT_OK -> "OK"
                Activity.RESULT_CANCELED -> "CANCELED"
                else -> result.resultCode
            },
        )
        if (result.resultCode == Activity.RESULT_OK) {
            beginCredentialUnlockRefresh("activity_result")
        } else {
            rejectCredentialUnlock("CHALLENGE_CANCELLED")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        challengeSettingsOpened = savedInstanceState?.getBoolean(STATE_CHALLENGE_SETTINGS_OPENED) == true
        credentialPromptOpened = savedInstanceState?.getBoolean(STATE_CREDENTIAL_PROMPT_OPENED) == true
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        reportProtectedSpaceDelivery(this, intent, ProtectedSpaceDeliveryTracker.STAGE_RECEIVED)
        if (!ProtectedSpaceManager.isProfileOwner(this)) {
            reportProtectedSpaceDelivery(
                this,
                intent,
                ProtectedSpaceDeliveryTracker.STAGE_REJECTED,
                "NOT_PROFILE_OWNER",
            )
            finish()
            return
        }
        preciseLockAllowed = ProtectedSpacePolicy.preciseLockAllowed(this)
        secureChallenge = ProtectedSpacePolicy.hasSeparateChallenge(this)
        pendingCommand = ProtectedSpaceContract.read(intent)
        if (pendingCommand == null && !prepareClosedState()) return
        if (authorized) apps = ProtectedSpacePolicy.guestApps(this)
        setContent {
            NocturneTheme {
                NocturneBackground {
                    ProtectedSpaceContent(
                        authorized = authorized,
                        failure = failure,
                        secureChallenge = secureChallenge,
                        preciseLockAllowed = preciseLockAllowed,
                        apps = apps,
                        label = { packageManager.getApplicationLabel(it).toString() },
                        onSetChallenge = ::openChallengeSettings,
                        repairPending = pendingRepairCommand != null,
                        repairInProgress = repairInProgress,
                        challengeCheckInProgress = challengeRefreshInProgress,
                        onRepair = ::requestRepairAuthorization,
                        onAllowPreciseLock = ::openPreciseLockSettings,
                        onInstall = ::openWorkStore,
                        onLaunch = ::launch,
                        onLock = {
                            runCatching {
                                ProtectedSpacePolicy.lockAndEvict(this) {
                                    reportProtectedSpaceDelivery(
                                        this,
                                        intent,
                                        ProtectedSpaceDeliveryTracker.STAGE_LOCKED,
                                    )
                                }
                            }
                                .onFailure {
                                    reportProtectedSpaceDelivery(
                                        this,
                                        intent,
                                        ProtectedSpaceDeliveryTracker.STAGE_FAILED,
                                        "POLICY_ENFORCEMENT_FAILED",
                                    )
                                }
                            finishAndRemoveTask()
                        },
                    )
                }
            }
        }
        pendingCommand?.let { sessionHandler.post { continuePendingCommand() } }
    }

    private fun continuePendingCommand() {
        val command = pendingCommand ?: return
        if (!pendingCommandValidated) {
            val validation = preflight(command)
            if (!validation.accepted) {
                pendingCommand = null
                failure = validation.reason
                prepareClosedState()
                reportProtectedSpaceDelivery(
                    this,
                    intent,
                    ProtectedSpaceDeliveryTracker.STAGE_REJECTED,
                    failure.ifBlank { "COMMAND_REJECTED" },
                )
                return
            }
            pendingCommandValidated = true
            if (command.action == ProtectedSpaceProtocol.ACTION_REPAIR) {
                pendingRepairCommand = command
                failure = if (secureChallenge) "" else "SET_SEPARATE_CHALLENGE"
            }
        }
        if (command.action != ProtectedSpaceProtocol.ACTION_LOCK && !profileCredentialUnlocked()) {
            if (!prepareClosedState()) return
            requestCredentialUnlock()
            return
        }
        pendingCommand = null
        pendingCommandValidated = false
        when (command.action) {
            ProtectedSpaceProtocol.ACTION_REPAIR -> {
                if (!prepareClosedState()) return
                secureChallenge = ProtectedSpacePolicy.hasSeparateChallenge(this)
                if (secureChallenge) {
                    requestRepairAuthorization()
                } else {
                    failure = "SET_SEPARATE_CHALLENGE"
                    SafeDebugLog.record(
                        this,
                        "protected.challenge.setup_required",
                        "state" to ProtectedSpacePolicy.challengeDiagnosticCode(this),
                    )
                    reportProtectedSpaceDelivery(
                        this,
                        intent,
                        ProtectedSpaceDeliveryTracker.STAGE_SETUP_REQUIRED,
                        failure,
                    )
                }
            }
            else -> authorizeSignedCommand(command)
        }
    }

    private fun preflight(command: ProtectedSpaceCommand): ProtectedSpaceVerification {
        if (command.action == ProtectedSpaceProtocol.ACTION_REPAIR) {
            val trustedRequest = ProtectedSpaceContract.hasTrustedPersonalDeliveryCallback(this, intent)
            SafeDebugLog.record(
                this,
                "protected.repair.received",
                "trusted" to trustedRequest,
                "state" to ProtectedSpacePolicy.challengeDiagnosticCode(this),
            )
            return if (trustedRequest) {
                ProtectedSpaceProtocol.verifyRepair(command)
            } else {
                ProtectedSpaceVerification(false, "INVALID_REPAIR_REQUEST")
            }
        }
        return ProtectedSpacePolicy.verifyCommand(this, command)
    }

    private fun authorizeSignedCommand(command: ProtectedSpaceCommand) {
        val result = runCatching {
            ProtectedSpacePolicy.authorize(this, command) {
                reportProtectedSpaceDelivery(this, intent, ProtectedSpaceDeliveryTracker.STAGE_LOCKED)
            }
        }
            .getOrElse {
                Log.e("NocturneProtectedSpace", "Unable to authorize protected-space command", it)
                ProtectedSpaceVerification(false, "POLICY_ERROR")
            }
        if (command.action == ProtectedSpaceProtocol.ACTION_LOCK && result.accepted) {
            finishAndRemoveTask()
            return
        }
        authorized = result.accepted && ProtectedSpacePolicy.sessionActive(this)
        failure = result.reason
        if (authorized && enforcePolicy(command.packageName.takeIf(String::isNotBlank))) {
            apps = ProtectedSpacePolicy.guestApps(this)
            scheduleSessionExpiry()
            reportProtectedSpaceDelivery(this, intent, ProtectedSpaceDeliveryTracker.STAGE_OPENED)
        }
        if (!authorized) {
            prepareClosedState()
            reportProtectedSpaceDelivery(
                this,
                intent,
                ProtectedSpaceDeliveryTracker.STAGE_REJECTED,
                failure.ifBlank { "COMMAND_REJECTED" },
            )
        }
    }

    private fun prepareClosedState(): Boolean = runCatching {
        ProtectedSpacePolicy.prepareClosedState(this)
        true
    }.getOrElse {
        Log.e("NocturneProtectedSpace", "Unable to close protected-space session", it)
        reportProtectedSpaceDelivery(
            this,
            intent,
            ProtectedSpaceDeliveryTracker.STAGE_FAILED,
            "POLICY_ENFORCEMENT_FAILED",
        )
        finishAndRemoveTask()
        false
    }

    private fun profileCredentialUnlocked(): Boolean = runCatching {
        getSystemService(UserManager::class.java).isUserUnlocked &&
            !getSystemService(KeyguardManager::class.java).isDeviceLocked
    }.getOrDefault(false)

    @Suppress("DEPRECATION")
    private fun requestCredentialUnlock() {
        if (credentialPromptOpened || credentialRefreshInProgress) return
        if (profileCredentialUnlocked()) {
            resumeAfterCredentialUnlock()
            return
        }
        val request = getSystemService(KeyguardManager::class.java).createConfirmDeviceCredentialIntent(
            "Открыть защищённые приложения",
            "Введите отдельный код защищённых приложений. Nocturne не видит и не хранит его.",
        )
        if (request == null) {
            rejectCredentialUnlock("CHALLENGE_UNAVAILABLE")
            return
        }
        credentialPromptOpened = true
        failure = "WAITING_FOR_SEPARATE_CHALLENGE"
        reportProtectedSpaceDelivery(
            this,
            intent,
            ProtectedSpaceDeliveryTracker.STAGE_AUTHENTICATION_REQUIRED,
        )
        SafeDebugLog.record(
            this,
            "protected.challenge.unlock.opened",
            "state" to ProtectedSpacePolicy.challengeDiagnosticCode(this),
        )
        runCatching { credentialUnlockLauncher.launch(request) }
            .onFailure { rejectCredentialUnlock("CHALLENGE_UNAVAILABLE") }
    }

    private fun beginCredentialUnlockRefresh(source: String) {
        credentialPromptOpened = false
        if (credentialRefreshInProgress) return
        credentialRefreshInProgress = true
        SafeDebugLog.record(this, "protected.challenge.unlock.checking", "source" to source)
        sessionHandler.postDelayed({ refreshCredentialUnlock(0) }, 150L)
    }

    private fun refreshCredentialUnlock(attempt: Int) {
        if (profileCredentialUnlocked()) {
            credentialRefreshInProgress = false
            SafeDebugLog.record(
                this,
                "protected.challenge.unlock.confirmed",
                "attempt" to attempt,
                "state" to ProtectedSpacePolicy.challengeDiagnosticCode(this),
            )
            resumeAfterCredentialUnlock()
        } else if (attempt < CREDENTIAL_REFRESH_MAX_ATTEMPTS) {
            sessionHandler.postDelayed({ refreshCredentialUnlock(attempt + 1) }, 200L)
        } else {
            rejectCredentialUnlock("CHALLENGE_NOT_CONFIRMED")
        }
    }

    private fun resumeAfterCredentialUnlock() {
        secureChallenge = ProtectedSpacePolicy.hasSeparateChallenge(this)
        when {
            pendingCommand != null -> continuePendingCommand()
            pendingRepairCommand != null -> requestRepairAuthorization()
        }
    }

    private fun rejectCredentialUnlock(reason: String) {
        credentialPromptOpened = false
        credentialRefreshInProgress = false
        pendingCommand = null
        pendingCommandValidated = false
        pendingRepairCommand = null
        failure = reason
        SafeDebugLog.record(this, "protected.challenge.unlock.failed", "reason" to reason)
        prepareClosedState()
        reportProtectedSpaceDelivery(
            this,
            intent,
            ProtectedSpaceDeliveryTracker.STAGE_REJECTED,
            reason,
        )
        finishAndRemoveTask()
    }

    override fun onResume() {
        super.onResume()
        preciseLockAllowed = ProtectedSpacePolicy.preciseLockAllowed(this)
        secureChallenge = ProtectedSpacePolicy.hasSeparateChallenge(this)
        if (credentialPromptOpened && profileCredentialUnlocked()) {
            beginCredentialUnlockRefresh("resume_fallback")
        }
        if (challengeSettingsOpened) beginChallengeRefresh("resume_fallback")
        if (preciseLockSettingsOpened) {
            preciseLockSettingsOpened = false
            if (preciseLockAllowed && pendingRepairCommand != null) {
                sessionHandler.post { requestRepairAuthorization() }
            }
        }
        if (authorized && !ProtectedSpacePolicy.sessionActive(this)) {
            authorized = false
            launchedPackage = null
            runCatching { ProtectedSpacePolicy.lockAndEvict(this) }
            finishAndRemoveTask()
            return
        }
        if (authorized && !enforcePolicy(launchedPackage)) return
        launchedPackage?.let {
            launchedPackage = null
            if (runCatching { ProtectedSpacePolicy.suspendGuests(this) }.isFailure) {
                authorized = false
                failure = "POLICY_ENFORCEMENT_FAILED"
                runCatching { ProtectedSpacePolicy.lockAndEvict(this) }
                return
            }
        }
        if (authorized) apps = ProtectedSpacePolicy.guestApps(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        recreate()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean(
            STATE_CHALLENGE_SETTINGS_OPENED,
            challengeSettingsOpened || challengeRefreshInProgress,
        )
        outState.putBoolean(
            STATE_CREDENTIAL_PROMPT_OPENED,
            credentialPromptOpened || credentialRefreshInProgress,
        )
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        sessionHandler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun launch(app: ApplicationInfo) {
        if (!ensureSession()) return
        if (!secureChallenge) {
            failure = "SET_SEPARATE_CHALLENGE"
            reportProtectedSpaceDelivery(
                this,
                intent,
                ProtectedSpaceDeliveryTracker.STAGE_REJECTED,
                failure,
            )
            return
        }
        runCatching {
            launchedPackage = app.packageName
            ProtectedSpacePolicy.launch(this, app.packageName)
        }.onFailure {
            launchedPackage = null
            failure = "APP_LAUNCH_FAILED"
        }
    }

    private fun openWorkStore() {
        if (!ensureSession()) return
        if (!secureChallenge) {
            failure = "SET_SEPARATE_CHALLENGE"
            return
        }
        runCatching {
            launchedPackage = ProtectedSpacePolicy.launchInstaller(this)
        }.onFailure {
            launchedPackage = null
            failure = if (it.message == "SET_SEPARATE_CHALLENGE") "SET_SEPARATE_CHALLENGE" else "WORK_STORE_UNAVAILABLE"
        }
    }

    private fun openPreciseLockSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        preciseLockSettingsOpened = true
        runCatching {
            startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName")))
        }.onFailure {
            preciseLockSettingsOpened = false
            failure = "EXACT_LOCK_UNAVAILABLE"
        }
    }

    private fun requestRepairAuthorization() {
        val command = pendingRepairCommand
        if (command == null || !ProtectedSpaceContract.hasTrustedPersonalDeliveryCallback(this, intent)) {
            failure = "INVALID_REPAIR_REQUEST"
            reportProtectedSpaceDelivery(
                this,
                intent,
                ProtectedSpaceDeliveryTracker.STAGE_REJECTED,
                failure,
            )
            return
        }
        val protocolResult = ProtectedSpaceProtocol.verifyRepair(command)
        if (!protocolResult.accepted) {
            failure = protocolResult.reason
            pendingRepairCommand = null
            reportProtectedSpaceDelivery(
                this,
                intent,
                ProtectedSpaceDeliveryTracker.STAGE_REJECTED,
                failure,
            )
            return
        }
        if (!profileCredentialUnlocked()) {
            requestCredentialUnlock()
            return
        }
        secureChallenge = ProtectedSpacePolicy.hasSeparateChallenge(this)
        if (!secureChallenge) {
            failure = "SET_SEPARATE_CHALLENGE"
            SafeDebugLog.record(
                this,
                "protected.challenge.setup_required",
                "state" to ProtectedSpacePolicy.challengeDiagnosticCode(this),
            )
            reportProtectedSpaceDelivery(
                this,
                intent,
                ProtectedSpaceDeliveryTracker.STAGE_SETUP_REQUIRED,
                failure,
            )
            return
        }
        if (repairInProgress) return
        repairInProgress = true
        failure = ""
        reportProtectedSpaceDelivery(
            this,
            intent,
            ProtectedSpaceDeliveryTracker.STAGE_REPAIR_READY,
            "AUTO_${ProtectedSpacePolicy.challengeDiagnosticCode(this)}",
        )
        completeRepairRequest()
    }

    private fun completeRepairRequest() {
        val command = pendingRepairCommand ?: return
        val result = runCatching {
            secureChallenge = ProtectedSpacePolicy.hasSeparateChallenge(this)
            check(secureChallenge) { "SET_SEPARATE_CHALLENGE" }
            ProtectedSpacePolicy.authorizeRepairFromTrustedPersonalProfile(this, command)
        }.getOrElse {
            ProtectedSpaceVerification(false, it.message?.takeIf { code -> code.matches(Regex("[A-Z0-9_]{1,64}")) } ?: "POLICY_ERROR")
        }
        repairInProgress = false
        if (result.accepted && ProtectedSpacePolicy.sessionActive(this)) {
            authorized = true
            pendingRepairCommand = null
            failure = ""
            if (enforcePolicy(null)) {
                apps = ProtectedSpacePolicy.guestApps(this)
                scheduleSessionExpiry()
                reportProtectedSpaceDelivery(this, intent, ProtectedSpaceDeliveryTracker.STAGE_REPAIRED)
                SafeDebugLog.record(this, "protected.repair.completed")
            }
        } else {
            failure = result.reason.ifBlank { "POLICY_ERROR" }
            SafeDebugLog.record(this, "protected.repair.failed", "reason" to failure)
            if (failure == "EXPIRED_COMMAND" || failure == "REPLAYED_COMMAND") {
                pendingRepairCommand = null
            }
            reportProtectedSpaceDelivery(
                this,
                intent,
                if (failure == "CHALLENGE_CANCELLED" || failure == "SET_SEPARATE_CHALLENGE") {
                    ProtectedSpaceDeliveryTracker.STAGE_REJECTED
                } else {
                    ProtectedSpaceDeliveryTracker.STAGE_FAILED
                },
                failure,
            )
        }
    }

    private fun openChallengeSettings() {
        if (challengeSettingsOpened || challengeRefreshInProgress) return
        val request = Intent(DevicePolicyManager.ACTION_SET_NEW_PASSWORD)
            .putExtra(DevicePolicyManager.EXTRA_PASSWORD_COMPLEXITY, DevicePolicyManager.PASSWORD_COMPLEXITY_LOW)
        runCatching {
            ProtectedSpacePolicy.prepareSeparateChallengeSetup(this)
            challengeSettingsOpened = true
            SafeDebugLog.record(
                this,
                "protected.challenge.settings.opened",
                "state" to ProtectedSpacePolicy.challengeDiagnosticCode(this),
            )
            challengeSettingsLauncher.launch(request)
        }
            .onFailure {
                challengeSettingsOpened = false
                failure = "SEPARATE_CHALLENGE_UNAVAILABLE"
            }
    }

    private fun beginChallengeRefresh(source: String) {
        challengeSettingsOpened = false
        if (challengeRefreshInProgress) return
        challengeRefreshInProgress = true
        failure = "CHECKING_SEPARATE_CHALLENGE"
        SafeDebugLog.record(
            this,
            "protected.challenge.settings.checking",
            "source" to source,
        )
        sessionHandler.postDelayed({ refreshChallengeAfterSettings(0) }, 700)
    }

    private fun refreshChallengeAfterSettings(attempt: Int) {
        secureChallenge = ProtectedSpacePolicy.hasSeparateChallenge(this)
        SafeDebugLog.record(
            this,
            "protected.challenge.settings.returned",
            "attempt" to attempt,
            "state" to ProtectedSpacePolicy.challengeDiagnosticCode(this),
        )
        if (secureChallenge) {
            challengeRefreshInProgress = false
            failure = ""
            Toast.makeText(this, "Отдельный код рабочего пространства настроен", Toast.LENGTH_LONG).show()
            if (pendingRepairCommand != null) {
                if (profileCredentialUnlocked()) requestRepairAuthorization() else requestCredentialUnlock()
            }
        } else if (attempt < CHALLENGE_REFRESH_MAX_ATTEMPTS) {
            sessionHandler.postDelayed({ refreshChallengeAfterSettings(attempt + 1) }, 900L)
        } else {
            challengeRefreshInProgress = false
            failure = "SEPARATE_CHALLENGE_NOT_CREATED"
            SafeDebugLog.record(
                this,
                "protected.challenge.setup_incomplete",
                "state" to ProtectedSpacePolicy.challengeDiagnosticCode(this),
            )
            Toast.makeText(
                this,
                "Android оставил общий код телефона. Повторите настройку и выберите другой PIN, рисунок или пароль.",
                Toast.LENGTH_LONG,
            ).show()
            reportProtectedSpaceDelivery(
                this,
                intent,
                ProtectedSpaceDeliveryTracker.STAGE_SETUP_REQUIRED,
                failure,
            )
        }
    }

    private fun ensureSession(): Boolean {
        if (authorized && ProtectedSpacePolicy.sessionActive(this)) return true
        closeExpiredSession()
        return false
    }

    private fun scheduleSessionExpiry() {
        sessionHandler.removeCallbacks(sessionExpiry)
        val remaining = ProtectedSpacePolicy.sessionRemainingMs(this)
        if (remaining <= 0) closeExpiredSession() else sessionHandler.postDelayed(sessionExpiry, remaining)
    }

    private fun closeExpiredSession() {
        authorized = false
        launchedPackage = null
        apps = emptyList()
        runCatching { ProtectedSpacePolicy.lockAndEvict(this) }
        finishAndRemoveTask()
    }

    private fun enforcePolicy(keepPackage: String?): Boolean = runCatching {
        ProtectedSpacePolicy.apply(this, keepPackage)
        true
    }.getOrElse {
        authorized = false
        failure = "POLICY_ENFORCEMENT_FAILED"
        reportProtectedSpaceDelivery(
            this,
            intent,
            ProtectedSpaceDeliveryTracker.STAGE_FAILED,
            failure,
        )
        runCatching { ProtectedSpacePolicy.lockAndEvict(this) }
        false
    }

    private companion object {
        // ACTION_SET_NEW_PASSWORD is a Settings trampoline on current Android releases: its
        // activity result can arrive before the actual credential wizard is finished. Keep
        // checking for up to 4.5 minutes (inside the five-minute signed repair-command TTL),
        // so reading the explanation and choosing a strong credential cannot break pairing.
        const val CHALLENGE_REFRESH_MAX_ATTEMPTS = 300
        const val CREDENTIAL_REFRESH_MAX_ATTEMPTS = 25
        const val STATE_CHALLENGE_SETTINGS_OPENED = "challenge_settings_opened"
        const val STATE_CREDENTIAL_PROMPT_OPENED = "credential_prompt_opened"
    }
}

@Composable
private fun ProtectedSpaceContent(
    authorized: Boolean,
    failure: String,
    secureChallenge: Boolean,
    preciseLockAllowed: Boolean,
    repairPending: Boolean,
    repairInProgress: Boolean,
    challengeCheckInProgress: Boolean,
    apps: List<ApplicationInfo>,
    label: (ApplicationInfo) -> String,
    onSetChallenge: () -> Unit,
    onRepair: () -> Unit,
    onAllowPreciseLock: () -> Unit,
    onInstall: () -> Unit,
    onLaunch: (ApplicationInfo) -> Unit,
    onLock: () -> Unit,
) {
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.Apps, null, Modifier.size(34.dp), tint = NocturneAccent)
            Column(Modifier.padding(start = 12.dp).weight(1f)) {
                Text("Защищённые приложения", color = NocturneInk, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
                Text("Отдельное пространство Android", color = NocturneMuted, fontSize = 12.sp)
            }
            OutlinedButton(onClick = onLock) {
                Icon(Icons.Rounded.Lock, null, Modifier.size(18.dp))
                Text("Закрыть", Modifier.padding(start = 6.dp))
            }
        }
        Spacer(Modifier.height(22.dp))
        if (!authorized) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(bottom = 20.dp),
                verticalArrangement = Arrangement.Center,
            ) {
                GlassCard(Modifier.fillMaxWidth(), strong = true) {
                    Column(Modifier.padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Icon(Icons.Rounded.Lock, null, Modifier.size(42.dp), tint = NocturneAccent)
                        Text("Пространство закрыто", color = NocturneInk, fontWeight = FontWeight.SemiBold, fontSize = 19.sp)
                        Text("Откройте его из личного приложения Nocturne. Вход напрямую из рабочего профиля заблокирован.", color = NocturneMuted, lineHeight = 19.sp)
                        if (repairPending && secureChallenge) {
                            OutlinedButton(enabled = !repairInProgress, onClick = onRepair) {
                                Text(if (repairInProgress) "Переподключаю…" else "Повторить переподключение")
                            }
                            Text(
                                "Nocturne восстанавливает защищённую связь автоматически. Одноразовых кодов нет.",
                                color = NocturneMuted,
                                fontSize = 12.sp,
                                lineHeight = 18.sp,
                            )
                        } else if (repairPending) {
                            Text(
                                "Для переподключения сначала создайте отдельный код рабочего пространства ниже. Пароль телефона для этого не подходит.",
                                color = NocturneMuted,
                                fontSize = 12.sp,
                                lineHeight = 18.sp,
                            )
                        }
                        ProtectedSpaceRequirements(
                            preciseLockAllowed,
                            secureChallenge,
                            challengeCheckInProgress,
                            failure,
                            onAllowPreciseLock,
                            onSetChallenge,
                        )
                        protectedSpaceFailureMessage(failure)?.takeUnless { failure == "EXACT_LOCK_UNAVAILABLE" }?.let {
                            Text(it, color = NocturneMuted, lineHeight = 19.sp)
                        }
                    }
                }
            }
            return@Column
        }
        ProtectedSpaceRequirements(
            preciseLockAllowed,
            secureChallenge,
            challengeCheckInProgress,
            failure,
            onAllowPreciseLock,
            onSetChallenge,
        )
        Spacer(Modifier.height(14.dp))
        if (secureChallenge) {
            OutlinedButton(onClick = onInstall, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Rounded.Android, null, Modifier.size(18.dp))
                Text("Установить приложение в это пространство", Modifier.padding(start = 8.dp))
            }
            Spacer(Modifier.height(14.dp))
        }
        if (apps.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Rounded.Android, null, Modifier.size(48.dp), tint = NocturneAccent)
                    Text("Приложений пока нет", color = NocturneInk, fontWeight = FontWeight.SemiBold)
                    Text("Установите нужное приложение кнопкой выше. Оно получит отдельные данные и настройки.", color = NocturneMuted)
                }
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(apps, key = { it.packageName }) { app ->
                    GlassCard(Modifier.fillMaxWidth().clickable(enabled = secureChallenge) { onLaunch(app) }) {
                        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Rounded.Android, null, tint = NocturneAccent)
                            Column(Modifier.padding(start = 12.dp)) {
                                Text(label(app), color = NocturneInk, fontWeight = FontWeight.SemiBold)
                                Text(app.packageName, color = NocturneMuted, fontSize = 11.sp)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProtectedSpaceRequirements(
    preciseLockAllowed: Boolean,
    secureChallenge: Boolean,
    challengeCheckInProgress: Boolean,
    failure: String,
    onAllowPreciseLock: () -> Unit,
    onSetChallenge: () -> Unit,
) {
    GlassCard(Modifier.fillMaxWidth(), strong = true) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Что нужно для работы", color = NocturneInk, fontWeight = FontWeight.SemiBold)
            ProtectedRequirementRow(
                title = "Закрытие точно через 5 минут",
                description = "В Android это разрешение называется «Будильники и напоминания». Nocturne не создаёт будильники — доступ нужен только для своевременного закрытия приложений.",
                granted = preciseLockAllowed,
                action = onAllowPreciseLock,
            )
            ProtectedRequirementRow(
                title = "Код защищённых приложений",
                description = "Android хранит этот код отдельно. Выберите новый PIN, рисунок или пароль именно для рабочего пространства — общий код телефона не защищает от человека, который его знает.",
                granted = secureChallenge,
                pending = challengeCheckInProgress,
                actionLabel = if (failure == "SEPARATE_CHALLENGE_NOT_CREATED") "Повторить" else "Настроить",
                action = onSetChallenge,
            )
        }
    }
}

@Composable
private fun ProtectedRequirementRow(
    title: String,
    description: String,
    granted: Boolean,
    pending: Boolean = false,
    actionLabel: String = "Настроить",
    action: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().clickable(enabled = !granted && !pending, onClick = action).padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            if (granted) Icons.Rounded.CheckCircle else Icons.Rounded.Warning,
            null,
            Modifier.size(24.dp),
            tint = if (granted) NocturneAccent else NocturneMuted,
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, color = NocturneInk, fontWeight = FontWeight.SemiBold)
            Text(description, color = NocturneMuted, fontSize = 12.sp, lineHeight = 17.sp)
        }
        Text(
            when {
                granted -> "Готово"
                pending -> "Проверяю…"
                else -> actionLabel
            },
            color = NocturneAccent,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

internal fun protectedSpaceFailureMessage(reason: String): String? = when (reason) {
    "" -> null
    "EXACT_LOCK_UNAVAILABLE" -> "Нужно разрешить точное закрытие защищённых приложений."
    "PROFILE_NOT_PAIRED" -> "Это пространство ещё не связано с личным Nocturne. Завершите создание или выполните переподключение."
    "SEPARATE_CHALLENGE_UNAVAILABLE", "CHALLENGE_UNAVAILABLE" -> "Не удалось запустить системную настройку отдельного кода пространства. Попробуйте ещё раз."
    "CHALLENGE_CANCELLED" -> "Разблокировка пространства отменена. Переподключение не выполнялось."
    "CHALLENGE_LOCKED_OUT" -> "Android временно заблокировал разблокировку после нескольких попыток. Подождите и попробуйте снова."
    "CHALLENGE_NOT_CONFIRMED" -> "Android не подтвердил разблокировку рабочего пространства. Повторите вход и введите отдельный код защищённых приложений."
    "WAITING_FOR_SEPARATE_CHALLENGE" -> "Подтвердите отдельный код защищённых приложений в системном окне Android."
    "CHECKING_SEPARATE_CHALLENGE" -> "Проверяю, создал ли Android отдельный код рабочего пространства…"
    "INVALID_REPAIR_REQUEST", "REPAIR_AUTHENTICATION_REQUIRED" -> "Безопасное переподключение запускается только из открытого личного Nocturne."
    "SET_SEPARATE_CHALLENGE" -> "Сейчас пространство использует общий код телефона. Нажмите «Настроить» и создайте отдельный PIN, рисунок или пароль рабочего пространства."
    "SEPARATE_CHALLENGE_NOT_CREATED" -> "Android вернулся из настроек, но отдельный код рабочего пространства не появился. Откройте «Настроить» ещё раз и выберите новый код, отличный от кода телефона."
    "SESSION_EXPIRING", "EXPIRED_COMMAND" -> "Время защищённой сессии закончилось. Откройте пространство снова из личного Nocturne."
    "WORK_STORE_UNAVAILABLE" -> "Не удалось открыть магазин приложений в защищённом пространстве."
    "INVALID_SIGNATURE" -> "Ключ связи с личным Nocturne изменился. В личном приложении нажмите «Переподключить» — связь восстановится автоматически."
    "REPLAYED_COMMAND", "COMMAND_FROM_FUTURE", "INVALID_ACTION", "INVALID_PAIRING_DATA", "INVALID_SESSION" ->
        "Защитная проверка отклонила запрос. Вернитесь в личный Nocturne и повторите действие."
    "POLICY_ERROR", "POLICY_ENFORCEMENT_FAILED", "SESSION_NOT_PERSISTED", "APP_LAUNCH_FAILED" ->
        "Не удалось безопасно подготовить пространство. Закройте его и попробуйте снова."
    else -> "Не удалось открыть пространство. Вернитесь в личный Nocturne и попробуйте снова."
}
