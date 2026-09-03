package com.nocturne.vault

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun NocturneApp(
    repository: VaultRepository,
    gate: Gate,
    showOnboarding: Boolean,
    onCompleteOnboarding: () -> Unit,
    onShowOnboarding: () -> Unit,
    onGate: (Gate) -> Unit,
    data: VaultData?,
    dataRevision: Int,
    importState: ImportUiState,
    onCopySecret: (String) -> Unit,
    onPickMedia: (String) -> Unit,
    onPickDocuments: (String) -> Unit,
    onPickOtpImage: ((Result<OtpItem>) -> Unit) -> Unit,
    onScanOtpCamera: ((Result<OtpItem>) -> Unit) -> Unit,
    onExportFile: (StoredFile) -> Unit,
    onCollapseImport: () -> Unit,
    onClearImport: () -> Unit,
    onSettingsApplied: (PrivacySettings) -> Unit,
    onDataChanged: () -> Unit,
    onSystemUnlock: ((UnlockResult) -> Unit) -> Unit,
    systemAuthAvailable: Boolean,
    onConfigureSystem: (String, (Result<Unit>) -> Unit) -> Unit,
    onReset: () -> Unit,
    onLock: () -> Unit,
    onUserActivity: () -> Unit,
    onStartAudio: ((Result<Unit>) -> Unit) -> Unit,
    onStopAudio: ((Result<AudioAttachment>) -> Unit) -> Unit,
    onCancelAudio: () -> Unit,
    autofillEnabled: Boolean,
    onConfigureAutofill: () -> Unit,
    vaultImportActive: Boolean,
    replacingVault: Boolean,
    vaultExportBusy: Boolean,
    onPickVaultImport: () -> Unit,
    onImportVault: (CharArray, (Result<Unit>) -> Unit) -> Unit,
    onCancelVaultImport: () -> Unit,
    onExportVault: () -> Unit,
    onBeginProtectedProvisioning: () -> Unit,
    onFinishProtectedProvisioning: () -> Unit,
) {
    NocturneTheme {
        NocturneBackground {
            Box(Modifier.fillMaxSize()) {
                AnimatedContent(
                    targetState = gate,
                    transitionSpec = { fadeIn(tween(170)) togetherWith fadeOut(tween(110)) },
                    label = "vault-gate",
                ) { current ->
                    when (current) {
                        Gate.Onboarding -> OnboardingScreen(onComplete = onCompleteOnboarding)
                        Gate.Create -> CreateVaultScreen(repository, { onGate(Gate.Open) }, onPickVaultImport)
                        Gate.Master -> MasterUnlockScreen(repository, { onGate(Gate.Open) }, onReset)
                        is Gate.MasterRecovery -> MasterUnlockScreen(repository, { onGate(Gate.Open) }, onReset) { onGate(Gate.Quick(current.mode)) }
                        is Gate.Quick -> QuickUnlockScreen(
                            repository = repository,
                            mode = current.mode,
                            onUnlocked = { onGate(Gate.Open) },
                            onMasterRecovery = { onGate(Gate.MasterRecovery(current.mode)) },
                            onSystemUnlock = onSystemUnlock,
                            onReset = onReset,
                        )
                        Gate.Open -> data?.let { currentData -> CompositionLocalProvider(LocalAnonymousKeyboard provides currentData.settings.anonymousKeyboard) { HomeScreen(
                            repository = repository,
                            data = currentData,
                            externalRevision = dataRevision,
                            importState = importState,
                            onCopy = onCopySecret,
                            onPickMedia = onPickMedia,
                            onPickDocuments = onPickDocuments,
                            onPickOtpImage = onPickOtpImage,
                            onScanOtpCamera = onScanOtpCamera,
                            onExport = onExportFile,
                            onLock = onLock,
                            onCollapseImport = onCollapseImport,
                            onClearImport = onClearImport,
                            onSettingsApplied = onSettingsApplied,
                            onDataChanged = onDataChanged,
                            systemAuthAvailable = systemAuthAvailable,
                            onConfigureSystem = onConfigureSystem,
                            onUserActivity = onUserActivity,
                            onStartAudio = onStartAudio,
                            onStopAudio = onStopAudio,
                            onCancelAudio = onCancelAudio,
                            onShowOnboarding = onShowOnboarding,
                            autofillEnabled = autofillEnabled,
                            onConfigureAutofill = onConfigureAutofill,
                            onPickVaultImport = onPickVaultImport,
                            onExportVault = onExportVault,
                            onBeginProtectedProvisioning = onBeginProtectedProvisioning,
                            onFinishProtectedProvisioning = onFinishProtectedProvisioning,
                        ) } }
                    }
                }
                if (showOnboarding && gate == Gate.Open) OnboardingScreen(onComplete = onCompleteOnboarding, canClose = true)
                if (vaultImportActive) NocturneBackground {
                    ImportVaultScreen(replacingVault, onImportVault, onCancelVaultImport)
                }
                if (vaultExportBusy) VaultTransferOverlay()
            }
        }
    }
}

@Composable
private fun VaultTransferOverlay() {
    val interaction = remember { MutableInteractionSource() }
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.58f))
            .clickable(interactionSource = interaction, indication = null) {},
        contentAlignment = Alignment.Center,
    ) {
        GlassCard(Modifier.widthIn(max = 320.dp), strong = true) {
            Column(
                Modifier.padding(horizontal = 24.dp, vertical = 22.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                CircularProgressIndicator(Modifier.size(30.dp), color = NocturneAccent, strokeWidth = 2.dp)
                Text("Сохраняем копию", color = NocturneInk, fontSize = 18.sp)
                Text("Проверяем данные и записываем зашифрованный файл", color = NocturneMuted, fontSize = 12.sp)
            }
        }
    }
}
