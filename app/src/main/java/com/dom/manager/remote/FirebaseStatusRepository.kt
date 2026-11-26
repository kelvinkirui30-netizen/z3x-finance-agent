package com.dom.manager.remote

import com.google.firebase.Timestamp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.SetOptions

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
    val lastSeenAt: Timestamp?
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
                else ensureProfile(user, onResult)
            }
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
                    lastSeenAt = doc.getTimestamp("lastSeenAt")
                )
            })
        }

    fun signOut() = auth.signOut()
}
