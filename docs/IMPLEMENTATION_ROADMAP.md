# Z3X Finance Agent — complete implementation roadmap

## Product objective

Build one Firebase-backed system with three coordinated deliverables:

1. **Android Agent** — transparent device enrollment, accurate device inventory, device health, supported recovery, integrity reporting and consent-based management.
2. **Web Portal** — four-role administration, user self-service, enrollment, device inventory, finance records, command review, audit and health dashboards.
3. **Firebase Backend** — identity, authorization, trusted APIs, enrollment, device check-ins, policy/command delivery, audit events and synchronization.

Firebase project: `device-owner-manager`. Android application ID: `com.dom.manager`. Web deployment: Vercel project rooted at `web/`.

## Non-negotiable engineering and safety rules

- Firebase Authentication identifies accounts; trusted server code assigns staff roles through custom claims.
- Exactly four roles: `super_admin`, `admin`, `assistant`, and ordinary `user`. Only Super Admin can promote/demote Admin and Assistant.
- A device is enrolled only after the person holding the device enters a short-lived, single-use code and explicitly confirms the account/device pairing.
- Never collect IMEI or serial by default. They are restricted identifiers and are unavailable to ordinary apps on many Android versions. Use an app-generated installation ID and Android-supported identifiers; report unavailable fields honestly.
- Report actual management mode and capabilities. Never label Standard Access as Device Owner.
- Self-healing means recovery of the app's own supported services, configuration and scheduled work. It must not secretly reinstall the app, bypass Android security, conceal itself, or defeat a device owner's control.
- Device Owner-only capabilities are enabled only after supported Android provisioning and a runtime capability check.
- Fully managed provisioning requires a device that Android permits to be provisioned (typically new or factory-reset); setup is explicit and can fail/reset the device if system prerequisites are not met.
- No finance event may automatically trigger a device restriction. Finance records are separate from device-management authorization.
- Commands are authenticated, scoped to one enrolled device, short-lived, replay-resistant, audited and visible to the authorized device user. Provide a safe recovery path.
- No remote wipe, covert tracking, credential extraction, hidden persistence, or security-control bypass.
- Keep Firebase Admin credentials only in trusted server environment variables. Never put them in GitHub, browser bundles, Android assets or chat.

## Delivery phases and acceptance criteria

### Phase 0 — Repository and environment audit
**Status: Repository review completed; build verification pending**

- Inspect Android app, web portal, API routes, Firebase schema/rules, build workflows and Vercel settings assumptions.
- Identify incomplete, duplicated or unsafe code and establish a clean build baseline.
- Confirm the Android build workflow and harden the existing separate Vite web build workflow.
- Document deployment steps and secrets required without exposing secret values.

**Audit findings:** Android has a starter Firebase email/password flow and basic local device status only. The portal has a partial role-aware scaffold and a Firebase Admin SDK account endpoint. Enrollment, check-in, health recovery, tamper reporting, signed commands and complete finance workflows are not implemented. Firestore rules are draft-only and have not been deployed. Separate Android and web CI workflows are present; the web workflow now has read-only repository permissions and Node 22. No build result is claimed from this source inspection.

**Exit criteria:** reproducible Android and web builds; documented current state; no credentials committed.

### Phase 1 — Identity, roles and backend security
**Status: Core role hardening committed; Firestore Emulator role/ownership suite passing; remaining API controls pending**
- Complete server-side authentication middleware for every privileged API.
- Enforce role matrix consistently in APIs, portal navigation and Firestore rules.
- [x] Add paginated account listing, Super Admin-only role/status changes, audit events and protected Super Admin accounts.
- [x] Restrict the full account directory to Admin and Super Admin; Assistant cannot browse all accounts.
- [x] Restrict finance record reads to Admin/Super Admin and owner; validate profile display-name writes and policy document IDs.
- [x] Restrict device-location reads to Admin/Super Admin and the device owner; assistants cannot browse location history.
- [x] Make account changes single-operation and append requested/completed/failed audit events; clients cannot modify audit records.
- [ ] Verify audit event immutability, endpoint failure handling and role transitions with automated tests.
- [ ] Add Firebase App Check where compatible, rate limits, and deployment-level request protections; validate API input and generic client errors.
- [x] Add Firestore Emulator test coverage and a dedicated GitHub Actions workflow for role and cross-account access scenarios.
- [x] Firestore Emulator test workflow passes on commit `27a547cc55580c367ba8ebab57e57c2779c93a0d`.
- [ ] Review bootstrap endpoint for atomicity, one-time use and recovery if claim assignment fails.
- [x] Add Super Admin-only enable/disable controls to the portal account directory; the API protects the acting account and Super Admin accounts.

