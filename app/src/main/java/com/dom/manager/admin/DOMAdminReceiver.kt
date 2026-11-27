package com.dom.manager.admin

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import com.dom.manager.remote.DeviceCheckInScheduler

/**
 * Observes the legacy Android Device Admin state only. No destructive
 * device-admin policies are requested by this app.
 */
class DOMAdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        DeviceCheckInScheduler.checkInNow(context.applicationContext)
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        DeviceCheckInScheduler.checkInNow(context.applicationContext)
    }
}
