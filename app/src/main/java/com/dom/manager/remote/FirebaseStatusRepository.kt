package com.dom.manager.remote

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore

/**
 * Starter Firebase access point.
 * Configure Firebase Authentication and Firestore in your Firebase project.
 * Never put service-account credentials in this Android app.
 */
class FirebaseStatusRepository(
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
    private val db: FirebaseFirestore = FirebaseFirestore.getInstance()
) {
    fun currentUserId(): String? = auth.currentUser?.uid

    fun signOut() {
        auth.signOut()
    }
}
