package com.dom.manager

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.dom.manager.device.DeviceStatusRepository
import com.dom.manager.remote.DeviceCheckInScheduler
import com.dom.manager.remote.FirebaseStatusRepository
import com.dom.manager.remote.ManagedDevice
import com.google.firebase.auth.FirebaseUser

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme { Surface(Modifier.fillMaxSize()) { Z3XApp() } } }
    }
}

@Composable
private fun Z3XApp() {
    val repository = remember { FirebaseStatusRepository() }
    var user by remember { mutableStateOf(repository.currentUser()) }
    val appContext = androidx.compose.ui.platform.LocalContext.current.applicationContext
    if (user == null) {
        AuthenticationScreen(repository) { user = it }
    } else {
        DeviceDashboard(
            userId = user!!.uid,
            email = user!!.email.orEmpty(),
            repository = repository,
            onSignOut = {
                DeviceCheckInScheduler.cancel(appContext)
                repository.signOut()
                user = null
            }
        )
    }
}

@Composable
private fun AuthenticationScreen(
    repository: FirebaseStatusRepository,
    onAuthenticated: (FirebaseUser) -> Unit
) {
    var createAccount by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Text("Z3X Finance Agent", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))
        Text(if (createAccount) "Create your account to access your devices." else "Sign in to manage devices assigned to your account.")
        Spacer(Modifier.height(24.dp))
        if (createAccount) {
            OutlinedTextField(name, { name = it }, label = { Text("Full name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(12.dp))
        }
        OutlinedTextField(
            email, { email = it }, label = { Text("Email address") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            singleLine = true, modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            password, { password = it }, label = { Text("Password") },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            singleLine = true, modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = {
                message = null
                if (email.isBlank() || password.length < 6 || (createAccount && name.isBlank())) {
                    message = "Enter a valid email, a password of at least 6 characters, and your name when creating an account."
                    return@Button
                }
                busy = true
                val callback: (Result<FirebaseUser>) -> Unit = { result ->
                    busy = false
                    result.onSuccess(onAuthenticated).onFailure {
                        message = it.localizedMessage ?: "Authentication failed."
                    }
                }
                if (createAccount) repository.createAccount(name, email, password, callback)
                else repository.signIn(email, password, callback)
            },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth()
        ) {
            if (busy) CircularProgressIndicator()
            else Text(if (createAccount) "Create account" else "Sign in")
        }
        if (!createAccount) {
            TextButton(
                onClick = {
                    message = null
                    busy = true
                    repository.sendPasswordReset(email) { result ->
                        busy = false
                        message = result.fold(
                            onSuccess = { "If the account exists, a password reset email has been sent." },
                            onFailure = { it.localizedMessage ?: "Unable to send the password reset email." }
                        )
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth()
            ) { Text("Forgot password?") }
        }
        TextButton(
            onClick = { createAccount = !createAccount; message = null },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(if (createAccount) "Already registered? Sign in" else "New here? Create an account")
        }
        message?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        Spacer(Modifier.height(12.dp))
        Text(
            "Authentication is handled by Firebase. Device records are visible only to their assigned owner and authorized staff.",
            style = MaterialTheme.typography.bodySmall
        )
    }
}

@Composable
private fun DeviceDashboard(
    userId: String,
    email: String,
    repository: FirebaseStatusRepository,
    onSignOut: () -> Unit
) {
    var devices by remember { mutableStateOf<List<ManagedDevice>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var enrollmentCode by remember { mutableStateOf("") }
    var enrollmentBusy by remember { mutableStateOf(false) }
    var enrollmentMessage by remember { mutableStateOf<String?>(null) }
    val context = androidx.compose.ui.platform.LocalContext.current
    var confirmEnrollment by remember { mutableStateOf(false) }
    var deviceNotice by remember { mutableStateOf(contextNotice(context.applicationContext)) }

    DisposableEffect(userId) {
        val registration = repository.observeMyDevices(
            uid = userId,
            onChange = { devices = it; loading = false; error = null },
            onError = { loading = false; error = it.localizedMessage ?: "Unable to load devices." }
        )
        onDispose { registration.remove() }
    }

    DisposableEffect(context) {
        val noticePrefs = context.applicationContext.getSharedPreferences("z3x_device_identity", android.content.Context.MODE_PRIVATE)
        val listener = android.content.SharedPreferences.OnSharedPreferenceChangeListener { prefs, key ->
            if (key == "last_device_notice") deviceNotice = prefs.getString("last_device_notice", null)
        }
        noticePrefs.registerOnSharedPreferenceChangeListener(listener)
        onDispose { noticePrefs.unregisterOnSharedPreferenceChangeListener(listener) }
    }
    var localStatus by remember { mutableStateOf<com.dom.manager.device.DeviceSnapshot?>(null) }
    LaunchedEffect(userId) {
        val identityPrefs = context.applicationContext.getSharedPreferences("z3x_device_identity", android.content.Context.MODE_PRIVATE)
        val enrolledForThisAccount = identityPrefs.getBoolean("is_enrolled", false) &&
            identityPrefs.getString("owner_uid", null) == userId
        if (enrolledForThisAccount) DeviceCheckInScheduler.schedule(context.applicationContext)
        else DeviceCheckInScheduler.cancel(context.applicationContext)
        localStatus = DeviceStatusRepository(context.applicationContext).read()
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.weight(1f)) {
                Text("Z3X Finance Agent", style = MaterialTheme.typography.headlineSmall)
                Text(email, style = MaterialTheme.typography.bodySmall)
            }
            TextButton(onClick = onSignOut) { Text("Sign out") }
        }
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("My devices", style = MaterialTheme.typography.titleLarge)
                Text("${devices.size} device(s) assigned to this account")
                when {
                    loading -> CircularProgressIndicator()
                    error != null -> Text(error!!, color = MaterialTheme.colorScheme.error)
                    devices.isEmpty() -> Text("No devices are registered to your account yet.")
                    else -> devices.forEach { DeviceCard(it) }
                }
            }
        }
        if (!deviceNotice.isNullOrBlank()) {
            Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Notice from your device administrator", style = MaterialTheme.typography.titleMedium)
                    Text(deviceNotice.orEmpty())
                    TextButton(onClick = {
                        context.applicationContext.getSharedPreferences("z3x_device_identity", android.content.Context.MODE_PRIVATE)
                            .edit().remove("last_device_notice").remove("last_device_notice_id").apply()
                        deviceNotice = null
                    }) { Text("Dismiss notice") }
                }
            }
        }
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("This phone", style = MaterialTheme.typography.titleLarge)
                localStatus?.let { status ->
                    InfoRow("Model", "${status.manufacturer} ${status.model}")
                    InfoRow("Android", status.androidVersion)
                    InfoRow("API level", status.sdkInt.toString())
                    status.batteryLevel?.let { InfoRow("Battery", "$it%") }
                    status.isCharging?.let { InfoRow("Charging", if (it) "Yes" else "No") }
                    InfoRow("Management", when {
                        status.isDeviceOwner -> "Device Owner"
                        status.isProfileOwner -> "Profile Owner"
                        status.isDeviceAdmin -> "Device Admin"
                        else -> "Standard Access"
                    })
                    InfoRow("Owner policy capability", if (status.managementCapabilities["canApplyOwnerPolicies"] == true) "Available" else "Not available")
                    InfoRow("Lock task permitted", if (status.managementCapabilities["lockTaskPermitted"] == true) "Yes" else "No")
                    InfoRow("Battery telemetry", if (status.managementCapabilities["batteryTelemetryAvailable"] == true) "Available" else "Unavailable")
                } ?: Text("Reading local device status…")
            }
        }

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Link this device", style = MaterialTheme.typography.titleLarge)
                Text("Generate a one-time code in your web portal, then enter it here. The device will be linked to the account currently signed in.")
                OutlinedTextField(
                    value = enrollmentCode,
                    onValueChange = { enrollmentCode = it.uppercase().filter { c -> c.isLetterOrDigit() }.take(8); enrollmentMessage = null },
                    label = { Text("8-character enrollment code") },
                    singleLine = true,
                    enabled = !enrollmentBusy,
                    modifier = Modifier.fillMaxWidth()
                )
                Button(
                    onClick = { confirmEnrollment = true },
                    enabled = !enrollmentBusy && enrollmentCode.length == 8 && localStatus != null,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(if (enrollmentBusy) "Linking device…" else "Review and link device")
                }
                enrollmentMessage?.let { Text(it, color = if (it.startsWith("Device successfully")) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error) }
                Text("Only permitted device details are submitted: manufacturer, model, Android version, app version and actual management mode. IMEI and serial numbers are not collected.", style = MaterialTheme.typography.bodySmall)
            }
        }
        if (confirmEnrollment) {
            AlertDialog(
                onDismissRequest = { confirmEnrollment = false },
                title = { Text("Confirm device enrollment") },
                text = {
                    Text("Link this ${localStatus?.manufacturer.orEmpty()} ${localStatus?.model.orEmpty()} to the account $email? The code is single-use and expires after 10 minutes.")
                },
                confirmButton = {
                    TextButton(onClick = {
                        val snapshot = localStatus
                        confirmEnrollment = false
                        if (snapshot != null) {
                            enrollmentBusy = true
                            enrollmentMessage = null
                            repository.enrollCurrentDevice(context, enrollmentCode, snapshot) { result ->
                                enrollmentBusy = false
                                result.onSuccess {
                                    DeviceCheckInScheduler.schedule(context.applicationContext)
                                    DeviceCheckInScheduler.checkInNow(context.applicationContext)
                                    enrollmentCode = ""
                                    enrollmentMessage = "Device successfully linked. Background check-ins are scheduled when Android permits."
                                }.onFailure {
                                    enrollmentMessage = it.localizedMessage ?: "Device enrollment failed."
                                }
                            }
                        }
                    }) { Text("Confirm and link") }
                },
                dismissButton = {
                    TextButton(onClick = { confirmEnrollment = false }) { Text("Cancel") }
                }
            )
        }

        Text(
            "After enrollment, the portal can show the device details reported by this agent. Installing this app alone does not enroll a device.",
            style = MaterialTheme.typography.bodySmall
        )
    }
}

@Composable
private fun DeviceCard(device: ManagedDevice) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                device.displayName.ifBlank {
                    "${device.manufacturer} ${device.model}".trim().ifBlank { "Managed device" }
                },
                style = MaterialTheme.typography.titleMedium
            )
            InfoRow("Enrollment", device.enrollmentStatus.ifBlank { "Unknown" })
            InfoRow("Management", device.managementMode.ifBlank { "Not specified" })
            if (device.androidVersion.isNotBlank()) InfoRow("Android", device.androidVersion)
            device.batteryLevel?.let { InfoRow("Battery", "$it%") }
            device.lastSeenAt?.let { InfoRow("Last check-in", it.toDate().toString()) }
        }
    }
}

private fun contextNotice(context: android.content.Context): String? =
    context.getSharedPreferences("z3x_device_identity", android.content.Context.MODE_PRIVATE)
        .getString("last_device_notice", null)

@Composable
private fun InfoRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}
