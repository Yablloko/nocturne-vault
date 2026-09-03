package com.nocturne.vault

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.os.Bundle
import android.os.PersistableBundle

class ProtectedSpaceProvisioningActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        when (intent.action) {
            DevicePolicyManager.ACTION_GET_PROVISIONING_MODE -> {
                setResult(RESULT_OK, Intent()
                    .putExtra(DevicePolicyManager.EXTRA_PROVISIONING_MODE, DevicePolicyManager.PROVISIONING_MODE_MANAGED_PROFILE)
                    .putExtra(DevicePolicyManager.EXTRA_PROVISIONING_SKIP_EDUCATION_SCREENS, true))
            }
            DevicePolicyManager.ACTION_ADMIN_POLICY_COMPLIANCE -> {
                provisioningExtras()?.getString(ProtectedSpaceContract.EXTRA_PUBLIC_KEY)?.let {
                    ProtectedSpacePolicy.savePublicKey(this, it)
                }
                val applied = runCatching {
                    ProtectedSpacePolicy.completeProvisioning(this)
                    ProtectedSpacePolicy.lockAndEvict(this)
                }
                setResult(if (applied.isSuccess) RESULT_OK else RESULT_CANCELED)
            }
            else -> setResult(RESULT_CANCELED)
        }
        finish()
    }

    @Suppress("DEPRECATION")
    private fun provisioningExtras(): PersistableBundle? =
        intent.getParcelableExtra(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE)
}
