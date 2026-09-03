package com.nocturne.vault

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Process
import android.os.UserManager
import java.util.UUID

internal object ProtectedSpaceContract {
    const val ACTION_CONTROL = "com.nocturne.vault.action.PROTECTED_SPACE_CONTROL"
    const val CATEGORY_CONTROL = "com.nocturne.vault.category.PROTECTED_SPACE_CONTROL"
    const val ACTION_DELIVERY = "com.nocturne.vault.action.PROTECTED_SPACE_DELIVERY"
    const val EXTRA_PUBLIC_KEY = "com.nocturne.vault.protected.PUBLIC_KEY"
    const val EXTRA_REQUEST_ID = "com.nocturne.vault.protected.REQUEST_ID"
    const val EXTRA_DELIVERY_STAGE = "com.nocturne.vault.protected.DELIVERY_STAGE"
    const val EXTRA_DELIVERY_REASON = "com.nocturne.vault.protected.DELIVERY_REASON"
    private const val EXTRA_DELIVERY_CALLBACK = "com.nocturne.vault.protected.DELIVERY_CALLBACK"
    private const val EXTRA_ACTION = "com.nocturne.vault.protected.ACTION"
    private const val EXTRA_PACKAGE = "com.nocturne.vault.protected.PACKAGE"
    private const val EXTRA_PAIRING_KEY = "com.nocturne.vault.protected.PAIRING_KEY"
    private const val EXTRA_COUNTER = "com.nocturne.vault.protected.COUNTER"
    private const val EXTRA_ISSUED_AT = "com.nocturne.vault.protected.ISSUED_AT"
    private const val EXTRA_EXPIRES_AT = "com.nocturne.vault.protected.EXPIRES_AT"
    private const val EXTRA_SESSION_UNTIL = "com.nocturne.vault.protected.SESSION_UNTIL"
    private const val EXTRA_NONCE = "com.nocturne.vault.protected.NONCE"
    private const val EXTRA_SIGNATURE = "com.nocturne.vault.protected.SIGNATURE"

    /**
     * ACTION_MAIN is intentional here. Some OEM forwarders drop custom activity actions after
     * resolving the managed profile. A private category keeps this out of launchers while using
     * the platform's most widely supported activity-routing action.
     */
    fun intent(): Intent = Intent(Intent.ACTION_MAIN)
        .addCategory(CATEGORY_CONTROL)
        .addCategory(Intent.CATEGORY_DEFAULT)

    fun legacyIntent(): Intent = Intent(ACTION_CONTROL)
        .addCategory(Intent.CATEGORY_DEFAULT)

    fun attachDeliveryCallback(intent: Intent, requestId: String, callback: PendingIntent): Intent = intent
        .putExtra(EXTRA_REQUEST_ID, requestId)
        .putExtra(EXTRA_DELIVERY_CALLBACK, callback)

    @Suppress("DEPRECATION")
    fun deliveryCallback(intent: Intent): PendingIntent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        intent.getParcelableExtra(EXTRA_DELIVERY_CALLBACK, PendingIntent::class.java)
    } else {
        intent.getParcelableExtra(EXTRA_DELIVERY_CALLBACK)
    }

    /**
     * The callback is a system-backed capability created by the personal Nocturne instance.
     * Checking both package and profile prevents the work-profile copy (or another app) from
     * authorizing replacement of the stored pairing key.
     */
    fun hasTrustedPersonalDeliveryCallback(context: Context, intent: Intent): Boolean {
        val callback = deliveryCallback(intent) ?: return false
        val requestId = intent.getStringExtra(EXTRA_REQUEST_ID) ?: return false
        if (runCatching { UUID.fromString(requestId) }.isFailure) return false
        if (callback.creatorPackage != context.packageName) return false
        val creator = callback.creatorUserHandle
        if (creator == Process.myUserHandle()) return false
        return runCatching {
            context.getSystemService(UserManager::class.java).userProfiles.contains(creator)
        }.getOrDefault(false)
    }

    fun put(intent: Intent, command: ProtectedSpaceCommand): Intent = intent
        .putExtra(EXTRA_ACTION, command.action)
        .putExtra(EXTRA_PACKAGE, command.packageName)
        .putExtra(EXTRA_PAIRING_KEY, command.pairingKey)
        .putExtra(EXTRA_COUNTER, command.counter)
        .putExtra(EXTRA_ISSUED_AT, command.issuedAt)
        .putExtra(EXTRA_EXPIRES_AT, command.expiresAt)
        .putExtra(EXTRA_SESSION_UNTIL, command.sessionUntil)
        .putExtra(EXTRA_NONCE, command.nonce)
        .putExtra(EXTRA_SIGNATURE, command.signature)

    fun read(intent: Intent): ProtectedSpaceCommand? {
        val action = intent.getStringExtra(EXTRA_ACTION) ?: return null
        val nonce = intent.getStringExtra(EXTRA_NONCE) ?: return null
        val signature = intent.getStringExtra(EXTRA_SIGNATURE) ?: return null
        return ProtectedSpaceCommand(
            action = action,
            packageName = intent.getStringExtra(EXTRA_PACKAGE).orEmpty(),
            pairingKey = intent.getStringExtra(EXTRA_PAIRING_KEY).orEmpty(),
            counter = intent.getLongExtra(EXTRA_COUNTER, 0),
            issuedAt = intent.getLongExtra(EXTRA_ISSUED_AT, 0),
            expiresAt = intent.getLongExtra(EXTRA_EXPIRES_AT, 0),
            sessionUntil = intent.getLongExtra(EXTRA_SESSION_UNTIL, 0),
            nonce = nonce,
            signature = signature,
        )
    }
}
