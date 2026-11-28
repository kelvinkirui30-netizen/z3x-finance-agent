# Z3X Finance Agent — Firebase foundation

Firebase project: `device-owner-manager`

This is the proposed Firestore contract for the website, Android app and management portal. Supabase test records are intentionally not migrated.

## Identity and roles

Firebase Authentication is the identity provider. Trusted server code assigns the custom ID token claim `role` with one of `super_admin`, `admin`, `assistant`, or `user`. Missing role means `user`. Only trusted server code assigns roles.

## Company-owned device model

### `devices/{deviceId}`

The company inventory record is authoritative. Important fields:

- `ownerUid`: staff account responsible for the company inventory/device-agent provisioning identity; this is not the customer.
- `assignedCustomerUid`, `assignedCustomerEmail`: customer account receiving the device under a finance agreement.
- `assignmentStatus`: `unassigned`, `active`, `return_pending`, or `released`.
- `assignedAt`, `assignedByUid`: assignment audit metadata.
- `displayName`, `manufacturer`, `model`, `androidVersion`, `appVersion`, `managementMode`, `managementCapabilities`.
- `enrollmentStatus`, `enrolledAt`, `lastSeenAt`, `batteryLevel`, `appliedPolicyVersion`.

A customer account is a beneficiary of an assignment, not the owner of the company inventory record. Customer account APIs query `assignedCustomerUid`; staff inventory APIs query `ownerUid`. Customers cannot generate provisioning codes or unlink, transfer, or release a company device.

The current Android agent still uses staff-authenticated enrollment/check-in. A separate device-scoped credential migration is required before a customer can sign in to the app on the same handset without taking over the device's provisioning identity. Do not reuse a customer's Firebase ID token as the company device credential.

### `enrollment_codes/{codeHash}`

Server-only, one-time provisioning records. Store a hash of the code, expiry, staff `ownerUid`, creator and purpose `company_device_provisioning`. Plaintext is returned once. Only Admin/Super Admin can create or revoke codes; normal users cannot.

### `device_installments/{installmentId}`

Finance schedule fields: `deviceId`, `ownerUid` (staff/company record owner), `customerUid` (assigned customer), `label`, `amountMinor` (integer minor currency units), `currencyCode`, `dueDate`, `notes`, timestamps.

### `device_installment_payments/{paymentId}`

Append-only payment records: `installmentId`, `ownerUid`, `customerUid`, `amountMinor`, `currencyCode`, `paidAt`, `reference`, `notes`, timestamps.

### `device_release_approvals/{approvalId}`

Reserved for the forthcoming release workflow. A release must require a settled finance agreement, a separate authorized approval, a server-side decision record and a device-scoped release authorization. The direct unlink endpoint is disabled until this workflow is implemented.

## Other collections

### `users/{uid}`
Profile fields such as `displayName`, `email`, `createdAt`, and `updatedAt`. Authorization comes from verified token claims, not editable profile fields.

### `device_policies/{deviceId}`
Policy configuration and version metadata. Changes are staff-restricted and must be checked against actual Android API and management-mode support.

### `device_commands/{commandId}`
Audited, short-lived command queue. Current allowlist is limited to non-destructive operations such as `request_check_in`, `refresh_policy`, and `display_notice`. Do not add covert tracking, credential extraction, remote wipe, or finance-triggered phone restrictions.

### `audit_logs/{logId}`
Server-written audit events. Never log passwords, raw provisioning codes, device credentials or private signing keys.

## Security model

- Device enrollment and check-in are mediated by trusted HTTPS APIs.
- The Android app never contains Firebase Admin credentials or server signing keys.
- Device inventory and assignment are server-managed; clients cannot write owner or assignment fields.
- Customer account data is read by `assignedCustomerUid`; staff inventory is read by `ownerUid`.
- Direct device unlink is disabled. A later release workflow must require settled finance and an independent approval.
- Commands must be device-scoped, authenticated, short-lived, replay-resistant and auditable.
- Apply App Check where compatible, validate every request, rate-limit provisioning, and rotate/revoke device credentials when a device is formally released.

## Deploying rules and indexes

The repository is configured for project `device-owner-manager`. Firestore rules remain a separate deployment step and must be tested and reviewed before production deployment.
