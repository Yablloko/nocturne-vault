package com.nocturne.vault

import android.app.Activity
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.HelpOutline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

private data class ProtectedSpaceHelpTopic(val title: String, val description: String)

private val protectedSpaceHelpTopics = listOf(
    ProtectedSpaceHelpTopic(
        "Что создаётся",
        "Android создаёт на телефоне отдельное рабочее пространство. У него собственные приложения, аккаунты, настройки и файлы. Данные приложения внутри этого пространства не смешиваются с данными его обычной копии в личной части телефона.",
    ),
    ProtectedSpaceHelpTopic(
        "Для чего это нужно",
        "Сюда можно установить вторую копию мессенджера, браузера или другого приложения и держать её отдельно от личных приложений. Когда пространство закрыто, добавленные приложения останавливаются и скрываются, не получают новые данные и не показывают уведомления.",
    ),
    ProtectedSpaceHelpTopic(
        "Как открыть и закрыть",
        "Открывайте пространство только кнопкой «Открыть» в Nocturne. Android попросит отдельный код защищённых приложений, если пространство было безопасно закрыто. Кнопка «Закрыть» завершает сеанс, прячет добавленные приложения и снова запирает их данные.",
    ),
    ProtectedSpaceHelpTopic(
        "Как добавить приложение",
        "Откройте пространство, выполните обязательные настройки и нажмите «Установить приложение в это пространство». Устанавливайте и запускайте приложения на экране Nocturne внутри пространства. Обычная и защищённая копии одного приложения хранят данные независимо друг от друга.",
    ),
    ProtectedSpaceHelpTopic(
        "Почему нужен отдельный код",
        "Код проверяет сам Android до доступа к данным рабочего пространства. Nocturne не видит этот код и не может автоматически подставить мастер-пароль, быстрый PIN или рисунок. Это дополнительная граница защиты, поэтому лучше выбрать код, который не совпадает с кодом телефона.",
    ),
    ProtectedSpaceHelpTopic(
        "Если Android пишет «Сохранено»",
        "Nocturne показывает «Готово» только после того, как Android подтвердил именно отдельный код рабочего пространства. Системный тост «Сохранено» может означать лишь сохранение экрана настроек. Если кнопка осталась «Повторить», создайте новый код, отличный от кода телефона. Если Android снова оставляет общий код, прошивка не выполнила стандартный запрос рабочего профиля; Nocturne не станет считать такую настройку безопасной.",
    ),
    ProtectedSpaceHelpTopic(
        "Когда нужно переподключение",
        "Переподключение нужно только после импорта хранилища, сброса приложения или замены его ключей. Нажмите «Переподключить» в личном Nocturne — новый ключ передастся и проверится автоматически. Если рабочее пространство заперто, Android сам попросит его отдельный PIN, рисунок или пароль. Одноразовых кодов в Nocturne больше нет.",
    ),
    ProtectedSpaceHelpTopic(
        "Что важно знать",
        "Это защищённое рабочее пространство Android, а не отдельная виртуальная система. Пока оно открыто, Android может показывать значок портфеля и раздел «Работа». После закрытия Nocturne снова скрывает добавленные приложения. Защита рассчитана на обычные приложения и доступ без кода пространства, но не может гарантировать безопасность на телефоне с взломанной системой или полученными правами администратора.",
    ),
)