**Exit criteria:** role tests pass; no client can grant itself a role or write server-owned records. Current work is partial and is not yet ready for Firestore production deployment.

### Phase 2 — Company device provisioning and customer assignment
**Status: Ownership-model redesign started; staff-only provisioning and customer assignment APIs committed; CI verification pending**

- [x] Change provisioning-code creation to Admin/Super Admin only. Codes are for company-device provisioning and remain single-use, hashed at rest and short-lived.
- [x] Add a server-authorized assignment API that resolves an existing Firebase customer account by email and assigns an enrolled company device to that customer's UID.
- [x] Preserve the distinction between company inventory owner (`ownerUid`) and financed customer (`assignedCustomerUid`).
- [x] Customer account API now returns only devices assigned to that customer; staff inventory continues to use the staff inventory owner.
- [x] Prevent reassignment while a device has an active customer assignment.
- [x] Disable direct device unlinking. The former self-service unlink path is closed while the independent finance-settlement and release-approval workflow is built.
- [x] Remove customer self-service provisioning-code generation and unlink controls from the portal; add staff device-assignment UI.
- [ ] Complete CI verification for the new assignment API and role tests; an initial test attempt exposed unsupported Auth Emulator REST custom-claim setup, and the test harness has been changed to use Firebase Admin SDK from the web API dependencies.
- [ ] Add device-scoped credentials so the handset can continue its company check-in identity while the customer signs into their own account.
- [ ] Add admin-only initial device provisioning, credential rotation, reinstall recovery for assigned customers, and device credential revocation on approved release.
- [ ] Add the independent release workflow: finance settlement verification, request record, second-person approval, short-lived server authorization, device acknowledgement and immutable audit.
- [ ] Validate enrollment, assignment, customer visibility, unauthorized access, reinstall recovery and release on a real test device.

**Exit criteria:** customers can only view their assigned devices and finance records; only staff can provision/assign; no customer can unlink or transfer a company device; device-agent authentication is independent of the customer's app login; release requires settled finance and independent approval.

### Phase 3 — Device identity, inventory and capability discovery
**Status: Android capability reporting, periodic telemetry and owner-only finance display implemented; portal presentation and real-device verification pending**
- [x] Enrollment reports manufacturer, model, Android release/API, app version, app-generated installation ID and actual management mode (including Device Admin).
- [x] Capture battery percentage and charging state through Android's BatteryManager when available.
- [x] Show the enrolled device's reported model, Android version, management mode, battery and last-seen time in the personal portal.
- [x] Refresh device telemetry through authenticated periodic check-ins when network connectivity is available.
- Collect manufacturer, model, Android release/API, app version, app-generated installation ID, device display name where available, battery/charging state where permitted, and last check-in.
- Report access mode: Standard, Device Admin (legacy), Profile Owner, or Device Owner; do not conflate these.
- Build a capability matrix from Android version, provisioning state, permissions and actual API checks.
- Show restricted identifiers as unavailable/not collected unless there is a documented, lawful, platform-authorized reason.
- Add device details, last-seen freshness, app version and enrollment status to portal.

**Exit criteria:** portal values come from device check-ins, not manual device-detail entry; unsupported fields are marked unavailable.

