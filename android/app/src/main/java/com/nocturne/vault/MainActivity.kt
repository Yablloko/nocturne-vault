package com.nocturne.vault

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.database.Cursor
import android.net.Uri
import android.graphics.BitmapFactory
import android.credentials.CredentialManager
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.os.SystemClock
import android.provider.OpenableColumns
import android.provider.Settings
import android.view.autofill.AutofillManager
import android.view.WindowManager
import android.view.View
import android.widget.Toast
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.neverEqualPolicy
import androidx.compose.runtime.setValue
import androidx.fragment.app.FragmentActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID
import javax.crypto.Cipher

class MainActivity : FragmentActivity() {
    private lateinit var repository: VaultRepository
    private val deviceCredential = DeviceCredentialCrypto()
    private var gate by mutableStateOf<Gate>(Gate.Create)
    private var autofillSettingsFlow = false
    private var pendingExport: StoredFile? = null
    private var pendingOtpImport: ((Result<OtpItem>) -> Unit)? = null
    private var pendingImportFolderId = ""
    private var pendingVaultImportUri by mutableStateOf<Uri?>(null)
    private var replacingVaultOnImport by mutableStateOf(false)
    private var vaultExportBusy by mutableStateOf(false)
    private var dataRevision by mutableIntStateOf(0)
    private var openData by mutableStateOf<VaultData?>(null, neverEqualPolicy())
    private var importState by mutableStateOf(ImportUiState())
    private var showOnboarding by mutableStateOf(false)
    private var autofillEnabled by mutableStateOf(false)
    private var importJob: Job? = null
    private var lastInteraction = SystemClock.elapsedRealtime()
    private val handler = Handler(Looper.getMainLooper())
    private var copiedToken: String? = null
    private var copiedExpiresAt = 0L
    private var appVisible = false
    private var audioRecorder: MediaRecorder? = null
    private var audioRecordingFile: File? = null
    private var audioRecordingStartedAt = 0L
    private var pendingAudioStart: ((Result<Unit>) -> Unit)? = null
    private var protectedProvisioningActive = false
    private var protectedProvisioningUntil = 0L
    private var profileStateReceiverRegistered = false
    private val visualDebugBuild by lazy { applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0 }
    private val profileStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            SafeDebugLog.record(context, "protected.profile.broadcast", "action" to intent.action)
            dataRevision++
        }
    }

    private val audioPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val callback = pendingAudioStart.also { pendingAudioStart = null } ?: return@registerForActivityResult
        if (granted) startAudioRecordingNow(callback)
        else callback(Result.failure(SecurityException("RECORD_AUDIO_DENIED")))
    }

    private val mediaPicker = registerForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(30)) { uris ->
        finishExternalFlow()
        enqueueImports(uris, pendingImportFolderId.also { pendingImportFolderId = "" })
    }

    private val documentPicker = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        finishExternalFlow()
        enqueueImports(uris, pendingImportFolderId.also { pendingImportFolderId = "" })
    }

    private val exportFile = registerForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        finishExternalFlow()
        val item = pendingExport.also { pendingExport = null } ?: return@registerForActivityResult
        if (uri != null && repository.isOpen()) lifecycleScope.launch(Dispatchers.IO) {
            runCatching { contentResolver.openOutputStream(uri)?.use { repository.exportFile(item.id, it) } }
        }
    }

    private val vaultImportPicker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        finishExternalFlow()
        if (uri != null) {
            replacingVaultOnImport = repository.isOpen()
            pendingVaultImportUri = uri
        }
    }

    private val vaultExportDocument = registerForActivityResult(ActivityResultContracts.CreateDocument(VaultRepository.BACKUP_MIME)) { uri ->
        finishExternalFlow()
        if (uri == null || !repository.isOpen()) return@registerForActivityResult
        vaultExportBusy = true
        lifecycleScope.launch(Dispatchers.IO) {
            val result = runCatching {
                contentResolver.openOutputStream(uri, "w")?.use(repository::exportVault) ?: error("BACKUP_DESTINATION_UNAVAILABLE")
            }
            withContext(Dispatchers.Main) {
                vaultExportBusy = false
                Toast.makeText(this@MainActivity, if (result.isSuccess) "Резервная копия создана" else "Не удалось создать резервную копию", Toast.LENGTH_LONG).show()
            }
        }
    }

    private val otpImagePicker = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        finishExternalFlow()
        val callback = pendingOtpImport.also { pendingOtpImport = null } ?: return@registerForActivityResult
        if (uri == null) callback(Result.failure(IllegalStateException("CANCELLED"))) else lifecycleScope.launch(Dispatchers.IO) {
            val result = runCatching {
                val bitmap = decodeQrBitmap(uri) ?: error("QR_UNREADABLE")
                try {
                    decodeOtpQr(bitmap)
                } finally {
                    bitmap.recycle()
                }
            }
            withContext(Dispatchers.Main) { callback(result) }
        }
    }

    private fun decodeQrBitmap(uri: Uri): android.graphics.Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        val width = bounds.outWidth
        val height = bounds.outHeight
        if (width <= 0 || height <= 0 || width > MAX_QR_SOURCE_DIMENSION || height > MAX_QR_SOURCE_DIMENSION) return null
        var sample = 1
        while (width / sample > MAX_QR_DECODE_DIMENSION || height / sample > MAX_QR_DECODE_DIMENSION) sample *= 2
        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        return contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
    }

    private val otpCamera = registerForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
        finishExternalFlow()
        val callback = pendingOtpImport.also { pendingOtpImport = null } ?: return@registerForActivityResult
        callback(if (bitmap == null) Result.failure(IllegalStateException("CANCELLED")) else runCatching { decodeOtpQr(bitmap) })
    }

    private val autoLock = Runnable {
        if (!needsMainUiRelock(gate, openData != null, repository.isOpen())) return@Runnable
        if (protectedProvisioningKeepsSession(protectedProvisioningActive, protectedProvisioningUntil)) scheduleAutoLock()
        else {
            protectedProvisioningActive = false
            protectedProvisioningUntil = 0L
            lockVault()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ProtectedSpaceManager.configureControllerActivity(this)
        if (ProtectedSpaceManager.isProfileOwner(this)) {
            startActivity(Intent(this, ProtectedSpaceActivity::class.java))
            finish()
            return
        }
        cleanupStalePlaintextCache()
        window.decorView.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        if (!visualDebugBuild) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        repository = (application as NocturneApplication).repository
        protectedProvisioningActive = savedInstanceState?.getBoolean(STATE_PROTECTED_PROVISIONING_ACTIVE) == true && repository.isOpen()
        protectedProvisioningUntil = savedInstanceState?.getLong(STATE_PROTECTED_PROVISIONING_UNTIL) ?: 0L
        if (!protectedProvisioningKeepsSession(protectedProvisioningActive, protectedProvisioningUntil)) {
            protectedProvisioningActive = false
            protectedProvisioningUntil = 0L
        }
        gate = if (getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getBoolean(PREF_ONBOARDING_DONE, false)) repository.initialGate() else Gate.Onboarding
        setContent {
            NocturneApp(
                repository = repository,
                gate = gate,
                showOnboarding = showOnboarding,
                onCompleteOnboarding = {
                    getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().putBoolean(PREF_ONBOARDING_DONE, true).apply()
                    if (gate == Gate.Onboarding) gate = repository.initialGate() else showOnboarding = false
                },
                onShowOnboarding = { showOnboarding = true },
                onGate = { next ->
                    if (next == Gate.Open) {
                        refreshData()
                        gate = next
                        lastInteraction = SystemClock.elapsedRealtime()
                        applyPrivacy(openData!!.settings)
                        scheduleAutoLock()
                    } else {
                        gate = next
                        secureLockedScreen()
                    }
                },
                data = openData,
                dataRevision = dataRevision,
                importState = importState,
                onCopySecret = ::copySecret,
                onPickMedia = { folderId ->
                    pendingImportFolderId = folderId
                    beginExternalFlow()
                    mediaPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
                },
                onPickDocuments = { folderId -> pendingImportFolderId = folderId; beginExternalFlow(); documentPicker.launch(arrayOf("*/*")) },
                onPickOtpImage = { callback -> pendingOtpImport = callback; beginExternalFlow(); otpImagePicker.launch("image/*") },
                onScanOtpCamera = { callback -> pendingOtpImport = callback; beginExternalFlow(); otpCamera.launch(null) },
                onExportFile = { item -> pendingExport = item; beginExternalFlow(); exportFile.launch(item.name) },
                onCollapseImport = { importState = importState.copy(collapsed = !importState.collapsed) },
                onClearImport = { if (!importState.active) importState = ImportUiState() },
                onSettingsApplied = ::applyPrivacy,
                onDataChanged = ::refreshData,
                onSystemUnlock = ::unlockWithSystem,
                systemAuthAvailable = systemAuthenticationAvailable(),
                onConfigureSystem = ::configureSystemAuthentication,
                onReset = ::resetVault,
                onLock = ::lockVault,
                onUserActivity = ::markUserActivity,
                onStartAudio = ::startAudioRecording,
                onStopAudio = ::stopAudioRecording,
                onCancelAudio = ::cancelAudioRecording,
                autofillEnabled = autofillEnabled,
                onConfigureAutofill = ::configureAutofill,
                vaultImportActive = pendingVaultImportUri != null,
                replacingVault = replacingVaultOnImport,
                vaultExportBusy = vaultExportBusy,
                onPickVaultImport = ::pickVaultImport,
                onImportVault = ::importVaultBackup,
                onCancelVaultImport = { pendingVaultImportUri = null; replacingVaultOnImport = false },
                onExportVault = ::pickVaultExportDestination,
                onBeginProtectedProvisioning = ::beginProtectedProvisioning,
                onFinishProtectedProvisioning = ::finishProtectedProvisioning,
            )
        }
    }

    override fun onUserInteraction() {
        super.onUserInteraction()
        markUserActivity()
    }

    override fun onStart() {
        super.onStart()
        if (!profileStateReceiverRegistered) {
            ContextCompat.registerReceiver(
                this,
                profileStateReceiver,
                IntentFilter().apply {
                    addAction(Intent.ACTION_MANAGED_PROFILE_AVAILABLE)
                    addAction(Intent.ACTION_MANAGED_PROFILE_UNAVAILABLE)
                    addAction(Intent.ACTION_MANAGED_PROFILE_UNLOCKED)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
                        addAction(Intent.ACTION_PROFILE_AVAILABLE)
                        addAction(Intent.ACTION_PROFILE_UNAVAILABLE)
                        addAction(Intent.ACTION_PROFILE_ACCESSIBLE)
                        addAction(Intent.ACTION_PROFILE_INACCESSIBLE)
                    }
                },
                ContextCompat.RECEIVER_EXPORTED,
            )
            profileStateReceiverRegistered = true
        }
        autofillEnabled = isNocturneAutofillEnabled()
        appVisible = true
        if (needsMainUiRelock(gate, openData != null, repository.isOpen()) && !repository.isOpen()) {
            openData = null
            gate = repository.initialGate()
            secureLockedScreen()
        }
        if (copiedExpiresAt > 0L && SystemClock.elapsedRealtime() >= copiedExpiresAt) clearOwnClipboard()
        if (repository.isOpen()) {
            dataRevision++
            if (protectedProvisioningKeepsSession(protectedProvisioningActive, protectedProvisioningUntil)) scheduleAutoLock()
            else {
                protectedProvisioningActive = false
                protectedProvisioningUntil = 0L
                val timeout = repository.snapshot().settings.autoLockSeconds * 1_000L
                if (SystemClock.elapsedRealtime() - lastInteraction >= timeout) lockVault() else scheduleAutoLock()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (::repository.isInitialized && repository.isOpen()) dataRevision++
        if (autofillSettingsFlow) {
            autofillSettingsFlow = false
            autofillEnabled = isNocturneAutofillEnabled()
            finishExternalFlow()
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && ::repository.isInitialized && repository.isOpen()) dataRevision++
    }

    override fun onStop() {
        if (profileStateReceiverRegistered) {
            unregisterReceiver(profileStateReceiver)
            profileStateReceiverRegistered = false
        }
        appVisible = false
        super.onStop()
        if (repository.isOpen()) {
            if (repository.snapshot().settings.clearClipboardOnBackground && copiedToken != null) clearOwnClipboard()
            scheduleAutoLock()
        }
    }

    override fun onDestroy() {
        importJob?.cancel()
        cancelAudioRecording()
        handler.removeCallbacksAndMessages(null)
        if (::repository.isInitialized) {
            runCatching { ProtectedSpaceManager.lock(this, repository) }
            repository.lock()
        }
        copiedToken = null
        super.onDestroy()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean(STATE_PROTECTED_PROVISIONING_ACTIVE, protectedProvisioningActive)
        outState.putLong(STATE_PROTECTED_PROVISIONING_UNTIL, protectedProvisioningUntil)
        super.onSaveInstanceState(outState)
    }

    private fun enqueueImports(uris: List<Uri>, folderId: String) {
        if (uris.isEmpty() || !repository.isOpen()) return
        val previous = importJob
        importJob = lifecycleScope.launch(Dispatchers.IO) {
            previous?.join()
            if (!repository.isOpen()) return@launch
            val candidates = uris.distinct().map { uri ->
                val name = displayName(uri) ?: "Файл"
                ImportCandidate(uri, name, resolvedMimeType(name, contentResolver.getType(uri) ?: "application/octet-stream"), displaySize(uri))
            }
            val uiItems = candidates.map { ImportItemState(name = it.name) }
            withContext(Dispatchers.Main) {
                if (repository.isOpen()) importState = ImportUiState(importState.items + uiItems, collapsed = false)
            }
            if (!repository.isOpen()) return@launch
            val indexed = candidates.zip(uiItems)
            for ((candidate, ui) in indexed) {
                try {
                    updateImport(ui.id, ImportStage.READING, 0.02f)
                    val input = contentResolver.openInputStream(candidate.uri) ?: error("FILE_UNAVAILABLE")
                    input.use {
                        updateImport(ui.id, ImportStage.ENCRYPTING, 0.05f)
                        repository.importFile(candidate.name, candidate.mime, candidate.size, it, folderId = folderId) { read ->
                            ensureActive()
                            val fraction = if (candidate.size > 0) (read.toFloat() / candidate.size).coerceIn(0f, 1f) else 0.5f
                            updateImportBlocking(ui.id, ImportStage.ENCRYPTING, 0.05f + fraction * 0.94f)
                        }
                    }
                    updateImport(ui.id, ImportStage.DONE, 1f)
                    withContext(Dispatchers.Main) { refreshData() }
                } catch (cancelled: CancellationException) {
                    updateImport(ui.id, ImportStage.FAILED, 1f, "Отменено при блокировке")
                    throw cancelled
                } catch (error: Throwable) {
                    updateImport(ui.id, ImportStage.FAILED, 1f, importError(error))
                }
            }
        }
    }

    private suspend fun updateImport(id: String, stage: ImportStage, progress: Float, message: String = "") = withContext(Dispatchers.Main) {
        updateImportState(id, stage, progress, message)
    }

    private fun updateImportBlocking(id: String, stage: ImportStage, progress: Float) {
        handler.post { updateImportState(id, stage, progress) }
    }

    private fun updateImportState(id: String, stage: ImportStage, progress: Float, message: String = "") {
        importState = importState.copy(items = importState.items.map { if (it.id == id) it.copy(stage = stage, progress = progress, message = message) else it })
    }

    private fun displayName(uri: Uri): String? = queryOpenable(uri, OpenableColumns.DISPLAY_NAME) { it.getString(0) }
    private fun displaySize(uri: Uri): Long = queryOpenable(uri, OpenableColumns.SIZE) { if (it.isNull(0)) -1L else it.getLong(0) } ?: -1L

    private fun <T> queryOpenable(uri: Uri, column: String, read: (Cursor) -> T): T? {
        var cursor: Cursor? = null
        return try {
            cursor = contentResolver.query(uri, arrayOf(column), null, null, null)
            if (cursor?.moveToFirst() == true) read(cursor) else null
        } finally { cursor?.close() }
    }

    private fun copySecret(value: String) {
        val manager = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val token = UUID.randomUUID().toString()
        val clip = ClipData.newPlainText("Nocturne", value)
        clip.description.extras = PersistableBundle().apply {
            putBoolean(SENSITIVE_CLIP_EXTRA, true)
            putString(NOCTURNE_CLIP_TOKEN_EXTRA, token)
        }
        manager.setPrimaryClip(clip)
        copiedToken = token
        handler.removeCallbacks(clearClipboardRunnable)
        val seconds = repository.snapshot().settings.clipboardClearSeconds
        copiedExpiresAt = if (seconds > 0) SystemClock.elapsedRealtime() + seconds * 1_000L else 0L
        if (seconds > 0) handler.postDelayed(clearClipboardRunnable, seconds * 1_000L)
    }

    private fun clearOwnClipboard() {
        val expected = copiedToken ?: return
        val manager = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val currentToken = runCatching { manager.primaryClipDescription?.extras?.getString(NOCTURNE_CLIP_TOKEN_EXTRA) }.getOrNull()
        if (currentToken == expected || (currentToken == null && !appVisible)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) manager.clearPrimaryClip()
            else manager.setPrimaryClip(ClipData.newPlainText("", ""))
        }
        copiedToken = null
        copiedExpiresAt = 0L
    }

    private fun applyPrivacy(settings: PrivacySettings) {
        if (visualDebugBuild) window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        else if (gate != Gate.Open || !settings.allowScreenshots) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        scheduleAutoLock()
    }

    private fun secureLockedScreen() { if (!visualDebugBuild) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE); handler.removeCallbacks(autoLock) }

    private fun scheduleAutoLock() {
        handler.removeCallbacks(autoLock)
        if (!repository.isOpen()) return
        val now = SystemClock.elapsedRealtime()
        val remaining = if (protectedProvisioningKeepsSession(protectedProvisioningActive, protectedProvisioningUntil, now)) {
            protectedProvisioningUntil - now
        } else {
            val timeout = repository.snapshot().settings.autoLockSeconds * 1_000L
            (timeout - (now - lastInteraction)).coerceAtLeast(0L)
        }
        handler.postDelayed(autoLock, remaining)
    }

    private fun beginProtectedProvisioning() {
        protectedProvisioningActive = true
        protectedProvisioningUntil = SystemClock.elapsedRealtime() + PROTECTED_PROVISIONING_MAX_MS
        scheduleAutoLock()
    }

    private fun finishProtectedProvisioning() {
        protectedProvisioningActive = false
        protectedProvisioningUntil = 0L
        if (repository.isOpen()) markUserActivity()
    }

    private fun beginExternalFlow() {
        scheduleAutoLock()
    }

    private fun finishExternalFlow() {
        if (!repository.isOpen()) return
        val timeout = repository.snapshot().settings.autoLockSeconds * 1_000L
        if (SystemClock.elapsedRealtime() - lastInteraction >= timeout) lockVault() else markUserActivity()
    }

    private fun markUserActivity() {
        lastInteraction = SystemClock.elapsedRealtime()
        scheduleAutoLock()
    }

    private fun lockVault() {
        importJob?.cancel()
        cancelAudioRecording()
        clearOwnClipboard()
        runCatching { ProtectedSpaceManager.lock(this, repository) }
        val next = repository.initialGate()
        openData = null
        gate = next
        repository.lock()
        secureLockedScreen()
    }

    private fun resetVault() {
        importJob?.cancel()
        cancelAudioRecording()
        clearOwnClipboard()
        runCatching { ProtectedSpaceManager.lock(this, repository) }
        repository.resetVault()
        openData = null
        gate = Gate.Create
        dataRevision++
        importState = ImportUiState()
        secureLockedScreen()
    }

    private fun refreshData() {
        if (!repository.isOpen()) return
        openData = repository.snapshotForUi()
        dataRevision++
    }

    private fun cleanupStalePlaintextCache() {
        val expected = cacheDir.canonicalFile
        cacheDir.listFiles()?.forEach { candidate ->
            val name = candidate.name
            val owned = (name.startsWith("note-") && name.endsWith(".m4a")) ||
                (name.startsWith("pdf-preview-") && name.endsWith(".pdf"))
            if (owned && candidate.isFile && candidate.parentFile?.canonicalFile == expected) candidate.delete()
        }
    }

    private fun configureAutofill() {
        autofillSettingsFlow = true
        beginExternalFlow()
        val action = if (Build.VERSION.SDK_INT >= 35) Settings.ACTION_CREDENTIAL_PROVIDER else Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE
        val intent = Intent(action, Uri.parse("package:$packageName"))
        runCatching { startActivity(intent) }.onFailure { autofillSettingsFlow = false; finishExternalFlow() }
    }

    private fun pickVaultImport() {
        beginExternalFlow()
        vaultImportPicker.launch(arrayOf(VaultRepository.BACKUP_MIME, "application/octet-stream", "*/*"))
    }

    private fun pickVaultExportDestination() {
        beginExternalFlow()
        val name = "Nocturne-${java.time.LocalDate.now()}${VaultRepository.BACKUP_EXTENSION}"
        vaultExportDocument.launch(name)
    }

    private fun importVaultBackup(password: CharArray, callback: (Result<Unit>) -> Unit) {
        val uri = pendingVaultImportUri
        if (uri == null) {
            password.fill('\u0000')
            callback(Result.failure(IllegalStateException("BACKUP_NOT_SELECTED")))
            return
        }
        markUserActivity()
        val protectedLock = ProtectedSpaceManager.lock(this, repository)
        if (protectedLock.isFailure) {
            password.fill('\u0000')
            callback(Result.failure(protectedLock.exceptionOrNull() ?: IllegalStateException("PROTECTED_SPACE_LOCK_FAILED")))
            return
        }
        lifecycleScope.launch(Dispatchers.IO) {
            val result = runCatching {
                contentResolver.openInputStream(uri)?.use { repository.importVault(it, password) } ?: error("BACKUP_UNAVAILABLE")
            }
            withContext(Dispatchers.Main) {
                if (result.isSuccess) {
                    pendingVaultImportUri = null
                    replacingVaultOnImport = false
                    showOnboarding = false
                    getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().putBoolean(PREF_ONBOARDING_DONE, true).apply()
                    refreshData()
                    gate = Gate.Open
                    lastInteraction = SystemClock.elapsedRealtime()
                    applyPrivacy(openData!!.settings)
                    scheduleAutoLock()
                }
                callback(result)
            }
        }
    }

    private fun isNocturneAutofillEnabled(): Boolean {
        val legacyEnabled = getSystemService(AutofillManager::class.java)?.hasEnabledAutofillServices() == true
        if (Build.VERSION.SDK_INT < 34) return legacyEnabled
        val component = ComponentName(this, NocturneCredentialProviderService::class.java)
        val providerEnabled = getSystemService(CredentialManager::class.java)?.isEnabledCredentialProviderService(component) == true
        return providerEnabled || legacyEnabled
    }

    private fun startAudioRecording(callback: (Result<Unit>) -> Unit) {
        markUserActivity()
        if (audioRecorder != null) {
            callback(Result.failure(IllegalStateException("RECORDING_ACTIVE")))
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            startAudioRecordingNow(callback)
        } else {
            pendingAudioStart = callback
            audioPermission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    @Suppress("DEPRECATION")
    private fun startAudioRecordingNow(callback: (Result<Unit>) -> Unit) {
        val target = File(cacheDir, "note-${UUID.randomUUID()}.m4a")
        val recorder = MediaRecorder()
        val result = runCatching {
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            recorder.setAudioEncodingBitRate(96_000)
            recorder.setAudioSamplingRate(44_100)
            recorder.setOutputFile(target.absolutePath)
            recorder.prepare()
            recorder.start()
            audioRecorder = recorder
            audioRecordingFile = target
            audioRecordingStartedAt = SystemClock.elapsedRealtime()
        }
        if (result.isFailure) {
            runCatching { recorder.release() }
            target.delete()
        }
        callback(result)
    }

    private fun stopAudioRecording(callback: (Result<AudioAttachment>) -> Unit) {
        markUserActivity()
        val recorder = audioRecorder
        val target = audioRecordingFile
        val duration = (SystemClock.elapsedRealtime() - audioRecordingStartedAt).coerceAtLeast(0L)
        audioRecorder = null
        audioRecordingFile = null
        audioRecordingStartedAt = 0L
        if (recorder == null || target == null) {
            callback(Result.failure(IllegalStateException("NO_RECORDING")))
            return
        }
        lifecycleScope.launch(Dispatchers.IO) {
            val result = runCatching {
                recorder.stop()
                recorder.release()
                require(duration >= 500L && target.length() > 0L) { "RECORDING_TOO_SHORT" }
                val item = target.inputStream().use {
                    repository.importFile(
                        name = "Аудиозаметка.m4a",
                        mime = "audio/mp4",
                        expectedSize = target.length(),
                        input = it,
                        purpose = StoredFile.PURPOSE_NOTE_AUDIO,
                    )
                }
                AudioAttachment(item.id, duration)
            }
            runCatching { recorder.release() }
            target.delete()
            withContext(Dispatchers.Main) {
                if (result.isSuccess) refreshData()
                callback(result)
            }
        }
    }

    private fun cancelAudioRecording() {
        pendingAudioStart = null
        val recorder = audioRecorder.also { audioRecorder = null }
        val target = audioRecordingFile.also { audioRecordingFile = null }
        audioRecordingStartedAt = 0L
        runCatching { recorder?.stop() }
        runCatching { recorder?.release() }
        target?.delete()
    }

    private fun systemAuthenticationAvailable(): Boolean {
        if (!deviceCredential.isSupported()) return false
        return BiometricManager.from(this).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS
    }

    private fun unlockWithSystem(callback: (UnlockResult) -> Unit) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            callback(UnlockResult(false))
            return
        }
        val cipher = runCatching { deviceCredential.decryptCipher(repository.systemQuickIv()) }
            .getOrElse { callback(UnlockResult(false)); return }
        showSystemPrompt("Открыть Nocturne", cipher) { result ->
            callback(result.mapCatching(repository::unlockSystem).getOrElse { UnlockResult(false) })
        }
    }

    private fun configureSystemAuthentication(master: String, callback: (Result<Unit>) -> Unit) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            callback(Result.failure(UnsupportedOperationException("SYSTEM_AUTH_UNSUPPORTED")))
            return
        }
        val cipher = runCatching { deviceCredential.encryptCipher() }
            .getOrElse { callback(Result.failure(it)); return }
        showSystemPrompt("Подключить биометрию Android", cipher) { result ->
            callback(result.mapCatching {
                repository.configureSystemQuick(it, master.toCharArray())
            })
        }
    }

    private fun showSystemPrompt(title: String, cipher: Cipher, callback: (Result<Cipher>) -> Unit) {
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                val authenticated = result.cryptoObject?.cipher
                callback(if (authenticated != null) Result.success(authenticated) else Result.failure(IllegalStateException("AUTH_CIPHER_MISSING")))
            }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                callback(Result.failure(IllegalStateException(errString.toString())))
            }
        })
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle("Используйте отпечаток пальца или распознавание лица")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .build()
        prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }

    private data class ImportCandidate(val uri: Uri, val name: String, val mime: String, val size: Long)

    private fun importError(error: Throwable): String = when (error.message) {
        "FILE_TOO_LARGE" -> "Файл больше 1 ГБ"
        "VAULT_LOCKED" -> "Хранилище заблокировано"
        else -> "Не удалось импортировать"
    }

    companion object {
        private const val SENSITIVE_CLIP_EXTRA = "android.content.extra.IS_SENSITIVE"
        private const val NOCTURNE_CLIP_TOKEN_EXTRA = "com.nocturne.vault.CLIP_TOKEN"
        private const val MAX_QR_SOURCE_DIMENSION = 16_384
        private const val MAX_QR_DECODE_DIMENSION = 2_048
        private const val PREFS_NAME = "nocturne_ui"
        private const val PREF_ONBOARDING_DONE = "onboarding_done_v1"
        private const val STATE_PROTECTED_PROVISIONING_ACTIVE = "protected_provisioning_active"
        private const val STATE_PROTECTED_PROVISIONING_UNTIL = "protected_provisioning_until"
        private const val PROTECTED_PROVISIONING_MAX_MS = 30 * 60_000L
    }

    private val clearClipboardRunnable = Runnable(::clearOwnClipboard)
}

internal fun needsMainUiRelock(gate: Gate, hasDecryptedSnapshot: Boolean, repositoryOpen: Boolean): Boolean =
    gate == Gate.Open || hasDecryptedSnapshot || repositoryOpen

internal fun protectedProvisioningKeepsSession(
    active: Boolean,
    deadlineElapsed: Long,
    nowElapsed: Long = SystemClock.elapsedRealtime(),
): Boolean = active && deadlineElapsed > nowElapsed
