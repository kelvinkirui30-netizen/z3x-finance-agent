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

        val token = try {
            Tasks.await(user.getIdToken(true)).token ?: return Result.retry()
        } catch (_: Exception) {
            return Result.retry()
        }

        val snapshot = try {
            DeviceStatusRepository(applicationContext).read()
        } catch (_: Exception) {
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
                in 200..299 -> Result.success()
                401, 408, 429 -> Result.retry()
                in 500..599 -> Result.retry()
                else -> Result.failure()
            }
        } catch (_: Exception) {
            Result.retry()
        } finally {
            connection?.disconnect()
        }
    }
}