### Phase 4 — Android reliability and self-healing
**Status: WorkManager recovery, boot/app-update rescheduling, manual sync and local health status implemented; real-device recovery tests pending**
- Add a health model for app process/service status, last successful sync, scheduled work, permission state and policy/config version.
- [x] Use Android-supported WorkManager jobs for network-constrained device check-ins and synchronization.
- [x] Use Android-supported WorkManager for network-constrained periodic check-ins and immediate post-enrollment synchronization.
- [x] Recover transient failures with WorkManager retry behavior and clear local enrollment state when the server authoritatively rejects ownership/enrollment.
- [ ] Restore the app's own validated configuration from trusted server state; keep safe local defaults if offline.
- [x] On boot and app replacement, restore eligible check-in work only when the same enrolled account is signed in.
- [x] Detect observable management-mode, app-version and capability changes and record minimal audit events.
- [x] Recheck state after legacy Device Admin enable/disable callbacks.
- [ ] Add a dedicated recovery screen with actionable instructions for actions only a user/admin can complete.
- Do not promise recovery after uninstall, factory reset, OS restriction or loss of required privileges.

**Exit criteria:** tests demonstrate recovery from process death, reboot, temporary network loss and corrupted local cache without bypassing Android protections.

### Phase 5 — Tamper and integrity monitoring
- [x] Record management-mode, agent-version and capability changes during authenticated check-in as audit events.
- [x] Validate capability keys/types and reject contradictory management-mode reports.
- [ ] Add signed device reports or short-lived server-issued credentials for stronger device attestation; current capability reports remain device-reported telemetry, not cryptographic proof.
- [x] Keep event data minimal and avoid collecting unrelated personal content.
- [ ] Add a dedicated staff integrity-alert view and offline event batching.
- Distinguish confirmed events from signals that are only suspicious.

**Exit criteria:** tamper events are auditable, rate-limited, privacy-minimized and accurately classified.

### Phase 6 — Secure command and policy framework
- [x] Establish a typed server command allowlist, per-device targeting, unique IDs, expiry, delivery lease, one-time nonce verification, status lifecycle and result reporting.
- [x] Use trusted Firebase Admin server APIs and authenticated HTTPS; no server secret is embedded in the APK. Stronger asymmetric device attestation remains pending.
- [x] Implement safe operations: request check-in and display a visible notice in the app.
- [ ] Add open-recovery-guidance command and staff command review/cancellation UI.
- [x] Restrict command issuance to Admin/Super Admin and verify the enrolled device owner at delivery and acknowledgement.
- [x] Do not permit finance events to generate device-control commands.
- [x] Expire commands, reject replayed/wrong-device acknowledgements, and append command issuance/result audit events.

**Exit criteria:** invalid, expired, replayed, wrong-device and unauthorized commands are rejected; supported commands produce verifiable results.

### Phase 7 — Web portal completion
- Super Admin dashboard and system settings.
- Staff management: Admin/Assistant assignment, disable/enable and audit.
- [x] User management: Super Admin account enable/disable controls and own-device view.
- [ ] Complete profile editing and account recovery flows.
- Device management: enrollment-code generation/revocation, inventory, capability/health view and approved safe commands.
- Audit logs: filters by actor, device, event, outcome and date.
- Health dashboard: stale devices, app versions, recovery events and integrity alerts.
- Normal User dashboard: own profile, enrolled devices, enrollment status and own finance records only.
- Responsive layout, accessible states, loading/error/empty states and pagination.

**Exit criteria:** each role sees only permitted areas and data; all key actions are audited.

### Phase 8 — Finance records and reconciliation
- Define currency-safe integer minor-unit amounts, schedules, payments, references and review history.
- Add Admin-authorized creation/update flows and append-only payment history.
- Normal users see only their own records; assistants have support-only access as approved.
- Add validation, duplicate reference checks, reconciliation status and audit history.
- Finance records remain informational/administrative and do not automatically control device access.

**Exit criteria:** totals reconcile, ownership rules pass and payment records cannot be silently overwritten.

