package com.nocturne.vault

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.PersistableBundle
import android.os.Build

class ProtectedSpaceAdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        provisioningExtras(intent)?.getString(ProtectedSpaceContract.EXTRA_PUBLIC_KEY)?.let {
            ProtectedSpacePolicy.savePublicKey(context, it)
        }
    }

    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        super.onProfileProvisioningComplete(context, intent)
        provisioningExtras(intent)?.getString(ProtectedSpaceContract.EXTRA_PUBLIC_KEY)?.let {
            ProtectedSpacePolicy.savePublicKey(context, it)
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            runCatching { ProtectedSpacePolicy.completeProvisioning(context) }
            runCatching { ProtectedSpacePolicy.lockAndEvict(context) }
        }
    }

    @Suppress("DEPRECATION")
    private fun provisioningExtras(intent: Intent): PersistableBundle? =
        intent.getParcelableExtra(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE)
}
