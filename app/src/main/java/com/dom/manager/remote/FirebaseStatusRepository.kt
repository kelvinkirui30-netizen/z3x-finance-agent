package com.dom.manager.remote

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.dom.manager.BuildConfig
import com.dom.manager.device.DeviceSnapshot
import com.google.firebase.Timestamp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.SetOptions
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class ManagedDevice(
    val id: String,
    val displayName: String,
    val manufacturer: String,
    val model: String,
    val androidVersion: String,
    val appVersion: String,
    val managementMode: String,
    val enrollmentStatus: String,
    val batteryLevel: Long?,
    val isCharging: Boolean?,
    val lastSeenAt: Timestamp?
)

data class FinanceInstallment(
    val id: String,
    val deviceId: String,
    val label: String,
    val amountMinor: Long,
    val currencyCode: String,
    val dueDate: Timestamp?
)

data class FinancePayment(
    val id: String,
    val installmentId: String,
    val amountMinor: Long,
    val currencyCode: String,
    val paidAt: Timestamp?,
    val reference: String
)

class FirebaseStatusRepository(
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
    private val db: FirebaseFirestore = FirebaseFirestore.getInstance()
) {
    fun currentUser(): FirebaseUser? = auth.currentUser

    fun createAccount(name: String, email: String, password: String, onResult: (Result<FirebaseUser>) -> Unit) {
        auth.createUserWithEmailAndPassword(email.trim(), password)
            .addOnSuccessListener { result ->
                val user = result.user
                if (user == null) onResult(Result.failure(IllegalStateException("No user session returned.")))
                else saveProfile(user, name.trim(), onResult)
            }
            .addOnFailureListener { onResult(Result.failure(it)) }
    }

    fun signIn(email: String, password: String, onResult: (Result<FirebaseUser>) -> Unit) {
        auth.signInWithEmailAndPassword(email.trim(), password)
            .addOnSuccessListener { result ->
                val user = result.user
                if (user == null) onResult(Result.failure(IllegalStateException("No user session returned.")))
                else onResult(Result.success(user))
            }
            .addOnFailureListener { onResult(Result.failure(it)) }
    }

    fun sendPasswordReset(email: String, onResult: (Result<Unit>) -> Unit) {
        val normalizedEmail = email.trim()
        if (normalizedEmail.isBlank()) {
            onResult(Result.failure(IllegalArgumentException("Enter your email address first.")))
            return
        }
        auth.sendPasswordResetEmail(normalizedEmail)
            .addOnSuccessListener { onResult(Result.success(Unit)) }
            .addOnFailureListener { onResult(Result.failure(it)) }
    }

    private fun ensureProfile(user: FirebaseUser, onResult: (Result<FirebaseUser>) -> Unit) {
        db.collection("users").document(user.uid).get()
            .addOnSuccessListener { snapshot ->
                if (snapshot.exists()) onResult(Result.success(user))
                else saveProfile(user, user.displayName.orEmpty(), onResult)
            }
            .addOnFailureListener { onResult(Result.failure(it)) }
    }

    private fun saveProfile(user: FirebaseUser, name: String, onResult: (Result<FirebaseUser>) -> Unit) {
        val now = Timestamp.now()
        val profile = mapOf(
            "displayName" to name,
            "email" to user.email.orEmpty(),
            "createdAt" to now,
            "updatedAt" to now
        )
        db.collection("users").document(user.uid).set(profile, SetOptions.merge())
            .addOnSuccessListener { onResult(Result.success(user)) }
            .addOnFailureListener { onResult(Result.failure(it)) }
    }

    fun observeMyDevices(
        uid: String,
        onChange: (List<ManagedDevice>) -> Unit,
        onError: (Exception) -> Unit
    ): ListenerRegistration = db.collection("devices")
        .whereEqualTo("ownerUid", uid)
        .addSnapshotListener { snapshot, error ->
            if (error != null) {
                onError(error)
                return@addSnapshotListener
            }
            onChange(snapshot?.documents.orEmpty().map { doc ->
                ManagedDevice(
                    id = doc.id,
                    displayName = doc.getString("displayName").orEmpty(),
                    manufacturer = doc.getString("manufacturer").orEmpty(),
                    model = doc.getString("model").orEmpty(),
                    androidVersion = doc.getString("androidVersion").orEmpty(),
                    appVersion = doc.getString("appVersion").orEmpty(),
                    managementMode = doc.getString("managementMode").orEmpty(),
                    enrollmentStatus = doc.getString("enrollmentStatus").orEmpty(),
                    batteryLevel = doc.getLong("batteryLevel"),
                    isCharging = doc.getBoolean("isCharging"),
                    lastSeenAt = doc.getTimestamp("lastSeenAt")
                )
            })
        }


    fun observeMyInstallments(
        uid: String,
        onChange: (List<FinanceInstallment>) -> Unit,
        onError: (Exception) -> Unit
    ): ListenerRegistration = db.collection("device_installments")
        .whereEqualTo("ownerUid", uid)
        .addSnapshotListener { snapshot, error ->
            if (error != null) {
                onError(error)
                return@addSnapshotListener
            }
            onChange(snapshot?.documents.orEmpty().map { doc ->
                FinanceInstallment(
                    id = doc.id,
                    deviceId = doc.getString("deviceId").orEmpty(),
                    label = doc.getString("label").orEmpty(),
                    amountMinor = doc.getLong("amountMinor") ?: 0L,
                    currencyCode = doc.getString("currencyCode") ?: "KES",
                    dueDate = doc.getTimestamp("dueDate")
                )
            }.sortedBy { it.dueDate?.toDate()?.time ?: Long.MAX_VALUE })
        }

    fun observeMyPayments(
        uid: String,
        onChange: (List<FinancePayment>) -> Unit,
        onError: (Exception) -> Unit
    ): ListenerRegistration = db.collection("device_installment_payments")
        .whereEqualTo("ownerUid", uid)
        .addSnapshotListener { snapshot, error ->
            if (error != null) {
                onError(error)
                return@addSnapshotListener
            }
            onChange(snapshot?.documents.orEmpty().map { doc ->
                FinancePayment(
                    id = doc.id,
                    installmentId = doc.getString("installmentId").orEmpty(),
                    amountMinor = doc.getLong("amountMinor") ?: 0L,
                    currencyCode = doc.getString("currencyCode") ?: "KES",
                    paidAt = doc.getTimestamp("paidAt"),
                    reference = doc.getString("reference").orEmpty()
                )
            }.sortedByDescending { it.paidAt?.toDate()?.time ?: 0L })
        }

    fun restoreExistingEnrollment(
        context: Context,
        onResult: (Result<String>) -> Unit
    ) {
        val current = auth.currentUser
        if (current == null) {
            onResult(Result.failure(IllegalStateException("Sign in to restore this device link.")))
            return
        }
        val installId = DeviceIdentity.getOrCreate(context)
        current.getIdToken(false)
            .addOnSuccessListener { tokenResult ->
                val token = tokenResult.token
                if (token.isNullOrBlank()) {
                    onResult(Result.failure(IllegalStateException("Could not refresh your sign-in token.")))
                    return@addOnSuccessListener
                }
                Thread {
                    var connection: HttpURLConnection? = null
                    val result = try {
                        connection = (URL("https://z3x-finance-agent-rlq5.vercel.app/api/restore-device-enrollment").openConnection() as HttpURLConnection).apply {
                            requestMethod = "POST"
                            connectTimeout = 15000
                            readTimeout = 20000
                            doOutput = true
                            setRequestProperty("Content-Type", "application/json")
                            setRequestProperty("Authorization", "Bearer $token")
                        }
                        val body = JSONObject().put("installId", installId)
                        connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                        val status = connection.responseCode
                        val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                        val response = JSONObject(stream?.bufferedReader()?.use { it.readText() }.orEmpty().ifBlank { "{}" })
                        if (status in 200..299) {
                            context.getSharedPreferences("z3x_device_identity", Context.MODE_PRIVATE)
                                .edit().putBoolean("is_enrolled", true).putString("owner_uid", current.uid).apply()
                            Result.success(response.optString("message", "Existing device link restored."))
                        } else {
                            Result.failure(IllegalStateException(response.optString("error", "No active device link was found.")))
                        }
                    } catch (error: Exception) {
                        Result.failure(IllegalStateException(error.localizedMessage ?: "Unable to restore the device link."))
                    } finally {
                        connection?.disconnect()
                    }
                    Handler(Looper.getMainLooper()).post { onResult(result) }
                }.start()
            }
            .addOnFailureListener { onResult(Result.failure(it)) }
    }

    fun enrollCurrentDevice(
        context: Context,
        code: String,
        snapshot: DeviceSnapshot,
        onResult: (Result<String>) -> Unit
    ) {
        val current = auth.currentUser
        if (current == null) {
            onResult(Result.failure(IllegalStateException("Sign in before enrolling this device.")))
            return
        }
        if (!code.matches(Regex("[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}"))) {
            onResult(Result.failure(IllegalArgumentException("Enter the 8-character code shown in your portal.")))
            return
        }
        current.getIdToken(false)
            .addOnSuccessListener { tokenResult ->
                val token = tokenResult.token
                if (token.isNullOrBlank()) {
                    onResult(Result.failure(IllegalStateException("Could not refresh your sign-in token.")))
                    return@addOnSuccessListener
                }
                val prefs = context.getSharedPreferences("z3x_device_identity", Context.MODE_PRIVATE)
                val installId = DeviceIdentity.getOrCreate(context)
                val managementMode = when {
                    snapshot.isDeviceOwner -> "device_owner"
                    snapshot.isProfileOwner -> "profile_owner"
                    snapshot.isDeviceAdmin -> "device_admin"
                    else -> "standard_access"
                }
                val payload = JSONObject().apply {
                    put("code", code)
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
                Thread {
                    var connection: HttpURLConnection? = null
                    val result = try {
                        connection = (URL("https://z3x-finance-agent-rlq5.vercel.app/api/enroll-device").openConnection() as HttpURLConnection).apply {
                            requestMethod = "POST"
                            connectTimeout = 15000
                            readTimeout = 20000
                            doOutput = true
                            setRequestProperty("Content-Type", "application/json")
                            setRequestProperty("Authorization", "Bearer $token")
                        }
                        connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
                        val status = connection.responseCode
                        val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                        val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
                        val json = JSONObject(body.ifBlank { "{}" })
                        if (status in 200..299) {
                            prefs.edit()
                                .putBoolean("is_enrolled", true)
                                .putString("owner_uid", current.uid)
                                .apply()
                            Result.success(json.optString("message", "Device linked to your account."))
                        } else {
                            Result.failure(IllegalStateException(json.optString("error", "Device enrollment failed.")))
                        }
                    } catch (error: Exception) {
                        Result.failure(IllegalStateException(error.localizedMessage ?: "Network error during enrollment."))
                    } finally {
                        connection?.disconnect()
                    }
                    Handler(Looper.getMainLooper()).post { onResult(result) }
                }.start()
            }
            .addOnFailureListener { onResult(Result.failure(it)) }
    }

    fun signOut() = auth.signOut()
}
