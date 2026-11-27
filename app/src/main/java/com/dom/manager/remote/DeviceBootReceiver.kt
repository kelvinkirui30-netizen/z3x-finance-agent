package com.dom.manager.remote

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.firebase.auth.FirebaseAuth

/**
 * Restores only the app's ordinary, network-constrained WorkManager check-in
 * after Android reports boot or an app update. It does not restart a service,
 * hide the app, or override user/OS controls.
 */
class DeviceBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return

        val appContext = context.applicationContext
        val prefs = appContext.getSharedPreferences("z3x_device_identity", Context.MODE_PRIVATE)
        val user = FirebaseAuth.getInstance().currentUser
        val enrolled = prefs.getBoolean("is_enrolled", false)
        val ownerUid = prefs.getString("owner_uid", null)

        if (enrolled && user != null && ownerUid == user.uid) {
            DeviceCheckInScheduler.schedule(appContext)
        } else {
            DeviceCheckInScheduler.cancel(appContext)
        }
    }
}
