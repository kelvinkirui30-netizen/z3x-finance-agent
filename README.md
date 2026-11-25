# Z3X Finance Agent

Android Device Policy Controller (DPC) starter built with Kotlin and Jetpack Compose.

This project is intended for transparent administration of devices you own or are explicitly authorized to manage. Installing the app does not grant Device Owner privileges; enrollment must use Android's supported provisioning process.

## Build
Open this project in Android Studio. Use JDK 17 and the Android SDK versions specified by the Gradle configuration.

## Current scope
Starter foundation: device status, Device Owner/Profile Owner status checks, a DeviceAdminReceiver declaration, and Firebase client SDK integration. Advanced policy management and remote administration are not yet implemented.

Never commit service-account private keys, admin credentials, passwords, or access tokens. Apply Firebase Authentication and Firestore Security Rules to protect data.