@Composable
internal fun ProtectedSpaceScreen(
    repository: VaultRepository,
    onVaultLock: () -> Unit,
    onProvisioningStarted: () -> Unit,
    onProvisioningFinished: () -> Unit,
) {
    val context = LocalContext.current
    val activity = context as? Activity
    var status by remember { mutableStateOf(ProtectedSpaceManager.status(context)) }
    var repairDialog by remember { mutableStateOf(false) }
    var enableHelpDialog by remember { mutableStateOf(false) }
    var helpOpen by remember { mutableStateOf(false) }
    var operationMessage by remember { mutableStateOf("") }
    var observedDelivery by remember {
        mutableStateOf(ProtectedSpaceDeliveryTracker.snapshot(context)?.let { "${it.requestId}:${it.stage}:${it.updatedAt}" })
    }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        onProvisioningFinished()
        status = ProtectedSpaceManager.status(context)
    }

    LaunchedEffect(Unit) {
        SafeDebugLog.record(
            context,
            "protected.status",
            "provisioned" to status.provisioned,
            "paused" to status.paused,
            "unlocked" to status.unlocked,
            "route" to status.routeAvailable,
        )
        while (true) {
            val current = ProtectedSpaceManager.status(context)
            if (current != status) {
                status = current
                SafeDebugLog.record(
                    context,
                    "protected.status.changed",
                    "provisioned" to current.provisioned,
                    "paused" to current.paused,
                    "unlocked" to current.unlocked,
                    "route" to current.routeAvailable,
                )
            }
            ProtectedSpaceDeliveryTracker.snapshot(context)?.let { delivery ->
                val deliveryKey = "${delivery.requestId}:${delivery.stage}:${delivery.updatedAt}"
                if (deliveryKey != observedDelivery) {
                    observedDelivery = deliveryKey
                    operationMessage = protectedSpaceDeliveryMessage(delivery)
                    if (delivery.stage == ProtectedSpaceDeliveryTracker.STAGE_REJECTED &&
                        delivery.reason == "INVALID_SIGNATURE"
                    ) {
                        repairDialog = true
                    }
                }
            }
            delay(600)
        }
    }

    val ready = status.provisioned && !status.paused && status.routeAvailable
    if (helpOpen) {
        BackHandler { helpOpen = false }
        ProtectedSpaceHelpScreen(onBack = { helpOpen = false }, onLock = onVaultLock)
        return
    }

    ScreenShell("Приложения", "Защищённое пространство Android", onLock = onVaultLock) {
        LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                GlassCard(Modifier.fillMaxWidth(), strong = ready) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Состояние", color = NocturneInk, fontWeight = FontWeight.SemiBold)
                        Text(
                            when {
                                !status.supported -> "Нужен Android 11 или новее"
                                !status.provisioned -> "Защищённое пространство ещё не создано"
                                status.paused -> "Рабочее пространство выключено системной кнопкой с портфелем"
                                !status.routeAvailable -> "Пространство временно недоступно. Включите портфель и попробуйте снова"
                                !status.unlocked -> "Пространство закрыто. При открытии Android попросит его отдельный код"
                                else -> "Пространство готово к открытию"
                            },
                            color = NocturneMuted,
                            fontSize = 12.sp,
                            lineHeight = 18.sp,
                        )
                        if (status.supported && activity != null) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                when {
                                    !status.provisioned -> Button(onClick = {
                                        val identity = repository.ensureProtectedSpaceIdentity()
                                        onProvisioningStarted()
                                        runCatching { launcher.launch(ProtectedSpaceManager.provisioningIntent(context, identity.publicKey)) }
                                            .onFailure {
                                                onProvisioningFinished()
                                                Toast.makeText(context, "Не удалось создать защищённое пространство", Toast.LENGTH_LONG).show()
                                            }
                                    }) { Text("Создать") }
                                    status.paused -> Button(onClick = { enableHelpDialog = true }) { Text("Как включить") }
                                    else -> {
                                        Button(
                                            enabled = status.routeAvailable,
                                            onClick = {
                                                operationMessage = "Открываю защищённое пространство…"
                                                ProtectedSpaceManager.open(activity, repository)
                                                    .onSuccess { operationMessage = "Ожидаю подтверждение защищённого пространства…" }
                                                    .onFailure {
                                                        operationMessage = "Не удалось открыть: ${SafeDebugLog.failureCode(it)}"
                                                        Toast.makeText(context, "Не удалось открыть пространство", Toast.LENGTH_LONG).show()
                                                    }
                                            },
                                        ) { Text("Открыть") }
                                        OutlinedButton(
                                            enabled = status.routeAvailable,
                                            onClick = {
                                                if (!status.unlocked) {
                                                    operationMessage = "Пространство уже закрыто"
                                                } else {
                                                    operationMessage = "Закрываю защищённое пространство…"
                                                    ProtectedSpaceManager.lock(activity, repository)
                                                        .onSuccess { operationMessage = "Ожидаю подтверждение закрытия…" }
                                                        .onFailure {
                                                            operationMessage = "Не удалось закрыть: ${SafeDebugLog.failureCode(it)}"
                                                            Toast.makeText(context, "Не удалось закрыть пространство", Toast.LENGTH_LONG).show()
                                                        }
                                                }
                                            },
                                        ) { Text("Закрыть") }
                                    }
                                }
                            }
                        }
                        if (operationMessage.isNotBlank()) {
                            Text(operationMessage, color = NocturneAccent, fontSize = 12.sp, lineHeight = 18.sp)
                        }
                        if (ready && activity != null) {
                            TextButton(onClick = {
                                repairDialog = true
                            }) { Text("Переподключить после импорта или сброса") }
                        }
                    }
                }
            }
            item {
                OutlinedButton(onClick = { helpOpen = true }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.AutoMirrored.Rounded.HelpOutline, null)
                    Text("Справка", modifier = Modifier.padding(start = 8.dp))
                }
            }
        }
    }

    if (enableHelpDialog) {
        AlertDialog(
            onDismissRequest = { enableHelpDialog = false },
            title = { Text("Включите пространство") },
            text = { Text("Откройте шторку быстрых настроек Android и нажмите кнопку с портфелем — «Рабочие приложения». Nocturne сам увидит изменение; нажимать отдельную кнопку проверки не нужно.") },
            confirmButton = { Button(onClick = { enableHelpDialog = false }) { Text("Понятно") } },
        )
    }

    if (repairDialog && activity != null) {
        AlertDialog(
            onDismissRequest = { repairDialog = false },
            title = { Text("Переподключить пространство") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Nocturne автоматически передаст рабочему пространству новый ключ связи. Получать, копировать или вводить одноразовый код не нужно.")
                    Text(
                        "Если пространство заперто, Android сам попросит его отдельный PIN, рисунок или пароль. Если отдельный код ещё не создан, Nocturne покажет, где его настроить.",
                        color = NocturneMuted,
                        fontSize = 12.sp,
                        lineHeight = 18.sp,
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        operationMessage = "Открываю безопасное переподключение…"
                        val result = ProtectedSpaceManager.repair(activity, repository)
                        if (result.isSuccess) {
                            repairDialog = false
                            operationMessage = "Переподключаю защищённое пространство…"
                        }
                        Toast.makeText(
                            context,
                            if (result.isSuccess) "Запрос переподключения отправлен" else "Не удалось переподключить пространство",
                            Toast.LENGTH_LONG,
                        ).show()
                    },
                ) { Text("Переподключить") }
            },
            dismissButton = { TextButton(onClick = { repairDialog = false }) { Text("Отмена") } },
        )
    }
}

