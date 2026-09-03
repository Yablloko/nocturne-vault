package com.nocturne.vault

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.DeleteForever
import androidx.compose.material.icons.rounded.FileDownload
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
private fun AuthFrame(
    eyebrow: String,
    title: String,
    copy: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding(),
    ) {
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 32.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(
                Icons.Rounded.Security,
                null,
                tint = NocturneAccent,
                modifier = Modifier.size(52.dp).border(1.dp, NocturneLine, CircleShape).padding(13.dp),
            )
            Spacer(Modifier.height(24.dp))
            Text(eyebrow.uppercase(), color = NocturneAccent, fontSize = 11.sp, letterSpacing = 1.4.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(5.dp))
            Text(title, color = NocturneInk, fontSize = 38.sp, lineHeight = 40.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-1.2).sp)
            Spacer(Modifier.height(10.dp))
            Text(copy, color = NocturneMuted, lineHeight = 21.sp)
            Spacer(Modifier.height(26.dp))
            GlassCard(Modifier.fillMaxWidth(), strong = true) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
            }
        }
    }
}

@Composable
fun CreateVaultScreen(repository: VaultRepository, done: () -> Unit, importVault: () -> Unit) {
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val strong = SecurityPolicy.isStrongMaster(password)
    val matches = password.isNotEmpty() && password == confirm

    AuthFrame(
        "Первый запуск",
        "Новое хранилище",
        "Создайте мастер-пароль. Он понадобится для восстановления доступа, если PIN или рисунок окажется забыт.",
    ) {
        SecretTextField("Мастер-пароль", password, { password = it; error = "" }, allowGenerate = true)
        SecretTextField("Повторите пароль", confirm, { confirm = it; error = "" })
        PasswordChecklist(password)
        if (confirm.isNotEmpty() && !matches) InlineError("Пароли не совпадают")
        InlineError(error)
        NocturneButton("Создать хранилище", enabled = strong && matches, loading = loading) {
            loading = true
            scope.launch {
                val result = withContext(Dispatchers.Default) { runCatching { repository.create(password.toCharArray()) } }
                loading = false
                result.onSuccess { done() }.onFailure { error = "Не удалось создать хранилище. Проверьте требования к паролю." }
            }
        }
        OutlinedButton(onClick = importVault, enabled = !loading, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Rounded.FileDownload, null, Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Импортировать хранилище")
        }
    }
}

@Composable
fun ImportVaultScreen(
    replacingExisting: Boolean,
    importVault: (CharArray, (Result<Unit>) -> Unit) -> Unit,
    cancel: () -> Unit,
) {
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    AuthFrame(
        if (replacingExisting) "Восстановление" else "Первый запуск",
        "Импорт хранилища",
        if (replacingExisting) "Введите мастер-пароль резервной копии. Текущее хранилище будет заменено только после полной проверки копии."
        else "Введите мастер-пароль резервной копии. После проверки все записи и файлы появятся в Nocturne.",
    ) {
        SecretTextField("Мастер-пароль копии", password, { password = it; error = "" })
        Text("Быстрый вход не переносится — его можно настроить заново после импорта.", color = NocturneMuted, fontSize = 12.sp, lineHeight = 17.sp)
        InlineError(error)
        NocturneButton("Проверить и импортировать", enabled = password.isNotBlank(), loading = loading) {
            loading = true
            val secret = password.toCharArray()
            password = ""
            importVault(secret) { result ->
                loading = false
                result.onFailure { cause ->
                    error = when ((cause as? VaultBackupException)?.code ?: cause.message) {
                        "WRONG_BACKUP_PASSWORD" -> "Неверный мастер-пароль резервной копии"
                        "UNSUPPORTED_BACKUP_VERSION", "UNSUPPORTED_VAULT_VERSION" -> "Эта версия резервной копии пока не поддерживается"
                        "BACKUP_NOT_ENOUGH_SPACE" -> "Недостаточно свободного места для импорта"
                        "INVALID_BACKUP", "INVALID_BACKUP_KEY", "INVALID_KDF", "BACKUP_INVALID_IDS",
                        "BACKUP_DUPLICATE_FILE_IDS", "BACKUP_FILE_SET_MISMATCH", "BACKUP_BLOB_INVALID",
                        "BACKUP_TRUNCATED", "BACKUP_TRAILING_OR_MISSING_DATA" -> "Резервная копия повреждена или загружена не полностью"
                        else -> "Не удалось проверить резервную копию"
                    }
                }
            }
        }
        TextButton(onClick = cancel, enabled = !loading, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text("Отмена") }
    }
}

