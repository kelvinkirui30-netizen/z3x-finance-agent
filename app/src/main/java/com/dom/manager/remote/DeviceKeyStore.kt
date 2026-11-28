package com.dom.manager.remote

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature

object DeviceKeyStore {
    private fun alias(installId: String) = "z3x_device_" + installId.replace("-", "")

    fun getOrCreate(installId: String): KeyPair {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val name = alias(installId)
        val existing = store.getEntry(name, null) as? KeyStore.PrivateKeyEntry
        if (existing != null) return KeyPair(existing.certificate.publicKey, existing.privateKey)

        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
        generator.initialize(
            KeyGenParameterSpec.Builder(
                name,
                KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
            )
                .setAlgorithmParameterSpec(java.security.spec.ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(false)
                .build()
        )
        return generator.generateKeyPair()
    }

    fun publicKeyPem(installId: String): String {
        val encoded = getOrCreate(installId).public.encoded
        val body = Base64.encodeToString(encoded, Base64.NO_WRAP)
        return "-----BEGIN PUBLIC KEY-----\n" + body.chunked(64).joinToString("\n") + "\n-----END PUBLIC KEY-----"
    }

    fun sign(installId: String, message: ByteArray): String {
        val key = getOrCreate(installId)
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(key.private)
        signer.update(message)
        return Base64.encodeToString(signer.sign(), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    }

    fun hasKey(installId: String): Boolean {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return store.containsAlias(alias(installId))
    }
}
