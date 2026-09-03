package com.nocturne.vault

import android.content.ComponentName
import android.content.Context
import android.content.pm.ActivityInfo
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PortraitOrientationTest {

    @Test
    fun everyActivityIsLockedToPortrait() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val activities = listOf(
            MainActivity::class.java,
            AutofillAuthActivity::class.java,
            CredentialProviderActivity::class.java,
        )

        activities.forEach { activity ->
            val info = context.packageManager.getActivityInfo(
                ComponentName(context, activity),
                0,
            )

            assertEquals(
                "${activity.simpleName} must stay in portrait orientation",
                ActivityInfo.SCREEN_ORIENTATION_PORTRAIT,
                info.screenOrientation,
            )
        }
    }
}