@Composable
fun MasterUnlockScreen(repository: VaultRepository, onUnlocked: () -> Unit, onReset: () -> Unit, onBack: (() -> Unit)? = null) {
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var resetDialog by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    AuthFrame(
        "Восстановление доступа",
        "Мастер-пароль",
        "Введите мастер-пароль. Он используется только для восстановления и изменения настроек защиты.",
    ) {
        if (onBack != null) TextButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, null, Modifier.size(18.dp)); Text("Вернуться к быстрому входу") }
        SecretTextField("Мастер-пароль", password, { password = it; error = "" })
        InlineError(error)
        NocturneButton("Открыть хранилище", enabled = password.isNotBlank(), loading = loading) {
            loading = true
            scope.launch {
                val result = withContext(Dispatchers.Default) { repository.unlockMaster(password.toCharArray()) }
                loading = false
                if (result.unlocked) onUnlocked() else error = retryMessage(result, "Неверный мастер-пароль")
            }
        }
        TextButton(onClick = { resetDialog = true }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
            Icon(Icons.Rounded.DeleteForever, null, Modifier.size(18.dp), tint = NocturneDanger)
            Text("Нет доступа ни к одному паролю", color = NocturneDanger)
        }
    }
    if (resetDialog) ResetVaultDialog({ resetDialog = false }, onReset)
}

@Composable
fun QuickUnlockScreen(
    repository: VaultRepository,
    mode: QuickMode,
    onUnlocked: () -> Unit,
    onMasterRecovery: () -> Unit,
    onSystemUnlock: ((UnlockResult) -> Unit) -> Unit,
    onReset: () -> Unit,
) {
    var pin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var resetDialog by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun accept(result: UnlockResult, label: String) {
        loading = false
        if (result.unlocked) onUnlocked() else error = retryMessage(result, label)
    }

    AuthFrame(
        "Быстрый вход",
        when (mode) { QuickMode.PIN -> "Введите PIN"; QuickMode.PATTERN -> "Нарисуйте ключ"; QuickMode.SYSTEM -> "Биометрия Android"; else -> "Открыть" },
        when (mode) {
            QuickMode.PIN -> "Нужен PIN, который вы установили в Nocturne."
            QuickMode.PATTERN -> "Проведите пальцем по точкам одним непрерывным движением."
            QuickMode.SYSTEM -> "Подтвердите личность отпечатком пальца или распознаванием лица. Пароль телефона здесь не подходит."
            else -> ""
        },
    ) {
        when (mode) {
            QuickMode.PIN -> {
                SecretTextField("PIN-код", pin, { pin = it.filter(Char::isDigit).take(12); error = "" }, numeric = true, supportingText = "Только цифры, от 6 до 12")
                InlineError(error)
                NocturneButton("Открыть", enabled = pin.length in 6..12, loading = loading) {
                    loading = true
                    scope.launch { accept(withContext(Dispatchers.Default) { repository.unlockQuick(mode, pin.toCharArray()) }, "Неверный PIN") }
                }
            }
            QuickMode.PATTERN -> {
                PatternPad(enabled = !loading, showTrace = !repository.hidePatternTrace()) { pattern ->
                    if (pattern.split('-').size < 5) { error = "Соедините не менее 5 точек"; return@PatternPad }
                    loading = true
                    scope.launch { accept(withContext(Dispatchers.Default) { repository.unlockQuick(mode, pattern.toCharArray()) }, "Неверный рисунок") }
                }
                InlineError(error)
            }
            QuickMode.SYSTEM -> {
                InlineError(error)
                NocturneButton("Продолжить", loading = loading) {
                    loading = true
                    onSystemUnlock { accept(it, "Не удалось подтвердить личность") }
                }
            }
            QuickMode.NONE -> Unit
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
            TextButton(onClick = onMasterRecovery) { Icon(Icons.Rounded.Lock, null, Modifier.size(17.dp)); Text("Ввести мастер-пароль") }
        }
        TextButton(onClick = { resetDialog = true }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
            Icon(Icons.Rounded.DeleteForever, null, Modifier.size(18.dp), tint = NocturneDanger)
            Text("Забыты оба пароля", color = NocturneDanger, fontWeight = FontWeight.SemiBold)
        }
    }
    if (resetDialog) ResetVaultDialog({ resetDialog = false }, onReset)
}

@Composable
private fun ResetVaultDialog(dismiss: () -> Unit, reset: () -> Unit) {
    var confirmation by remember { mutableStateOf("") }
    AdaptiveDialog(
        title = "Сбросить хранилище?",
        onDismiss = dismiss,
        dangerLabel = "Удалить всё",
        onDanger = reset,
        dangerEnabled = confirmation == "СБРОСИТЬ",
    ) {
        Text("Восстановить данные без мастер-пароля невозможно. Сброс навсегда удалит все зашифрованные записи и файлы с этого устройства.", color = NocturneMuted)
        PrivateTextField("Введите СБРОСИТЬ", confirmation, { confirmation = it.uppercase().take(8) })
        if (confirmation.isNotBlank() && confirmation != "СБРОСИТЬ") InlineError("Введите слово полностью")
    }
}

fun retryMessage(result: UnlockResult, invalid: String): String =
    if (result.retryAfterSeconds > 0) "Слишком много попыток. Повторите через ${result.retryAfterSeconds} сек." else invalid
