package com.nocturne.vault

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class ProtectedSpaceLockReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        ProtectedSpacePolicy.lockAndEvict(context)
    }
}
