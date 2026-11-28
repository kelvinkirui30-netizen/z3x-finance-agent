package com.dom.manager.remote

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import android.util.Base64
import com.dom.manager.BuildConfig
import com.dom.manager.device.DeviceStatusRepository
import com.google.firebase.auth.FirebaseAuth
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class DeviceCheckInWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val prefs = applicationContext.getSharedPreferences("z3x_device_identity", Context.MODE_PRIVATE)
        val installId = prefs.getString("install_id", null) ?: return Result.success()
        if (!prefs.getBoolean("is_enrolled", false)) return Result.success()

        val snapshot = try { DeviceStatusRepository(applicationContext).read() }
        catch (_: Exception) { recordError(prefs, "Unable to read device status. The next scheduled check-in will retry."); return Result.retry() }

        val managementMode = when {
            snapshot.isDeviceOwner -> "device_owner"
            snapshot.isProfileOwner -> "profile_owner"
            snapshot.isDeviceAdmin -> "device_admin"
            else -> "standard_access"
        }
        val device = JSONObject().apply {
            put("manufacturer", snapshot.manufacturer.take(120))
            put("model", snapshot.model.take(120))
            put("androidVersion", snapshot.androidVersion.take(120))
            put("sdkInt", snapshot.sdkInt)
            put("appVersion", BuildConfig.VERSION_NAME)
            put("managementMode", managementMode)
            put("managementCapabilities", JSONObject(snapshot.managementCapabilities))
            snapshot.batteryLevel?.let { put("batteryLevel", it) }
            snapshot.isCharging?.let { put("isCharging", it) }
        }

        return try {
            if (!prefs.getBoolean("device_key_registered", false)) {
                val user = FirebaseAuth.getInstance().currentUser
                    ?: run { recordError(prefs, "This device needs staff-assisted credential setup. Sign in with an authorized staff account."); return Result.retry() }
                val token = user.getIdToken(true).awaitToken()
                val registered = post(
                    "/api/register-device-key",
                    JSONObject().put("installId", installId).put("publicKeyPem", DeviceKeyStore.publicKeyPem(installId)),
                    token
                )
                if (!registered.optBoolean("success", false)) {
                    recordError(prefs, registered.optString("error", "Staff authorization is required to register this device key."))
                    return Result.retry()
                }
                prefs.edit().putBoolean("device_key_registered", true).apply()
            }

            val challengeResponse = post("/api/device-challenge", JSONObject().put("installId", installId))
            val challenge = challengeResponse.optString("challenge")
            if (challenge.isBlank()) {
                recordError(prefs, challengeResponse.optString("error", "Unable to obtain a device challenge."))
                return Result.retry()
            }
            val digest = MessageDigest.getInstance("SHA-256").digest(canonicalJson(device).toByteArray(Charsets.UTF_8))
            val digestHex = digest.joinToString("") { "%02x".format(it) }
            val message = "$installId\n$challenge\n$digestHex".toByteArray(Charsets.UTF_8)
            val signature = DeviceKeyStore.sign(installId, message)
            val response = post(
                "/api/device-checkin",
                JSONObject().put("installId", installId).put("challenge", challenge)
                    .put("signature", signature).put("device", device)
            )
            if (response.optBoolean("success", false)) {
                prefs.edit().putLong("last_checkin_at", System.currentTimeMillis()).remove("last_checkin_error").apply()
                Result.success()
            } else {
                val error = response.optString("error", "The server rejected this device check-in.")
                recordError(prefs, error)
                if (error.contains("not enrolled", true) || error.contains("authorization has changed", true)) Result.failure() else Result.retry()
            }
        } catch (_: Exception) {
            recordError(prefs, "Network or cryptographic check-in failed. The agent will retry.")
            Result.retry()
        }
    }

    private fun post(path: String, body: JSONObject, bearer: String? = null): JSONObject {
        var connection: HttpURLConnection? = null
        try {
            connection = (URL("https://z3x-finance-agent-rlq5.vercel.app$path").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15000
                readTimeout = 20000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                if (!bearer.isNullOrBlank()) setRequestProperty("Authorization", "Bearer $bearer")
            }
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            return JSONObject(text.ifBlank { "{}" })
        } finally { connection?.disconnect() }
    }

    private fun canonicalJson(value: JSONObject): String {
        fun canonical(item: Any?): String = when (item) {
            is JSONObject -> item.keys().asSequence().toList().sorted().joinToString(",", "{", "}") { key ->
                JSONObject.quote(key) + ":" + canonical(item.get(key))
            }
            is org.json.JSONArray -> (0 until item.length()).joinToString(",", "[", "]") { canonical(item.get(it)) }
            JSONObject.NULL -> "null"
            is String -> JSONObject.quote(item)
            else -> item.toString()
        }
        return canonical(value)
    }

    private suspend fun com.google.android.gms.tasks.Task<com.google.firebase.auth.GetTokenResult>.awaitToken(): String =
        kotlinx.coroutines.suspendCancellableCoroutine { continuation ->
            addOnSuccessListener { result ->
                val token = result.token
                if (token.isNullOrBlank()) continuation.resumeWith(Result.failure(IllegalStateException("Missing staff token.")))
                else continuation.resumeWith(Result.success(token))
            }.addOnFailureListener { continuation.resumeWith(Result.failure(it)) }
        }

    private fun recordError(prefs: android.content.SharedPreferences, message: String) {
        prefs.edit().putString("last_checkin_error", message).apply()
    }
}
