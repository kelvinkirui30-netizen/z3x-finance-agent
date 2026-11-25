package com.dom.manager.device

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.os.Build

data class DeviceSnapshot(
    val manufacturer: String,
    val model: String,
    val androidVersion: String,
    val sdkInt: Int,
    val isDeviceOwner: Boolean,
    val isProfileOwner: Boolean
)

class DeviceStatusRepository(private val context: Context) {
    fun read(): DeviceSnapshot {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)

        return DeviceSnapshot(
            manufacturer = Build.MANUFACTURER.orEmpty(),
            model = Build.MODEL.orEmpty(),
            androidVersion = Build.VERSION.RELEASE.orEmpty(),
            sdkInt = Build.VERSION.SDK_INT,
            isDeviceOwner = dpm.isDeviceOwnerApp(context.packageName),
            isProfileOwner = dpm.isProfileOwnerApp(context.packageName)
        )
    }
}
