package com.nocturne.vault

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build

class NocturneApplication : Application() {
    val repository: VaultRepository by lazy { VaultRepository(this) }

    override fun onCreate() {
        super.onCreate()
        ProtectedSpaceManager.configureControllerActivity(this)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                lockForScreenOff(context)
            }
        }
        val filter = IntentFilter(Intent.ACTION_SCREEN_OFF)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) registerReceiver(receiver, filter, RECEIVER_NOT_EXPORTED)
        else registerReceiver(receiver, filter)
    }

    internal fun lockForScreenOff(context: Context = this) {
        if (ProtectedSpaceManager.isProfileOwner(context)) {
            runCatching { ProtectedSpacePolicy.lockAndEvict(context) }
        } else if (repository.isOpen()) {
            runCatching { ProtectedSpaceManager.lock(context, repository) }
            repository.lock()
        }
    }
}
