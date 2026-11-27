package com.dom.manager.remote

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.dom.manager.BuildConfig
import com.dom.manager.device.DeviceStatusRepository
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class DeviceCheckInWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val user = FirebaseAuth.getInstance().currentUser ?: return Result.success()
        val prefs = applicationContext.getSharedPreferences("z3x_device_identity", Context.MODE_PRIVATE)
        val installId = prefs.getString("install_id", null) ?: return Result.success()
        if (!prefs.getBoolean("is_enrolled", false) ||
            prefs.getString("owner_uid", null) != user.uid) return Result.success()

        val token = try {
            Tasks.await(user.getIdToken(true)).token ?: run {
                recordError(prefs, "Could not refresh the sign-in session. Open the app and sign in again.")
                return Result.retry()
            }
        } catch (_: Exception) {
            recordError(prefs, "Could not refresh the sign-in session. Open the app and sign in again.")
            return Result.retry()
        }

        val snapshot = try {
            DeviceStatusRepository(applicationContext).read()
        } catch (_: Exception) {
            recordError(prefs, "Unable to read device status. The next scheduled check-in will retry.")
            return Result.retry()
        }
        val managementMode = when {
            snapshot.isDeviceOwner -> "device_owner"
            snapshot.isProfileOwner -> "profile_owner"
            snapshot.isDeviceAdmin -> "device_admin"
            else -> "standard_access"
        }
        val payload = JSONObject().apply {
            put("installId", installId)
            put("device", JSONObject().apply {
                put("manufacturer", snapshot.manufacturer.take(120))
                put("model", snapshot.model.take(120))
                put("androidVersion", snapshot.androidVersion.take(120))
                put("sdkInt", snapshot.sdkInt)
                put("appVersion", BuildConfig.VERSION_NAME)
                put("managementMode", managementMode)
                put("managementCapabilities", JSONObject(snapshot.managementCapabilities))
                snapshot.batteryLevel?.let { put("batteryLevel", it) }
                snapshot.isCharging?.let { put("isCharging", it) }
            })
        }

        var connection: HttpURLConnection? = null
        return try {
            connection = (URL("https://z3x-finance-agent-rlq5.vercel.app/api/device-checkin").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15000
                readTimeout = 20000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Authorization", "Bearer $token")
            }
            connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            when (connection.responseCode) {
                in 200..299 -> {
                    prefs.edit().putLong("last_checkin_at", System.currentTimeMillis()).remove("last_checkin_error").apply()
                    if (DeviceCommandProcessor.process(applicationContext, installId, token)) Result.success()
                    else {
                        recordError(prefs, "Device status synced, but a pending device request could not be acknowledged. It will retry.")
                        Result.retry()
                    }
                }
                401, 408, 429 -> {
                    recordError(prefs, "Temporary authentication or network issue. The agent will retry.")
                    Result.retry()
                }
                403, 404, 410 -> {
                    DeviceCheckInScheduler.cancel(applicationContext)
                    prefs.edit()
                        .putBoolean("is_enrolled", false)
                        .remove("owner_uid")
                        .putString("last_checkin_error", "This installation is no longer linked to the signed-in account. Link it again from the portal if needed.")
                        .apply()
                    Result.success()
                }
                in 500..599 -> {
                    recordError(prefs, "The server is temporarily unavailable. The agent will retry.")
                    Result.retry()
                }
                else -> {
                    recordError(prefs, "The server rejected this check-in. Review enrollment in the app.")
                    Result.failure()
                }
            }
        } catch (_: Exception) {
            recordError(prefs, "Network unavailable. The agent will retry when Android allows.")
            Result.retry()
        } finally {
            connection?.disconnect()
        }
    }

    private fun recordError(prefs: android.content.SharedPreferences, message: String) {
        prefs.edit().putString("last_checkin_error", message).apply()
    }
}
