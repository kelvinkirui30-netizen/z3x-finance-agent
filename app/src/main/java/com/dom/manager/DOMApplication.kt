package com.dom.manager

import android.app.Application
import com.google.firebase.FirebaseApp

class DOMApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        FirebaseApp.initializeApp(this)
    }
}
