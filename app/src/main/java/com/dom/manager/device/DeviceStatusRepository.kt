package com.dom.manager.device

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.BatteryManager
import android.os.Build
import com.dom.manager.admin.DOMAdminReceiver

data class DeviceSnapshot(
    val manufacturer: String,
    val model: String,
    val androidVersion: String,
    val sdkInt: Int,
    val isDeviceOwner: Boolean,
    val isProfileOwner: Boolean,
    val isDeviceAdmin: Boolean,
    val batteryLevel: Int?,
    val isCharging: Boolean?,
    val managementCapabilities: Map<String, Boolean>
)

class DeviceStatusRepository(private val context: Context) {
    fun read(): DeviceSnapshot {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val battery = context.getSystemService(BatteryManager::class.java)
        val batteryLevel = battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            .takeIf { it in 0..100 }
        val deviceOwner = dpm.isDeviceOwnerApp(context.packageName)
        val profileOwner = dpm.isProfileOwnerApp(context.packageName)
        val legacyAdmin = dpm.isAdminActive(ComponentName(context, DOMAdminReceiver::class.java))

        return DeviceSnapshot(
            manufacturer = Build.MANUFACTURER.orEmpty(),
            model = Build.MODEL.orEmpty(),
            androidVersion = Build.VERSION.RELEASE.orEmpty(),
            sdkInt = Build.VERSION.SDK_INT,
            isDeviceOwner = deviceOwner,
            isProfileOwner = profileOwner,
            isDeviceAdmin = legacyAdmin,
            batteryLevel = batteryLevel,
            isCharging = battery.isCharging,
            managementCapabilities = mapOf(
                "deviceOwner" to deviceOwner,
                "profileOwner" to profileOwner,
                "legacyDeviceAdmin" to legacyAdmin,
                "canApplyOwnerPolicies" to (deviceOwner || profileOwner),
                "lockTaskPermitted" to dpm.isLockTaskPermitted(context.packageName),
                "batteryTelemetryAvailable" to (batteryLevel != null)
            )
        )
    }
}
