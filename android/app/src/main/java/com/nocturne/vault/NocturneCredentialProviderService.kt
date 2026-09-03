package com.nocturne.vault

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.CancellationSignal
import android.os.OutcomeReceiver
import androidx.annotation.RequiresApi
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.CreateCredentialUnknownException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import androidx.credentials.provider.Action
import androidx.credentials.provider.AuthenticationAction
import androidx.credentials.provider.BeginCreateCredentialRequest
import androidx.credentials.provider.BeginCreateCredentialResponse
import androidx.credentials.provider.BeginCreatePasswordCredentialRequest
import androidx.credentials.provider.BeginGetCredentialRequest
import androidx.credentials.provider.BeginGetCredentialResponse
import androidx.credentials.provider.BeginGetPasswordOption
import androidx.credentials.provider.CreateEntry
import androidx.credentials.provider.CredentialProviderService
import androidx.credentials.provider.PasswordCredentialEntry
import androidx.credentials.provider.ProviderClearCredentialStateRequest
import java.util.UUID

@RequiresApi(34)
class NocturneCredentialProviderService : CredentialProviderService() {
    override fun onBeginGetCredentialRequest(
        request: BeginGetCredentialRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException>,
    ) {
        if (cancellationSignal.isCanceled) return
        val callerInfo = request.callingAppInfo
        val caller = callerInfo?.packageName.orEmpty()
        if (caller.isBlank() || caller == packageName || callerInfo?.isOriginPopulated() == true || request.beginGetCredentialOptions.none { it is BeginGetPasswordOption }) {
            callback.onError(NoCredentialException())
            return
        }
        callback.onResult(
            BeginGetCredentialResponse.Builder()
                .setAuthenticationActions(
                    listOf(AuthenticationAction("Открыть Nocturne", CredentialProviderIntents.unlock(this))),
                )
                .build(),
        )
    }

    override fun onBeginCreateCredentialRequest(
        request: BeginCreateCredentialRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException>,
    ) {
        if (cancellationSignal.isCanceled) return
        if (request !is BeginCreatePasswordCredentialRequest || request.callingAppInfo?.packageName == packageName || request.callingAppInfo?.isOriginPopulated() == true) {
            callback.onError(CreateCredentialUnknownException())
            return
        }
        val entry = CreateEntry.Builder("Хранилище Nocturne", CredentialProviderIntents.create(this))
            .setDescription("Сохранить логин и пароль")
            .build()
        callback.onResult(BeginCreateCredentialResponse.Builder().addCreateEntry(entry).build())
    }

    override fun onClearCredentialStateRequest(
        request: ProviderClearCredentialStateRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<Void?, ClearCredentialException>,
    ) {
        callback.onResult(null)
    }
}

@RequiresApi(34)
internal object CredentialProviderIntents {
    fun unlock(context: Context) = pending(context, CredentialProviderActivity.MODE_UNLOCK)
    fun search(context: Context) = pending(context, CredentialProviderActivity.MODE_SEARCH)
    fun create(context: Context) = pending(context, CredentialProviderActivity.MODE_CREATE)
    fun get(context: Context, itemId: String) = pending(context, CredentialProviderActivity.MODE_GET, itemId)

    private fun pending(context: Context, mode: String, itemId: String = ""): PendingIntent {
        val intent = Intent(context, CredentialProviderActivity::class.java)
            .setData(android.net.Uri.parse("nocturne://credential/${UUID.randomUUID()}"))
            .putExtra(CredentialProviderActivity.EXTRA_MODE, mode)
            .putExtra(CredentialProviderActivity.EXTRA_ITEM_ID, itemId)
        return PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_ONE_SHOT,
        )
    }
}

@RequiresApi(34)
internal fun buildUnlockedCredentialResponse(
    context: Context,
    request: BeginGetCredentialRequest,
    passwords: List<PasswordItem>,
): BeginGetCredentialResponse {
    val caller = request.callingAppInfo?.packageName.orEmpty()
    val callerSignature = packageSigningDigest(context, caller)
    val builder = BeginGetCredentialResponse.Builder()
    request.beginGetCredentialOptions.filterIsInstance<BeginGetPasswordOption>().forEach { option ->
        credentialManagerCandidates(passwords, caller, callerSignature, option.allowedUserIds, "").forEach { item ->
            if (item.username.isBlank()) return@forEach
            builder.addCredentialEntry(
                PasswordCredentialEntry.Builder(
                    context,
                    item.username,
                    CredentialProviderIntents.get(context, item.id),
                    option,
                ).setDisplayName(item.title).build(),
            )
        }
    }
    builder.addAction(
        Action(
            title = "Найти или добавить аккаунт",
            subtitle = "Открыть защищённый поиск Nocturne",
            pendingIntent = CredentialProviderIntents.search(context),
        ),
    )
    return builder.build()
}

internal fun credentialManagerCandidates(
    passwords: List<PasswordItem>,
    packageName: String,
    packageSignature: String,
    allowedUserIds: Set<String>,
    query: String,
): List<PasswordItem> = autofillCandidates(passwords, "", packageName, packageSignature, query)
    .filter { allowedUserIds.isEmpty() || it.username in allowedUserIds }
