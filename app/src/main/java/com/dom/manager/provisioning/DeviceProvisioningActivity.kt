package com.dom.manager.provisioning

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Android Enterprise provisioning entry point. It only accepts fully-managed
 * provisioning when the system allows it and asks the device user to consent
 * before setup continues.
 */
class DeviceProvisioningActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        when (intent.action) {
            DevicePolicyManager.ACTION_GET_PROVISIONING_MODE -> chooseProvisioningMode()
            DevicePolicyManager.ACTION_ADMIN_POLICY_COMPLIANCE -> showConsent()
            else -> {
                setResult(Activity.RESULT_CANCELED)
                finish()
            }
        }
    }

    private fun chooseProvisioningMode() {
        val allowed = intent.getIntegerArrayListExtra(
            DevicePolicyManager.EXTRA_PROVISIONING_ALLOWED_PROVISIONING_MODES
        )
        val fullyManaged = DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE
        if (allowed != null && fullyManaged !in allowed) {
            setResult(Activity.RESULT_CANCELED)
            finish()
            return
        }
        setResult(
            Activity.RESULT_OK,
            Intent().putExtra(DevicePolicyManager.EXTRA_PROVISIONING_MODE, fullyManaged)
        )
        finish()
    }

    private fun showConsent() {
        setContent {
            MaterialTheme {
                Surface(Modifier.fillMaxSize()) {
                    ProvisioningConsent(
                        onAccept = {
                            setResult(Activity.RESULT_OK)
                            finish()
                        },
                        onCancel = {
                            setResult(Activity.RESULT_CANCELED)
                            finish()
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun ProvisioningConsent(
    onAccept: () -> Unit,
    onCancel: () -> Unit
) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Text("Set up this device with Z3X Finance Agent", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(16.dp))
        Text(
            "This setup is for a device owned by the organization providing it. " +
                "Android will register Z3X Finance Agent as the device management app. " +
                "The app will report device status and display clearly identified management notices. " +
                "This build does not silently reinstall itself, collect IMEI/serial numbers, " +
                "or automatically restrict a device because of a finance payment."
        )
        Spacer(Modifier.height(12.dp))
        Text(
            "Fully managed provisioning is intended for a new or factory-reset device. " +
                "Review the setup before continuing."
        )
        Spacer(Modifier.height(24.dp))
        Button(onClick = onAccept, modifier = Modifier.fillMaxWidth()) {
            Text("I understand — continue")
        }
        TextButton(onClick = onCancel, modifier = Modifier.fillMaxWidth()) {
            Text("Cancel setup")
        }
    }
}
