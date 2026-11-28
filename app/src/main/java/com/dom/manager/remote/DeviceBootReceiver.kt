package com.dom.manager.remote

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class DeviceBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED &&
            intent?.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val appContext = context.applicationContext
        val prefs = appContext.getSharedPreferences("z3x_device_identity", Context.MODE_PRIVATE)
        if (prefs.getBoolean("is_enrolled", false)) DeviceCheckInScheduler.schedule(appContext)
        else DeviceCheckInScheduler.cancel(appContext)
    }
}
