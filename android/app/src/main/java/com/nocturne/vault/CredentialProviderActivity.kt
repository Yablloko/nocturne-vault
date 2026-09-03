package com.nocturne.vault

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.annotation.RequiresApi
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.credentials.CreatePasswordRequest
import androidx.credentials.CreatePasswordResponse
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetPasswordOption
import androidx.credentials.PasswordCredential
import androidx.credentials.provider.PendingIntentHandler
import androidx.credentials.provider.ProviderCreateCredentialRequest
import androidx.credentials.provider.ProviderGetCredentialRequest
import androidx.fragment.app.FragmentActivity

@RequiresApi(34)
class CredentialProviderActivity : FragmentActivity() {
    private lateinit var repository: VaultRepository
    private val deviceCredential = DeviceCredentialCrypto()
    private var gate by mutableStateOf<Gate>(Gate.Master)
    private var authorized by mutableStateOf(false)
    private var flowError by mutableStateOf("")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        window.decorView.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        repository = (application as NocturneApplication).repository
        gate = repository.initialGate()
        if (!hasValidRequest()) flowError = "Android не передал данные для входа. Закройте окно и попробуйте ещё раз."
        setContent {
            NocturneTheme {
                NocturneBackground {
                    when {
                        flowError.isNotBlank() -> ProviderError(flowError)
                        !authorized -> ProviderUnlockContent()
                        else -> AuthorizedProviderContent()
                    }
                }
            }
        }
    }

    override fun onStop() {
        super.onStop()
        if (!isChangingConfigurations && !isFinishing) cancelFlow()
    }

    private fun hasValidRequest(): Boolean = when (intent.getStringExtra(EXTRA_MODE)) {
        MODE_UNLOCK -> PendingIntentHandler.retrieveBeginGetCredentialRequest(intent) != null
        MODE_GET, MODE_SEARCH -> PendingIntentHandler.retrieveProviderGetCredentialRequest(intent) != null
        MODE_CREATE -> PendingIntentHandler.retrieveProviderCreateCredentialRequest(intent) != null
        else -> false
    }

    @Composable
    private fun ProviderUnlockContent() {
        var value by remember(gate) { mutableStateOf("") }
        var error by remember(gate) { mutableStateOf("") }
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().padding(horizontal = 24.dp, vertical = 28.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Открыть Nocturne", color = NocturneInk, fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            Text("Подтвердите вход перед выбором или сохранением аккаунта.", color = NocturneMuted)
            Spacer(Modifier.height(24.dp))
            when (val current = gate) {
                Gate.Create -> {
                    Text("Хранилище ещё не создано. Сначала откройте Nocturne и настройте мастер-пароль.", color = NocturneMuted)
                    Spacer(Modifier.height(16.dp))
                    NocturneButton("Открыть Nocturne") {
                        startActivity(Intent(this@CredentialProviderActivity, MainActivity::class.java))
                        cancelFlow()
                    }
                }
                is Gate.Quick -> when (current.mode) {
                    QuickMode.PATTERN -> {
                        Text("Нарисуйте ключ", color = NocturneMuted)
                        PatternPad(Modifier.height(260.dp), showTrace = !repository.hidePatternTrace()) { pattern ->
                            val result = repository.unlockQuick(QuickMode.PATTERN, pattern.toCharArray())
                            if (result.unlocked) authorized = true else error = retryMessage(result)
                        }
                    }
                    QuickMode.SYSTEM -> Button(onClick = ::unlockWithSystem, modifier = Modifier.fillMaxWidth()) { Text("Использовать биометрию Android") }
                    else -> {
                        SecretTextField("Быстрый PIN", value, { value = it.filter(Char::isDigit).take(12); error = "" }, numeric = true)
                        Spacer(Modifier.height(12.dp))
                        NocturneButton("Продолжить", enabled = value.isNotBlank()) {
                            val result = repository.unlockQuick(QuickMode.PIN, value.toCharArray())
                            value = ""
                            if (result.unlocked) authorized = true else error = retryMessage(result)
                        }
                    }
                }
                else -> {
                    SecretTextField("Мастер-пароль", value, { value = it; error = "" })
                    Spacer(Modifier.height(12.dp))
                    NocturneButton("Продолжить", enabled = value.isNotBlank()) {
                        val result = repository.unlockMaster(value.toCharArray())
                        value = ""
                        if (result.unlocked) authorized = true else error = retryMessage(result)
                    }
                }
            }
            InlineError(error)
            if (gate is Gate.Quick) TextButton(onClick = { gate = Gate.Master; error = "" }) { Text("Ввести мастер-пароль") }
            TextButton(onClick = ::cancelFlow, modifier = Modifier.fillMaxWidth()) { Text("Отмена") }
        }
    }

    @Composable
    private fun AuthorizedProviderContent() {
        when (intent.getStringExtra(EXTRA_MODE)) {
            MODE_UNLOCK -> LaunchedEffect(Unit) { completeUnlock() }
            MODE_GET -> LaunchedEffect(Unit) { completeSelectedCredential() }
            MODE_SEARCH -> ProviderSearchContent()
            MODE_CREATE -> ProviderCreateContent()
        }
    }

    @Composable
    private fun ProviderSearchContent() {
        val request = remember { PendingIntentHandler.retrieveProviderGetCredentialRequest(intent) }
        if (request == null) return ProviderError("Запрос входа устарел. Вернитесь в приложение и повторите попытку.")
        if (request.callingAppInfo.isOriginPopulated()) return ProviderError("Вход на сайтах через системный менеджер пока отключён: браузер не прошёл проверку Nocturne. Используйте обычное автозаполнение Android.")
        val targetPackage = request.callingAppInfo.packageName
        val targetSignature = remember(targetPackage) { packageSigningDigest(this, targetPackage) }
        val target = remember(targetPackage) { applicationLabel(targetPackage) }
        val allowed = remember(request) { allowedUserIds(request) }
        val all = remember { repository.snapshotForUi().passwords }
        var query by remember { mutableStateOf("") }
        var adding by remember { mutableStateOf(false) }
        val visible = remember(query, all, allowed, targetPackage, targetSignature) { credentialManagerCandidates(all, targetPackage, targetSignature, allowed, query) }

        if (adding) {
            NewProviderAccount(target, targetPackage, targetSignature, allowed, onBack = { adding = false }) { item ->
                repository.savePassword(item)
                returnProviderCredential(request, item)
            }
            return
        }

        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().padding(20.dp)) {
            Text("Аккаунты", color = NocturneInk, fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
            Text("Для $target", color = NocturneMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(16.dp))
            PrivateTextField("Поиск", query, { query = it.take(120) })
            Spacer(Modifier.height(12.dp))
            NocturneButton("Добавить аккаунт", onClick = { adding = true })
            Spacer(Modifier.height(14.dp))
            if (visible.isEmpty()) {
                Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Rounded.Search, null, tint = NocturneAccent)
                        Text(if (query.isBlank()) "Для этого приложения записей пока нет" else "Ничего не найдено", color = NocturneMuted)
                    }
                }
            } else {
                LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(visible, key = { it.id }) { item -> ProviderCredentialRow(item) { returnProviderCredential(request, item) } }
                }
            }
            TextButton(onClick = ::cancelFlow, modifier = Modifier.fillMaxWidth()) { Text("Отмена") }
        }
    }

    @Composable
    private fun NewProviderAccount(
        target: String,
        targetPackage: String,
        targetSignature: String,
        allowedUserIds: Set<String>,
        onBack: () -> Unit,
        onSave: (PasswordItem) -> Unit,
    ) {
        var title by remember(target) { mutableStateOf(target.take(120)) }
        var username by remember { mutableStateOf(allowedUserIds.singleOrNull().orEmpty()) }
        var password by remember { mutableStateOf("") }
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().padding(20.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Новый аккаунт", color = NocturneInk, fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
            Text("Сохранится для $target", color = NocturneMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(20.dp))
            PrivateTextField("Название", title, { title = it.take(120) })
            Spacer(Modifier.height(10.dp))
            PrivateTextField("Логин", username, { username = it.take(4096) })
            Spacer(Modifier.height(10.dp))
            SecretTextField("Пароль", password, { password = it.take(4096) }, allowGenerate = true)
            Spacer(Modifier.height(18.dp))
            NocturneButton("Сохранить и войти", enabled = title.isNotBlank() && username.isNotBlank() && password.isNotBlank()) {
                if (allowedUserIds.isNotEmpty() && username !in allowedUserIds) {
                    flowError = "Это приложение запросило другой логин. Вернитесь назад и выберите разрешённый аккаунт."
                } else {
                    onSave(PasswordItem(title = title.trim(), username = username, password = password, url = "android-app://$targetPackage", appSignatureSha256 = targetSignature))
                    password = ""
                }
            }
            TextButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Назад") }
        }
    }

    @Composable
    private fun ProviderCreateContent() {
        val providerRequest = remember { PendingIntentHandler.retrieveProviderCreateCredentialRequest(intent) }
        val request = providerRequest?.callingRequest as? CreatePasswordRequest
        if (providerRequest == null || request == null) return ProviderError("Nocturne не получил логин и пароль от приложения.")
        if (providerRequest.callingAppInfo.isOriginPopulated()) return ProviderError("Сохранение пароля сайта через системный менеджер пока отключено: браузер не прошёл проверку Nocturne.")
        val targetPackage = providerRequest.callingAppInfo.packageName
        val targetSignature = remember(targetPackage) { packageSigningDigest(this, targetPackage) }
        val target = remember(targetPackage) { applicationLabel(targetPackage) }
        var title by remember(target) { mutableStateOf(target.take(120)) }
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().padding(20.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Сохранить аккаунт", color = NocturneInk, fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
            Text(target, color = NocturneMuted)
            Spacer(Modifier.height(20.dp))
            PrivateTextField("Название", title, { title = it.take(120) })
            Spacer(Modifier.height(10.dp))
            PrivateTextField("Логин", request.id, {}, modifier = Modifier.clickable(enabled = false) {})
            Spacer(Modifier.height(10.dp))
            SecretTextField("Пароль", request.password, {})
            Spacer(Modifier.height(18.dp))
            NocturneButton("Сохранить в Nocturne", enabled = title.isNotBlank() && request.id.isNotBlank() && request.password.isNotBlank()) {
                repository.savePassword(PasswordItem(title = title.trim(), username = request.id, password = request.password, url = "android-app://$targetPackage", appSignatureSha256 = targetSignature))
                val result = Intent()
                PendingIntentHandler.setCreateCredentialResponse(result, CreatePasswordResponse())
                setResult(Activity.RESULT_OK, result)
                repository.lock()
                finish()
            }
            TextButton(onClick = ::cancelFlow, modifier = Modifier.fillMaxWidth()) { Text("Отмена") }
        }
    }

    @Composable
    private fun ProviderCredentialRow(item: PasswordItem, onClick: () -> Unit) {
        GlassCard(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
            Row(Modifier.padding(15.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Key, null, tint = NocturneAccent)
                Column(Modifier.weight(1f)) {
                    Text(item.title, color = NocturneInk, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(item.username.ifBlank { "Логин не указан" }, color = NocturneMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }

    @Composable
    private fun ProviderError(message: String) {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(Icons.Rounded.Key, null, tint = NocturneDanger)
            Spacer(Modifier.height(12.dp))
            Text("Не удалось продолжить", color = NocturneInk, fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            Text(message, color = NocturneMuted)
            Spacer(Modifier.height(16.dp))
            NocturneButton("Закрыть", onClick = ::cancelFlow)
        }
    }

    private fun completeUnlock() {
        val request = PendingIntentHandler.retrieveBeginGetCredentialRequest(intent) ?: return failFlow("Запрос входа устарел.")
        if (request.callingAppInfo?.isOriginPopulated() == true) return failFlow("Браузер не прошёл проверку Nocturne.")
        val result = Intent()
        PendingIntentHandler.setBeginGetCredentialResponse(result, buildUnlockedCredentialResponse(this, request, repository.snapshotForUi().passwords))
        setResult(Activity.RESULT_OK, result)
        repository.lock()
        finish()
    }

    private fun completeSelectedCredential() {
        val request = PendingIntentHandler.retrieveProviderGetCredentialRequest(intent) ?: return failFlow("Запрос входа устарел.")
        if (request.callingAppInfo.isOriginPopulated()) return failFlow("Браузер не прошёл проверку Nocturne.")
        val id = intent.getStringExtra(EXTRA_ITEM_ID).orEmpty()
        val item = repository.snapshotForUi().passwords.firstOrNull { it.id == id } ?: return failFlow("Аккаунт больше не существует.")
        returnProviderCredential(request, item)
    }

    private fun returnProviderCredential(request: ProviderGetCredentialRequest, item: PasswordItem) {
        if (request.callingAppInfo.isOriginPopulated()) return failFlow("Браузер не прошёл проверку Nocturne.")
        val caller = request.callingAppInfo.packageName
        val callerSignature = packageSigningDigest(this, caller)
        val allowed = allowedUserIds(request)
        if (item.username.isBlank() || (allowed.isNotEmpty() && item.username !in allowed)) return failFlow("Этот логин не подходит для запроса приложения.")
        if (!AutofillScope.matches(item, "", caller, callerSignature)) return failFlow("Аккаунт не относится к этому приложению или был сохранён для другой подписи.")
        val result = Intent()
        PendingIntentHandler.setGetCredentialResponse(result, GetCredentialResponse(PasswordCredential(item.username, item.password)), request)
        setResult(Activity.RESULT_OK, result)
        repository.lock()
        finish()
    }

    private fun allowedUserIds(request: ProviderGetCredentialRequest): Set<String> = request.credentialOptions
        .filterIsInstance<GetPasswordOption>()
        .flatMap { it.allowedUserIds }
        .toSet()

    private fun applicationLabel(targetPackage: String): String = runCatching {
        val info = if (Build.VERSION.SDK_INT >= 33) packageManager.getApplicationInfo(targetPackage, PackageManager.ApplicationInfoFlags.of(0))
        else @Suppress("DEPRECATION") packageManager.getApplicationInfo(targetPackage, 0)
        packageManager.getApplicationLabel(info).toString().take(120)
    }.getOrDefault(targetPackage)

    private fun unlockWithSystem() {
        val cipher = runCatching { deviceCredential.decryptCipher(repository.systemQuickIv()) }.getOrNull() ?: return
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                val authenticated = result.cryptoObject?.cipher ?: return
                val unlocked = runCatching { repository.unlockSystem(authenticated) }.getOrDefault(UnlockResult(false))
                if (unlocked.unlocked) authorized = true else flowError = retryMessage(unlocked)
            }
        })
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle("Открыть Nocturne")
                .setSubtitle("Используйте отпечаток пальца или распознавание лица")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .build(),
            BiometricPrompt.CryptoObject(cipher),
        )
    }

    private fun retryMessage(result: UnlockResult) = if (result.retryAfterSeconds > 0) "Слишком много попыток. Повторите через ${result.retryAfterSeconds} с" else "Неверный ключ"

    private fun failFlow(message: String) { flowError = message }

    private fun cancelFlow() {
        setResult(Activity.RESULT_CANCELED)
        repository.lock()
        finish()
    }

    override fun onDestroy() {
        if (!isChangingConfigurations) repository.lock()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_MODE = "credential_provider_mode"
        const val EXTRA_ITEM_ID = "credential_provider_item_id"
        const val MODE_UNLOCK = "unlock"
        const val MODE_GET = "get"
        const val MODE_SEARCH = "search"
        const val MODE_CREATE = "create"
    }
}
