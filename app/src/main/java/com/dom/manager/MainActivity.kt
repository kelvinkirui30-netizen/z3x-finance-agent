package com.dom.manager

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.dom.manager.device.DeviceStatusRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    Dashboard()
                }
            }
        }
    }
}

@Composable
private fun Dashboard() {
    val context = androidx.compose.ui.platform.LocalContext.current
    var snapshot by remember { mutableStateOf<com.dom.manager.device.DeviceSnapshot?>(null) }

    LaunchedEffect(Unit) {
        snapshot = withContext(Dispatchers.IO) {
            DeviceStatusRepository(context.applicationContext).read()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("Z3X Finance Agent", style = MaterialTheme.typography.headlineMedium)
        Text("Native Android DPC starter", style = MaterialTheme.typography.bodyMedium)

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Device overview", style = MaterialTheme.typography.titleLarge)
                if (snapshot == null) {
                    Text("Reading device information…")
                } else {
                    val s = snapshot!!
                    InfoRow("Manufacturer", s.manufacturer)
                    InfoRow("Model", s.model)
                    InfoRow("Android", s.androidVersion)
                    InfoRow("API level", s.sdkInt.toString())
                }
            }
        }

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Management enrollment", style = MaterialTheme.typography.titleLarge)
                Text(
                    when {
                        snapshot?.isDeviceOwner == true -> "Device Owner: active"
                        snapshot?.isProfileOwner == true -> "Profile Owner: active"
                        snapshot == null -> "Checking enrollment…"
                        else -> "Not enrolled as Device Owner or Profile Owner"
                    }
                )
                Text(
                    "Installing the APK does not grant Device Owner privileges. " +
                    "Use Android's supported provisioning process on a device you own."
                )
            }
        }

        Text("Modules planned", style = MaterialTheme.typography.titleLarge)
        listOf(
            "App inventory and approved-app policies",
            "Kiosk / lock-task configuration",
            "Security policy status",
            "Network policy status",
            "Firebase-authenticated remote administration",
            "Compliance reports and audit history"
        ).forEach { item ->
            Card(modifier = Modifier.fillMaxWidth()) {
                Text(item, Modifier.padding(16.dp))
            }
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}
