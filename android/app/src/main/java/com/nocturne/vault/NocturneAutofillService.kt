package com.nocturne.vault

import android.app.PendingIntent
import android.app.assist.AssistStructure
import android.content.Intent
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveInfo
import android.service.autofill.SaveRequest
import android.view.View
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import java.util.UUID
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

class NocturneAutofillService : AutofillService() {
    override fun onFillRequest(request: FillRequest, cancellationSignal: CancellationSignal, callback: FillCallback) {
        if (cancellationSignal.isCanceled) return callback.onSuccess(null)
        val structure = request.fillContexts.lastOrNull()?.structure ?: return callback.onSuccess(null)
        if (structure.activityComponent?.packageName == packageName) return callback.onSuccess(null)
        val fields = collectFields(structure)
        val ids = listOfNotNull(fields.username, fields.password).distinct().toTypedArray()
        if (ids.isEmpty()) return callback.onSuccess(null)
        val auth = Intent(this, AutofillAuthActivity::class.java).apply {
            putExtra(AutofillAuthActivity.EXTRA_MODE, AutofillAuthActivity.MODE_FILL)
            fields.username?.let { putExtra(AutofillAuthActivity.EXTRA_USERNAME_ID, it) }
            fields.password?.let { putExtra(AutofillAuthActivity.EXTRA_PASSWORD_ID, it) }
            putExtra(AutofillAuthActivity.EXTRA_WEB_DOMAIN, fields.webDomain)
            putExtra(AutofillAuthActivity.EXTRA_PACKAGE_NAME, fields.packageName)
            putExtra(AutofillAuthActivity.EXTRA_PACKAGE_SIGNATURE, fields.packageSignature)
            putExtra(AutofillAuthActivity.EXTRA_REQUEST_ID, request.id)
        }
        val pending = PendingIntent.getActivity(
            this,
            request.id,
            auth,
            PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
        val response = FillResponse.Builder()
            .setAuthentication(ids, pending.intentSender, presentation("Разблокировать Nocturne"))
            .apply {
                if (fields.password != null) {
                    val saveType = (if (fields.username != null) SaveInfo.SAVE_DATA_TYPE_USERNAME else 0) or SaveInfo.SAVE_DATA_TYPE_PASSWORD
                    val save = SaveInfo.Builder(saveType, ids)
                    if (fields.webDomain.isNotBlank()) save.setDescription("Проверьте в Nocturne приложение и заявленный сайт перед сохранением")
                    setSaveInfo(save.build())
                }
            }
            .build()
        callback.onSuccess(response)
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        val structure = request.fillContexts.lastOrNull()?.structure
        if (structure == null) return callback.onFailure("Нет данных для сохранения")
        if (structure.activityComponent?.packageName == packageName) return callback.onSuccess()
        val fields = collectFields(structure, includeValues = true)
        val password = fields.passwordValue
        if (password.isNullOrBlank()) return callback.onSuccess()
        val token = AutofillPendingStore.put(fields.usernameValue.orEmpty(), password, fields.webDomain, fields.packageName, fields.packageSignature)
        val intent = Intent(this, AutofillAuthActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS)
            putExtra(AutofillAuthActivity.EXTRA_MODE, AutofillAuthActivity.MODE_SAVE)
            putExtra(AutofillAuthActivity.EXTRA_SAVE_TOKEN, token)
        }
        runCatching { startActivity(intent) }
            .onSuccess { callback.onSuccess() }
            .onFailure { AutofillPendingStore.take(token); callback.onFailure("Не удалось открыть Nocturne") }
    }

    private fun presentation(text: String) = RemoteViews(packageName, android.R.layout.simple_list_item_1).apply {
        setTextViewText(android.R.id.text1, text)
    }

