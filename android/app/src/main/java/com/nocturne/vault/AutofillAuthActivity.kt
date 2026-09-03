package com.nocturne.vault

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.view.View
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import android.service.autofill.Dataset
import javax.crypto.Cipher

class AutofillAuthActivity : FragmentActivity() {
    private lateinit var repository: VaultRepository
    private val deviceCredential = DeviceCredentialCrypto()
    private var gate by mutableStateOf<Gate>(Gate.Master)
    private var authorized by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        window.decorView.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        repository = (application as NocturneApplication).repository
        gate = repository.initialGate()
        setContent {
            NocturneTheme { NocturneBackground {
                if (authorized) AuthorizedAutofillContent() else AutofillUnlockContent()
            } }
        }
    }

    override fun onStop() {
        super.onStop()
        if (!isChangingConfigurations && !isFinishing) cancelFlow()
    }

    @Composable
    private fun AutofillUnlockContent() {
        var value by remember(gate) { mutableStateOf("") }
        var error by remember(gate) { mutableStateOf("") }
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().padding(horizontal = 24.dp, vertical = 28.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Подтвердите вставку", color = NocturneInk, fontSize = 30.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(10.dp))
            Text("Nocturne запрашивает ключ перед каждой вставкой или сохранением данных.", color = NocturneMuted)
            Spacer(Modifier.height(28.dp))
            when (val current = gate) {
                Gate.Create -> {
                    Text("Хранилище ещё не создано. Сначала откройте Nocturne и настройте мастер-пароль.", color = NocturneMuted)
                    Spacer(Modifier.height(16.dp))
                    NocturneButton("Открыть Nocturne") {
                        startActivity(Intent(this@AutofillAuthActivity, MainActivity::class.java))
                        cancelFlow()
                    }
                }
                is Gate.Quick -> when (current.mode) {
                    QuickMode.PATTERN -> {
                        Text("Нарисуйте ключ", color = NocturneMuted)
                        PatternPad(Modifier.height(280.dp), showTrace = !repository.hidePatternTrace()) { pattern ->
                            val result = repository.unlockQuick(QuickMode.PATTERN, pattern.toCharArray())
                            if (result.unlocked) authorized = true else error = retryMessage(result)
                        }
                    }
                    QuickMode.SYSTEM -> Button(onClick = ::unlockWithSystem, Modifier.fillMaxWidth()) { Text("Использовать биометрию Android") }
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
            if (gate is Gate.Quick) TextButton(onClick = { gate = Gate.Master }) { Text("Ввести мастер-пароль") }
            TextButton(onClick = ::cancelFlow, modifier = Modifier.fillMaxWidth()) { Text("Отмена") }
        }
    }

    @Composable
    private fun AuthorizedAutofillContent() {
        when (intent.getStringExtra(EXTRA_MODE)) {
            MODE_SAVE -> SaveAutofillContent()
            else -> FillAutofillContent()
        }
    }

    @Composable
    private fun FillAutofillContent() {
        val webDomain = intent.getStringExtra(EXTRA_WEB_DOMAIN).orEmpty()
        val targetPackage = intent.getStringExtra(EXTRA_PACKAGE_NAME).orEmpty()
        val packageSignature = intent.getStringExtra(EXTRA_PACKAGE_SIGNATURE).orEmpty()
        val target = webDomain.ifBlank { targetPackage }
        val all = remember { repository.snapshotForUi().passwords }
        var query by remember { mutableStateOf("") }
        var adding by remember { mutableStateOf(false) }
        var pendingWebDisclosure by remember { mutableStateOf<PasswordItem?>(null) }
        val matching = remember(webDomain, targetPackage, packageSignature, all, query) { autofillCandidates(all, webDomain, targetPackage, packageSignature, query) }

        pendingWebDisclosure?.let { item ->
            AlertDialog(
                onDismissRequest = { pendingWebDisclosure = null },
                title = { Text("Непроверенный сайт") },
                text = { Text("Приложение $targetPackage заявляет, что показывает сайт $webDomain, но Android не подтвердил эту связь. Передать выбранный логин и пароль этому приложению?") },
                confirmButton = { TextButton(onClick = { pendingWebDisclosure = null; returnDataset(item, confirmedWebDisclosure = true) }) { Text("Передать") } },
                dismissButton = { TextButton(onClick = { pendingWebDisclosure = null }) { Text("Отмена") } },
            )
        }

        if (adding) {
            NewAutofillAccount(target, webDomain, targetPackage, packageSignature, onBack = { adding = false }) { item ->
                repository.savePassword(item)
                returnDataset(item)
            }
            return
        }

        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().padding(20.dp)) {
            Text("Выберите аккаунт", color = NocturneInk, fontSize = 30.sp, fontWeight = FontWeight.SemiBold)
            Text(target, color = NocturneMuted)
            Spacer(Modifier.height(16.dp))
            PrivateTextField("Поиск", query, { query = it.take(120) })
            Spacer(Modifier.height(12.dp))
            NocturneButton("Добавить аккаунт", onClick = { adding = true })
            Spacer(Modifier.height(14.dp))
            if (matching.isEmpty()) Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Rounded.Search, null, tint = NocturneAccent)
                    Text(if (query.isBlank()) "Для этого приложения записей пока нет" else "Ничего не найдено", color = NocturneMuted)
                }
            } else LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(matching, key = { it.id }) { item ->
                    GlassCard(Modifier.fillMaxWidth().clickable { if (webDomain.isBlank()) returnDataset(item) else pendingWebDisclosure = item }) {
                        Column(Modifier.padding(16.dp)) {
                            Text(item.title, color = NocturneInk, fontWeight = FontWeight.SemiBold)
                            Text(item.username.ifBlank { "Логин не указан" }, color = NocturneMuted)
                        }
                    }
                }
            }
            TextButton(onClick = ::cancelFlow, modifier = Modifier.fillMaxWidth()) { Text("Отмена") }
        }
    }

    @Composable
    private fun NewAutofillAccount(
        target: String,
        webDomain: String,
        targetPackage: String,
        packageSignature: String,
        onBack: () -> Unit,
        onSave: (PasswordItem) -> Unit,
    ) {
        var title by remember(target) { mutableStateOf(target.take(120)) }
        var username by remember { mutableStateOf("") }
        var password by remember { mutableStateOf("") }
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().padding(20.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Новый аккаунт", color = NocturneInk, fontSize = 30.sp, fontWeight = FontWeight.SemiBold)
            Text("Сохранится для $target", color = NocturneMuted)
            Spacer(Modifier.height(20.dp))
            PrivateTextField("Название", title, { title = it.take(120) })
            Spacer(Modifier.height(10.dp))
            PrivateTextField("Логин", username, { username = it.take(4096) })
            Spacer(Modifier.height(10.dp))
            SecretTextField("Пароль", password, { password = it.take(4096) }, allowGenerate = true)
            Spacer(Modifier.height(18.dp))
            NocturneButton("Сохранить и войти", enabled = title.isNotBlank() && username.isNotBlank() && password.isNotBlank()) {
                val scope = if (webDomain.isNotBlank()) "https://$webDomain" else "android-app://$targetPackage"
                onSave(PasswordItem(title = title.trim(), username = username, password = password, url = scope, appSignatureSha256 = packageSignature.takeIf { webDomain.isBlank() }.orEmpty()))
                password = ""
            }
            TextButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Назад") }
        }
    }

    @Composable
    private fun SaveAutofillContent() {
        val token = intent.getStringExtra(EXTRA_SAVE_TOKEN).orEmpty()
        val draft = remember(token) { AutofillPendingStore.take(token) }
        if (draft == null) {
            LaunchedEffect(token) { repository.lock(); finish() }
            return
        }
        var title by remember(draft) { mutableStateOf(draft.displayTarget.ifBlank { "Новый аккаунт" }) }
        var confirmUnverifiedWeb by remember { mutableStateOf(false) }
        fun saveDraft() {
            repository.savePassword(PasswordItem(title = title.trim(), username = draft.username, password = draft.password, url = draft.storedScope, appSignatureSha256 = draft.packageSignature.takeIf { draft.webDomain.isBlank() }.orEmpty()))
            Toast.makeText(this@AutofillAuthActivity, "Аккаунт сохранён в Nocturne", Toast.LENGTH_SHORT).show()
            repository.lock()
            finish()
        }
        if (confirmUnverifiedWeb) AlertDialog(
            onDismissRequest = { confirmUnverifiedWeb = false },
            title = { Text("Непроверенный сайт") },
            text = { Text("Приложение ${draft.packageName} заявляет сайт ${draft.webDomain}, но Android не подтвердил эту связь. Сохранить данные для этого сайта?") },
            confirmButton = { TextButton(onClick = { confirmUnverifiedWeb = false; saveDraft() }) { Text("Сохранить") } },
            dismissButton = { TextButton(onClick = { confirmUnverifiedWeb = false }) { Text("Отмена") } },
        )
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().padding(horizontal = 24.dp, vertical = 28.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Сохранить аккаунт", color = NocturneInk, fontSize = 30.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(10.dp))
            Text(draft.displayTarget, color = NocturneMuted)
            Spacer(Modifier.height(22.dp))
            PrivateTextField("Название", title, { title = it.take(120) })
            Spacer(Modifier.height(10.dp))
            Text(draft.username.ifBlank { "Логин не указан" }, color = NocturneMuted)
            Spacer(Modifier.height(18.dp))
            NocturneButton("Сохранить в пароли", enabled = title.isNotBlank()) {
                if (draft.webDomain.isBlank()) saveDraft() else confirmUnverifiedWeb = true
            }
            TextButton(onClick = { repository.lock(); setResult(Activity.RESULT_CANCELED); finish() }) { Text("Отмена") }
        }
    }

    override fun onDestroy() {
        if (isFinishing && intent.getStringExtra(EXTRA_MODE) == MODE_SAVE) AutofillPendingStore.take(intent.getStringExtra(EXTRA_SAVE_TOKEN).orEmpty())
        if (!isChangingConfigurations) repository.lock()
        super.onDestroy()
    }

    private fun returnDataset(item: PasswordItem, confirmedWebDisclosure: Boolean = false) {
        val webDomain = intent.getStringExtra(EXTRA_WEB_DOMAIN).orEmpty()
        val targetPackage = intent.getStringExtra(EXTRA_PACKAGE_NAME).orEmpty()
        val packageSignature = intent.getStringExtra(EXTRA_PACKAGE_SIGNATURE).orEmpty()
        if (!AutofillScope.matches(item, webDomain, targetPackage, packageSignature)) return cancelFlow()
        if (webDomain.isNotBlank() && !confirmedWebDisclosure) return cancelFlow()
        val usernameId = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(EXTRA_USERNAME_ID, AutofillId::class.java) else @Suppress("DEPRECATION") intent.getParcelableExtra(EXTRA_USERNAME_ID)
        val passwordId = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(EXTRA_PASSWORD_ID, AutofillId::class.java) else @Suppress("DEPRECATION") intent.getParcelableExtra(EXTRA_PASSWORD_ID)
        if (usernameId == null && passwordId == null) return cancelFlow()
        val values = autofillValuePlan(usernameId != null, passwordId != null, item)
        val presentation = RemoteViews(packageName, android.R.layout.simple_list_item_1).apply { setTextViewText(android.R.id.text1, item.title) }
        val builder = Dataset.Builder(presentation)
        if (usernameId != null && values.username != null) builder.setValue(usernameId, AutofillValue.forText(values.username), presentation)
        if (passwordId != null && values.password != null) builder.setValue(passwordId, AutofillValue.forText(values.password), presentation)
        val reply = Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, builder.build())
        setResult(Activity.RESULT_OK, reply)
        repository.lock()
        finish()
    }

    private fun cancelFlow() {
        setResult(Activity.RESULT_CANCELED)
        repository.lock()
        finish()
    }

    private fun unlockWithSystem() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        val cipher = runCatching { deviceCredential.decryptCipher(repository.systemQuickIv()) }.getOrNull() ?: return
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                val authenticated = result.cryptoObject?.cipher ?: return
                val unlocked = runCatching { repository.unlockSystem(authenticated) }.getOrDefault(UnlockResult(false))
                if (unlocked.unlocked) authorized = true
            }
        })
        prompt.authenticate(BiometricPrompt.PromptInfo.Builder()
            .setTitle("Подтвердите вставку")
            .setSubtitle("Используйте отпечаток пальца или распознавание лица")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .build(), BiometricPrompt.CryptoObject(cipher))
    }

    private fun retryMessage(result: UnlockResult) = if (result.retryAfterSeconds > 0) "Слишком много попыток. Повторите через ${result.retryAfterSeconds} с" else "Неверный ключ"

    companion object {
        const val EXTRA_MODE = "mode"
        const val EXTRA_USERNAME_ID = "username_id"
        const val EXTRA_PASSWORD_ID = "password_id"
        const val EXTRA_WEB_DOMAIN = "web_domain"
        const val EXTRA_PACKAGE_NAME = "package_name"
        const val EXTRA_PACKAGE_SIGNATURE = "package_signature"
        const val EXTRA_REQUEST_ID = "request_id"
        const val EXTRA_SAVE_TOKEN = "save_token"
        const val MODE_FILL = "fill"
        const val MODE_SAVE = "save"
    }
}

internal data class AutofillValuePlan(val username: String?, val password: String?)

internal fun autofillValuePlan(hasUsernameField: Boolean, hasPasswordField: Boolean, item: PasswordItem) = AutofillValuePlan(
    username = item.username.takeIf { hasUsernameField },
    password = item.password.takeIf { hasPasswordField },
)
