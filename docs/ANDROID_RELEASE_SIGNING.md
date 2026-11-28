# Android release signing

Z3X Finance Agent uses a long-lived Android release signing key. Keep the keystore
file and all passwords private. Never commit the keystore, passwords, or an
unencoded copy of the key to this repository.

## 1. Generate the keystore once

On a trusted computer with JDK 17 or newer, run:

```bash
keytool -genkeypair -v \
  -keystore z3x-finance-agent-release.jks \
  -alias z3x-release \
  -keyalg RSA -keysize 2048 -validity 10000
```

Choose strong, unique passwords and store them in a password manager. Do not
send them in chat or commit them. Keep at least two secure offline backups of
the `.jks` file. Losing this key can prevent future APKs from updating existing
installations.

## 2. Encode the keystore for GitHub Actions

Linux:
```bash
base64 -w 0 z3x-finance-agent-release.jks
```

macOS:
```bash
base64 < z3x-finance-agent-release.jks | tr -d '\\n'
```

Copy the resulting one-line Base64 value directly into a GitHub Actions
repository secret. Base64 is only transport encoding, not encryption; the
GitHub secret is the protected storage location.

## 3. Add repository Actions secrets

In GitHub, open Settings -> Secrets and variables -> Actions -> New repository
secret. Add these four secrets exactly:

- `Z3X_UPLOAD_KEYSTORE_BASE64`: Base64 output from step 2
- `Z3X_UPLOAD_KEYSTORE_PASSWORD`: keystore password
- `Z3X_UPLOAD_KEY_ALIAS`: `z3x-release`
- `Z3X_UPLOAD_KEY_PASSWORD`: password for the key alias

Never put any of these values in source files, workflow YAML literals, issues,
or chat messages. Restrict repository access and enable two-factor
authentication on the GitHub account.

## 4. Build and verify

After all four secrets are present, push to `main` or run the Android APK
workflow manually. The workflow continues to build the debug APK and additionally
builds a signed release APK. It verifies the APK signature and uploads a separate
artifact named `z3x-finance-agent-signed-release-apk`.

The current debug APKs were signed with temporary debug keys. They are not
compatible as update installs with the new release-signed APK; uninstall the
debug build before installing the first release-signed APK. Future release APKs
must use this exact same keystore and alias.

## 5. Future versions

Increase `versionCode` for every published update. Keep `applicationId`
(`com.dom.manager`) and the signing key unchanged. Do not rotate or recreate
the keystore for routine updates. Record the certificate SHA-256 fingerprint
from the workflow's `apksigner` verification output and compare it for later
releases.