    private fun collectFields(structure: AssistStructure, includeValues: Boolean = false): AutofillFields {
        var username: AutofillId? = null
        var password: AutofillId? = null
        var usernameValue: String? = null
        var passwordValue: String? = null
        var webDomain = ""
        fun visit(node: AssistStructure.ViewNode) {
            val id = node.autofillId
            val hints = node.autofillHints.orEmpty().joinToString(" ").lowercase()
            val html = buildString {
                append(node.htmlInfo?.tag.orEmpty())
                node.htmlInfo?.attributes?.forEach { append(' ').append(it.first).append('=').append(it.second) }
            }.lowercase()
            val identity = listOf(node.idEntry, node.hint?.toString(), hints, html).joinToString(" ").lowercase()
            val inputType = node.inputType
            val isPassword = identity.contains("password") || inputType and 0x000000f0 in setOf(0x80, 0x90, 0xe0)
            val isUsername = !isPassword && (identity.contains("username") || identity.contains("user_name") || identity.contains("email") || identity.contains("login"))
            if (id != null && isPassword && password == null) {
                password = id
                if (includeValues) passwordValue = node.autofillValue?.textValue()
            } else if (id != null && isUsername && username == null) {
                username = id
                if (includeValues) usernameValue = node.autofillValue?.textValue()
            }
            if (webDomain.isBlank()) webDomain = node.webDomain.orEmpty()
            repeat(node.childCount) { visit(node.getChildAt(it)) }
        }
        repeat(structure.windowNodeCount) { window -> visit(structure.getWindowNodeAt(window).rootViewNode) }
        val packageName = structure.activityComponent?.packageName.orEmpty().take(253)
        return AutofillFields(username, password, usernameValue, passwordValue, webDomain.take(253), packageName, packageSigningDigest(this, packageName))
    }

    private fun AutofillValue.textValue(): String? = if (isText) textValue?.toString()?.take(4096) else null
}

private data class AutofillFields(
    val username: AutofillId?,
    val password: AutofillId?,
    val usernameValue: String?,
    val passwordValue: String?,
    val webDomain: String,
    val packageName: String,
    val packageSignature: String,
)

data class PendingAutofillSave(val username: String, val password: String, val webDomain: String, val packageName: String, val packageSignature: String, val createdAt: Long = System.currentTimeMillis()) {
    val displayTarget: String get() = webDomain.ifBlank { packageName }
    val storedScope: String get() = if (webDomain.isNotBlank()) "https://$webDomain" else "android-app://$packageName"
}

object AutofillPendingStore {
    private const val MAX_AGE_MS = 120_000L
    private val values = ConcurrentHashMap<String, PendingAutofillSave>()

    fun put(username: String, password: String, webDomain: String, packageName: String, packageSignature: String): String {
        purgeExpired()
        val token = UUID.randomUUID().toString()
        values[token] = PendingAutofillSave(username.take(4096), password.take(4096), webDomain.take(253), packageName.take(253), packageSignature.take(1024))
        return token
    }

    fun take(token: String): PendingAutofillSave? {
        purgeExpired()
        return values.remove(token)
    }

    private fun purgeExpired() {
        val cutoff = System.currentTimeMillis() - MAX_AGE_MS
        values.entries.removeAll { it.value.createdAt < cutoff }
    }
}

object AutofillScope {
    fun matches(item: PasswordItem, webDomain: String, packageName: String, packageSignature: String = ""): Boolean {
        val stored = item.url.trim()
        if (stored.isBlank()) return false
        if (webDomain.isNotBlank()) {
            val targetHost = normalizeHost(webDomain)
            val storedHost = normalizeHost(stored)
            return targetHost.isNotBlank() && storedHost.isNotBlank() && (targetHost == storedHost || targetHost.endsWith(".$storedHost"))
        }
        val appScope = stored.removePrefix("android-app://").trimEnd('/').lowercase()
        return packageName.isNotBlank() && packageSignature.isNotBlank() &&
            item.appSignatureSha256.isNotBlank() && appScope == packageName.lowercase() &&
            MessageDigest.isEqual(item.appSignatureSha256.toByteArray(), packageSignature.toByteArray())
    }

    private fun normalizeHost(value: String): String {
        val candidate = if ("://" in value) value else "https://$value"
        return runCatching { java.net.URI(candidate).host.orEmpty().lowercase().trimEnd('.') }.getOrDefault("")
    }
}

internal fun autofillCandidates(
    passwords: List<PasswordItem>,
    webDomain: String,
    packageName: String,
    packageSignature: String = "",
    query: String,
): List<PasswordItem> {
    val normalized = query.trim().lowercase()
    val scoped = passwords.filter { AutofillScope.matches(it, webDomain, packageName, packageSignature) }
    if (normalized.isBlank()) return scoped
    return scoped
        .filter { item ->
            sequenceOf(item.title, item.username, item.url, item.notes)
                .any { it.lowercase().contains(normalized) }
        }
}
