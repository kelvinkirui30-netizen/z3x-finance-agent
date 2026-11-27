package com.dom.manager.remote

import android.content.Context
import android.provider.Settings
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.UUID

/**
 * Derives a stable, app-specific installation identifier from Android's
 * app-signing-key-scoped ANDROID_ID. The raw Android ID is never transmitted.
 * A factory reset or signing-certificate change can produce a new identifier.
 */
object DeviceIdentity {
    fun getOrCreate(context: Context): String {
        val prefs = context.getSharedPreferences("z3x_device_identity", Context.MODE_PRIVATE)
        prefs.getString("install_id", null)?.let { return it }

        val androidId = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ANDROID_ID
        )
        val stableId = if (!androidId.isNullOrBlank()) {
            val seed = "device-owner-manager:${context.packageName}:$androidId"
            val bytes = MessageDigest.getInstance("SHA-256")
                .digest(seed.toByteArray(Charsets.UTF_8))
                .copyOfRange(0, 16)
            bytes[6] = ((bytes[6].toInt() and 0x0f) or 0x50).toByte()
            bytes[8] = ((bytes[8].toInt() and 0x3f) or 0x80).toByte()
            val buffer = ByteBuffer.wrap(bytes)
            UUID(buffer.long, buffer.long).toString()
        } else {
            UUID.randomUUID().toString()
        }

        prefs.edit().putString("install_id", stableId).apply()
        return stableId
    }
}
