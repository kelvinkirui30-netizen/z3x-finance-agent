# Z3X Finance Agent — Firebase foundation

Firebase project: `device-owner-manager`

This is the proposed Firestore contract for the website, Android app and management portal. It is a new schema: the original Supabase test records are intentionally not migrated.

## Identity and roles

Firebase Authentication is the identity provider. Trusted server code assigns the custom ID token claim `role` with one of:

- `super_admin`
- `admin`
- `assistant`
- `user` (default when the claim is absent)

Never let a browser or Android client assign its own role. Do not trust a role string stored in a user-editable profile document. The first super-admin must be provisioned through a trusted Admin SDK environment after verifying the account owner.

## Collections

### `users/{uid}`

Profile fields: `displayName`, `email`, `createdAt`, `updatedAt`. Authorization comes from verified Firebase ID token claims, not profile fields.

### `devices/{deviceId}`

Server-managed device inventory. Proposed fields:

- `ownerUid`, `displayName`, `manufacturer`, `model`
- `androidVersion`, `appVersion`, `managementMode`, `managementCapabilities`
- `enrollmentStatus`, `enrolledAt`, `lastSeenAt`
- `batteryLevel`, `appliedPolicyVersion`, `createdAt`, `updatedAt`

Device credentials/secrets must never be stored in a document readable by browser clients. Store only a one-way verifier/hash or use a server-issued Firebase custom token flow. The Android app must not contain Admin SDK credentials.

### `enrollment_codes/{codeId}`

Server-only, one-time enrollment records. Store a hash of the code, expiry, intended owner, status, creation metadata and redemption metadata. Never expose raw enrollment codes through collection reads.

### `device_policies/{deviceId}`

Policy configuration and version metadata. Device and browser clients may read only when authorized. Changes are restricted to staff roles. Policy options must be checked against the Android management mode and actual Android API support before being offered in the console.

### `device_commands/{commandId}`

Audited, short-lived command queue. The initial client-queue allowlist is deliberately limited to non-destructive operations: `request_check_in`, `refresh_policy`, and `display_notice`. Device delivery/results are written by trusted server code. Do not add remote wipe, covert tracking, password extraction/reset, or finance-triggered lock commands to this queue.

### `device_installments/{installmentId}`

Finance schedule fields: `deviceId`, `ownerUid`, `label`, `amountMinor` (integer minor currency units), `currencyCode` (for example `KES`), `dueDate`, `notes`, `createdAt`, `updatedAt`.

### `device_installment_payments/{paymentId}`

Append-only payment records: `installmentId`, `ownerUid`, `amountMinor`, `currencyCode`, `paidAt`, `reference`, `notes`, `createdAt`. Use integer minor units, not floating-point currency values.

### `device_finance_actions/{actionId}`

Append-only finance review record: `deviceId`, `ownerUid`, optional `installmentId`, `type: "payment_review"`, `decision: "approved" | "declined"`, `reason`, `recordedBy`, `createdAt`. This records a human decision; it does not send device-control commands.

### `audit_logs/{logId}`

Server-written append-only events: actor UID and role, event type, target type/ID, timestamp, outcome and a minimal metadata map. Do not log passwords, raw enrollment codes, device secrets or private tokens.

### `device_locations/{locationId}`

Optional location history. Only implement when the device user has been clearly informed and has granted the required Android permissions. Read access is limited to the device owner and authorized staff; writes are server-mediated.

## Security model

- Browser and Android apps use Firebase client SDKs and Firebase Authentication.
- Device enrollment, check-in and command delivery are mediated by trusted HTTPS server endpoints. The Android app never receives a Firebase Admin key.
- Firestore rules deny direct client writes to device identity/status, enrollment codes, device check-ins, command delivery results, audit logs and location history.
- Admin access uses verified custom claims. A trusted Admin SDK process is required to set claims.
- The initial command allowlist excludes destructive device operations. Finance records never automatically cause device restrictions.
- Apply App Check where supported, validate every server request, rate-limit enrollment attempts, expire one-time codes, and rotate/revoke device credentials when a device is unenrolled.

## Deploying rules and indexes

The repository is configured for project `device-owner-manager` in `.firebaserc`.

After reviewing the project in Firebase Console and installing Firebase CLI in a trusted development environment, deploy with:

```bash
firebase use device-owner-manager
firebase deploy --only firestore:rules,firestore:indexes
```

A successful GitHub commit does **not** deploy rules to Firebase. Deployment requires an authenticated Firebase CLI session or a separately configured, tightly scoped CI identity.

## Important implementation notes

1. Confirm the Firebase project's Firestore database exists and choose its location before first production use; the location choice cannot be changed later.
2. The current Android starter has package ID `com.dom.manager`; the original Android project uses `com.sentinel.deviceowner`. Firebase Android app registration/package configuration must be checked before merging source.
3. The original web source contains Supabase client and server integrations. Replace those with Firebase Authentication and Firestore client/server modules; do not merely remove the dependency.
4. The original SQL migration references a pre-existing `devices` table not defined in that migration. The collection contract above is therefore a proposed new model, not a claim that the old schema is complete.
5. Firebase Cloud Functions deployment may require the Blaze billing plan. We should first determine the existing hosting runtime for the website's server endpoints and select the lowest-cost secure server option before deploying privileged APIs.
