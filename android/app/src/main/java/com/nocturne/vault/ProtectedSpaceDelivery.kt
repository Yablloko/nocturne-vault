package com.nocturne.vault

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import java.util.UUID

internal object ProtectedSpaceDeliveryTracker {
    data class State(
        val requestId: String,
        val operation: String,
        val stage: String,
        val reason: String,
        val updatedAt: Long,
    )

    const val STAGE_REQUESTED = "REQUESTED"
    const val STAGE_RECEIVED = "RECEIVED"
    const val STAGE_AUTHENTICATION_REQUIRED = "AUTHENTICATION_REQUIRED"
    const val STAGE_SETUP_REQUIRED = "SETUP_REQUIRED"
    const val STAGE_OPENED = "OPENED"
    const val STAGE_LOCKED = "LOCKED"
    const val STAGE_REPAIR_READY = "REPAIR_READY"
    const val STAGE_REPAIRED = "REPAIRED"
    const val STAGE_REJECTED = "REJECTED"
    const val STAGE_FAILED = "FAILED"
    const val STAGE_TIMEOUT = "TIMEOUT"

    private const val PREFS = "protected_space_delivery"
    private const val KEY_REQUEST = "request"
    private const val KEY_OPERATION = "operation"
    private const val KEY_STAGE = "stage"
    private const val KEY_REASON = "reason"
    private const val KEY_UPDATED_AT = "updated_at"
    private const val DELIVERY_TIMEOUT_MS = 8_000L
    private const val EXECUTION_TIMEOUT_MS = 20_000L
    private val allowedStages = setOf(
        STAGE_REQUESTED,
        STAGE_RECEIVED,
        STAGE_AUTHENTICATION_REQUIRED,
        STAGE_SETUP_REQUIRED,
        STAGE_OPENED,
        STAGE_LOCKED,
        STAGE_REPAIR_READY,
        STAGE_REPAIRED,
        STAGE_REJECTED,
        STAGE_FAILED,
        STAGE_TIMEOUT,
    )

    private fun storage(context: Context) = context.createDeviceProtectedStorageContext()
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun begin(context: Context, operation: String): Pair<String, PendingIntent> {
        val requestId = UUID.randomUUID().toString()
        save(context, requestId, operation, STAGE_REQUESTED, "")
        val callbackIntent = Intent(context, ProtectedSpaceDeliveryReceiver::class.java)
            .setAction(ProtectedSpaceContract.ACTION_DELIVERY)
            .setData(Uri.parse("nocturne://protected-delivery/$requestId"))
            .putExtra(ProtectedSpaceContract.EXTRA_REQUEST_ID, requestId)
        val mutability = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
        val callback = PendingIntent.getBroadcast(
            context,
            requestId.hashCode(),
            callbackIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or mutability,
        )
        return requestId to callback
    }

    fun record(context: Context, requestId: String, stage: String, reason: String) {
        if (stage !in allowedStages) return
        val current = snapshotRaw(context) ?: return
        if (requestId != current.requestId) return
        if (current.stage != STAGE_TIMEOUT && stageRank(stage) < stageRank(current.stage)) return
        val safeReason = reason.takeIf { it.matches(Regex("[A-Z0-9_]{1,64}")) }.orEmpty()
        save(context, requestId, current.operation, stage, safeReason)
        SafeDebugLog.record(
            context,
            "protected.target.${stage.lowercase()}",
            "operation" to current.operation,
            "reason" to safeReason,
        )
    }

    fun snapshot(context: Context): State? {
        val current = snapshotRaw(context) ?: return null
        val timeout = when (current.stage) {
            STAGE_REQUESTED -> DELIVERY_TIMEOUT_MS
            STAGE_RECEIVED -> EXECUTION_TIMEOUT_MS
            else -> Long.MAX_VALUE
        }
        if (System.currentTimeMillis() - current.updatedAt >= timeout) {
            save(context, current.requestId, current.operation, STAGE_TIMEOUT, "TARGET_NOT_CONFIRMED")
            SafeDebugLog.record(
                context,
                "protected.route.unconfirmed",
                "operation" to current.operation,
            )
            return snapshotRaw(context)
        }
        return current
    }

    private fun stageRank(stage: String): Int = when (stage) {
        STAGE_REQUESTED, STAGE_TIMEOUT -> 0
        STAGE_RECEIVED -> 1
        STAGE_AUTHENTICATION_REQUIRED, STAGE_SETUP_REQUIRED, STAGE_OPENED, STAGE_REPAIR_READY -> 2
        STAGE_REPAIRED -> 3
        else -> 3
    }

    private fun snapshotRaw(context: Context): State? {
        val preferences = storage(context)
        val requestId = preferences.getString(KEY_REQUEST, null) ?: return null
        return State(
            requestId = requestId,
            operation = preferences.getString(KEY_OPERATION, "").orEmpty(),
            stage = preferences.getString(KEY_STAGE, STAGE_REQUESTED).orEmpty(),
            reason = preferences.getString(KEY_REASON, "").orEmpty(),
            updatedAt = preferences.getLong(KEY_UPDATED_AT, 0),
        )
    }

    private fun save(context: Context, requestId: String, operation: String, stage: String, reason: String) {
        check(storage(context).edit()
            .putString(KEY_REQUEST, requestId)
            .putString(KEY_OPERATION, operation)
            .putString(KEY_STAGE, stage)
            .putString(KEY_REASON, reason)
            .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
            .commit()) { "DELIVERY_STATE_NOT_PERSISTED" }
    }
}

class ProtectedSpaceDeliveryReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ProtectedSpaceContract.ACTION_DELIVERY) return
        val requestId = intent.getStringExtra(ProtectedSpaceContract.EXTRA_REQUEST_ID) ?: return
        val stage = intent.getStringExtra(ProtectedSpaceContract.EXTRA_DELIVERY_STAGE) ?: return
        val reason = intent.getStringExtra(ProtectedSpaceContract.EXTRA_DELIVERY_REASON).orEmpty()
        ProtectedSpaceDeliveryTracker.record(context, requestId, stage, reason)
    }
}

internal fun reportProtectedSpaceDelivery(context: Context, intent: Intent, stage: String, reason: String = "") {
    val callback = ProtectedSpaceContract.deliveryCallback(intent) ?: return
    val result = Intent()
        .putExtra(ProtectedSpaceContract.EXTRA_DELIVERY_STAGE, stage)
        .putExtra(ProtectedSpaceContract.EXTRA_DELIVERY_REASON, reason)
    runCatching { callback.send(context, 0, result) }
}
