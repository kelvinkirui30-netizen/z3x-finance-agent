package com.dom.manager.remote

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Processes only the explicitly supported, non-destructive command types.
 * Device requests are delivered over authenticated HTTPS and acknowledged
 * with a one-time server nonce. No finance status can trigger device actions.
 */
object DeviceCommandProcessor {
    fun process(context: Context, installId: String, token: String): Boolean {
        val prefs = context.getSharedPreferences("z3x_device_identity", Context.MODE_PRIVATE)
        val response = post(
            "https://z3x-finance-agent-rlq5.vercel.app/api/device-commands?action=fetch",
            token,
            JSONObject().put("installId", installId)
        ) ?: return false
        val commands = response.optJSONArray("commands") ?: JSONArray()
        for (index in 0 until commands.length()) {
            val item = commands.optJSONObject(index) ?: continue
            val commandId = item.optString("commandId")
            val nonce = item.optString("nonce")
            val command = item.optString("command")
            val payload = item.optJSONObject("payload") ?: JSONObject()
            val outcome: String
            val message: String
            when (command) {
                "request_check_in" -> {
                    // The check-in at the start of this worker satisfies this request.
                    outcome = "success"
                    message = "Device check-in completed."
                }
                "display_notice" -> {
                    val notice = payload.optString("message").trim()
                    if (notice.isBlank() || notice.length > 300) {
                        outcome = "failed"
                        message = "The notice content was invalid."
                    } else {
                        prefs.edit()
                            .putString("last_device_notice", notice)
                            .putString("last_device_notice_id", commandId)
                            .apply()
                        outcome = "success"
                        message = "Notice saved for display in the app."
                    }
                }
                else -> {
                    outcome = "failed"
                    message = "Unsupported command type."
                }
            }
            val acknowledged = post(
                "https://z3x-finance-agent-rlq5.vercel.app/api/device-commands?action=complete",
                token,
                JSONObject()
                    .put("installId", installId)
                    .put("commandId", commandId)
                    .put("nonce", nonce)
                    .put("outcome", outcome)
                    .put("message", message)
            ) ?: return false
            if (!acknowledged.optBoolean("success", false)) return false
        }
        return true
    }

    private fun post(endpoint: String, token: String, body: JSONObject): JSONObject? {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15000
                readTimeout = 20000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Authorization", "Bearer $token")
            }
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (status !in 200..299) null else JSONObject(text.ifBlank { "{}" })
        } catch (_: Exception) {
            null
        } finally {
            connection?.disconnect()
        }
    }
}
