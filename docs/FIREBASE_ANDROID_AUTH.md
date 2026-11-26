# Android Firebase authentication

The Android app now includes email/password account creation and sign-in using Firebase Authentication. After successful authentication it creates a minimal `users/{uid}` profile and subscribes to the signed-in user's device records.

## Firebase Console setup

1. Open Firebase project `device-owner-manager`.
2. Go to **Authentication → Sign-in method**.
3. Enable **Email/Password** (the standard Email/Password provider, not email-link sign-in).
4. Save the change.

The Android starter currently uses email/password. Google sign-in remains available in the Firebase project for the web client, but Android Google sign-in needs an Android OAuth client configured with the app's signing SHA fingerprints and a generated `default_web_client_id`; the current `google-services.json` does not yet contain OAuth client entries.

## Data and security behavior

- Firebase Authentication owns the account identity.
- The app creates only `displayName`, `email`, `createdAt`, and `updatedAt` in `users/{uid}`.
- The device list query filters by `ownerUid == currentUser.uid`; Firestore rules still enforce ownership.
- The Android client does not write device identity, enrollment secrets, check-in timestamps, battery status, commands, audit logs, or location records.
- Device registration and live check-ins require a trusted HTTPS endpoint or another verified server process. Do not loosen Firestore rules to allow arbitrary client writes to device records.

## Test

1. Install the debug APK built by GitHub Actions.
2. Create a test account with an email address and password of at least six characters.
3. Confirm that a `users/{uid}` profile appears in Firestore.
4. Sign out and sign back in.
5. Confirm that the dashboard shows an empty device list until a device has been enrolled through the trusted enrollment service.

A GitHub build does not deploy Firestore rules or change Firebase Authentication providers; those steps are performed in Firebase Console or through an authenticated deployment process.