### Phase 9 — Testing, deployment and release
- Android unit/instrumentation tests for device status, enrollment, local persistence, health checks and command validation.
- Firebase Emulator tests for Firestore rules and trusted API authorization.
- Web unit/build checks and end-to-end role scenarios.
- CI builds debug APK on pull request and release APK/AAB only from approved release workflow.
- Verify Vercel production deployment, environment variable names, Firebase project binding and Firestore rules deployment separately.
- Produce release notes, setup guide, recovery guide, privacy/data inventory and rollback plan.

**Exit criteria:** all critical tests pass; production configuration is verified; a test device completes enrollment, check-in, recovery and authorized safe-command flows.

## Initial feature inventory

| Area | Current repository evidence | Remaining work |
|---|---|---|
| Android authentication | Firebase email/password registration, sign-in and password reset; owner-only device link restoration after reinstall | Email verification policy and account lifecycle review |
| Device status | Ongoing check-in reports management mode, runtime capability flags, battery/charging, app version and API level | Real-device verification and staff health presentation |
| Device enrollment | One-time code, explicit confirmation, atomic redemption, owner-only restoration after reinstall and server-enforced unlink | Real-device verification, factory-reset behavior and signing-key continuity |
| Device check-in | Owner-verified API and 15-minute minimum periodic WorkManager check-in implemented | Real-device verification, offline queue validation and health model |
| Self-healing | WorkManager check-ins, boot/app-update rescheduling, manual sync and local recovery status | Real-device reboot/offline/process-death acceptance |
| Tamper monitoring | Audit events for management-mode, app-version and capability changes | Stronger device attestation, offline event queue and staff alerts |
| Device commands | Admin APIs issue only check-in requests and visible notices; delivery uses short leases and one-time nonce verification | Staff UI, recovery guidance command and stronger attestation |
| Portal role views | Partial scaffold exists | Audit and complete Phase 7 |
| Staff management API | Partial endpoint exists | Harden, paginate and test Phase 1 |
| Finance records | Android displays the signed-in user's own schedule and recorded payments read-only | Web finance entry/reconciliation workflows and end-to-end testing |
| Firestore rules | Draft exists in repository | Test and deploy only after review |
| CI | Firestore Emulator rules suite passes; latest Android and web builds are running for enrollment changes | Verify latest Android/web runs and add enrollment API tests |
| Vercel | Project deployed by owner | Verify latest deployment and server functions |

## Working method

Work in small, reviewable commits. For each phase:
1. Inspect the existing implementation before editing.
2. Implement one coherent slice.
3. Run the relevant build/tests.
4. Review security and role boundaries.
5. Update this roadmap with completed work and evidence.
6. Move to the next slice only after the acceptance criteria pass.

Do not mark a feature complete because its screen exists; mark it complete only when the backend, Android behavior, authorization and tests work together.


### Phase 3 — Cryptographic device identity
**Status: Initial server and Android Keystore implementation committed; CI and integration verification pending**

- [x] Generate a P-256 ECDSA signing key in Android Keystore; the private key is not exported.
- [x] Store the corresponding public key and SHA-256 fingerprint on the company device record during staff provisioning.
- [x] Add staff-only device-key registration/rotation with audit logging.
- [x] Add short-lived, one-time server challenges with per-device request throttling.
- [x] Verify signed device check-ins against the enrolled public key and consume each challenge atomically to prevent replay.
- [x] Remove the background check-in worker's dependency on a customer's Firebase login; keep local enrollment state and boot scheduling independent of customer sign-in.
- [ ] Confirm Android release/debug builds and cryptographic integration tests pass.
- [ ] Move safe device command fetch/acknowledgement to the same signed-device protocol; it currently remains on the legacy user-token path and is not invoked by the new worker.
- [ ] Add staff-assisted key rotation/recovery verification for reinstall, app-data reset and lost-key scenarios.
- [ ] Add server-side cleanup/TTL policy for expired challenge documents.
- [ ] Verify production Vercel deployment and test challenge/signature/replay behavior on an owned test handset.

**Security note:** Android Keystore protects the private key from normal app-level export, but hardware-backed storage is device-dependent. Uninstalling or clearing app data can make the existing key unavailable; a staff-authorized key rotation is required. A stable installation ID alone is never accepted as device authentication.
