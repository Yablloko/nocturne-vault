package com.nocturne.vault

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class ProtectedSpaceLifecycleReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in setOf(
                Intent.ACTION_LOCKED_BOOT_COMPLETED,
                Intent.ACTION_BOOT_COMPLETED,
                Intent.ACTION_USER_UNLOCKED,
                Intent.ACTION_MY_PACKAGE_REPLACED,
                Intent.ACTION_PACKAGE_ADDED,
                Intent.ACTION_PACKAGE_REPLACED,
                Intent.ACTION_PACKAGE_CHANGED,
            )
        ) return
        if (!ProtectedSpaceManager.isProfileOwner(context)) return
        val pending = goAsync()
        Thread {
            try {
                runCatching { ProtectedSpacePolicy.apply(context) }
                // Never evict on ACTION_USER_UNLOCKED: that broadcast is also sent after the
                // system accepts the separate work credential requested by ProtectedSpaceActivity.
                // Evicting here immediately relocked the profile and made every open/repair flow
                // loop forever. Guests are already hidden/suspended by apply().
                if (protectedSpaceLifecycleResetsSession(intent.action)) {
                    runCatching { ProtectedSpacePolicy.prepareClosedState(context) }
                }
            } finally {
                pending.finish()
            }
        }.start()
    }
}

internal fun protectedSpaceLifecycleResetsSession(action: String?): Boolean =
    action == Intent.ACTION_LOCKED_BOOT_COMPLETED ||
        action == Intent.ACTION_MY_PACKAGE_REPLACED