@Composable
private fun ProtectedSpaceHelpScreen(onBack: () -> Unit, onLock: () -> Unit) {
    ScreenShell(
        title = "Справка",
        subtitle = "Как устроены защищённые приложения",
        actionIcon = Icons.AutoMirrored.Rounded.ArrowBack,
        actionLabel = "Назад к приложениям",
        onAction = onBack,
        onLock = onLock,
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(protectedSpaceHelpTopics, key = { it.title }) { topic ->
                GlassCard(Modifier.fillMaxWidth()) {
                    Column(
                        Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(topic.title, color = NocturneInk, fontWeight = FontWeight.SemiBold)
                        Text(topic.description, color = NocturneMuted, fontSize = 12.sp, lineHeight = 19.sp)
                    }
                }
            }
        }
    }
}

private fun protectedSpaceDeliveryMessage(state: ProtectedSpaceDeliveryTracker.State): String = when (state.stage) {
    ProtectedSpaceDeliveryTracker.STAGE_REQUESTED -> "Передаю команду защищённому пространству…"
    ProtectedSpaceDeliveryTracker.STAGE_RECEIVED -> "Защищённое пространство получило команду…"
    ProtectedSpaceDeliveryTracker.STAGE_AUTHENTICATION_REQUIRED ->
        "Подтвердите отдельный код защищённых приложений в системном окне Android"
    ProtectedSpaceDeliveryTracker.STAGE_SETUP_REQUIRED -> when (state.reason) {
        "SEPARATE_CHALLENGE_NOT_CREATED" ->
            "Android сохранил настройку, но профиль всё ещё использует общий код телефона. В рабочем окне нажмите «Повторить» и выберите другой код."
        else ->
            "В рабочем окне создайте отдельный PIN, рисунок или пароль защищённых приложений. После сохранения переподключение продолжится автоматически."
    }
    ProtectedSpaceDeliveryTracker.STAGE_OPENED -> "Защищённое пространство открыто"
    ProtectedSpaceDeliveryTracker.STAGE_LOCKED -> "Защищённое пространство закрыто"
    ProtectedSpaceDeliveryTracker.STAGE_REPAIR_READY -> "Защищённое пространство проверяет новый ключ…"
    ProtectedSpaceDeliveryTracker.STAGE_REPAIRED ->
        "Связь восстановлена, защищённое пространство открыто"
    ProtectedSpaceDeliveryTracker.STAGE_REJECTED ->
        protectedSpaceFailureMessage(state.reason) ?: "Защищённое пространство отклонило команду"
    ProtectedSpaceDeliveryTracker.STAGE_FAILED ->
        protectedSpaceFailureMessage(state.reason) ?: "Не удалось выполнить команду в защищённом пространстве"
    ProtectedSpaceDeliveryTracker.STAGE_TIMEOUT ->
        "Android принял переход, но защищённое пространство не подтвердило запуск. Включите портфель и повторите попытку."
    else -> ""
}
