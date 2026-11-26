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
**Status: Initial hardening committed; testing and remaining controls pending**
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
- [ ] Confirm the emulator test workflow passes; the first attempt exposed a Firebase SDK peer-version mismatch, which has been corrected in the latest dependency commit.
- [ ] Review bootstrap endpoint for atomicity, one-time use and recovery if claim assignment fails.

**Exit criteria:** role tests pass; no client can grant itself a role or write server-owned records. Current work is partial and is not yet ready for Firestore production deployment.

### Phase 2 — Device enrollment and ownership binding
- Portal generates cryptographically random, short-lived, single-use enrollment codes for a selected account.
- Store only a one-way verifier/hash of each code; never expose code documents to clients.
- Android app offers a clear enrollment screen for entering the code and displaying the account/device pairing for confirmation.
- Trusted API validates code, expiry, status, rate limits and authenticated device session; bind atomically to the intended owner UID.
- Prevent code reuse, cross-account reassignment, duplicate device binding and race conditions.
- Provide revoke, expire and unenroll flows with audit events.

**Exit criteria:** a device cannot become associated with an account without a valid code and explicit on-device confirmation.

### Phase 3 — Device identity, inventory and capability discovery
- Collect manufacturer, model, Android release/API, app version, app-generated installation ID, device display name where available, battery/charging state where permitted, and last check-in.
- Report access mode: Standard, Device Admin (legacy), Profile Owner, or Device Owner; do not conflate these.
- Build a capability matrix from Android version, provisioning state, permissions and actual API checks.
- Show restricted identifiers as unavailable/not collected unless there is a documented, lawful, platform-authorized reason.
- Add device details, last-seen freshness, app version and enrollment status to portal.

**Exit criteria:** portal values come from device check-ins, not manual device-detail entry; unsupported fields are marked unavailable.

### Phase 4 — Android reliability and self-healing
- Add a health model for app process/service status, last successful sync, scheduled work, permission state and policy/config version.
- Use Android-supported WorkManager jobs for deferrable health checks and synchronization.
- Recover transient failures with bounded retries, backoff, idempotent operations and crash-safe local state.
- Restore the app's own validated configuration from trusted server state; keep safe local defaults if offline.
- On boot, schedule eligible work and refresh status when Android permits.
- Detect app update, service interruption, revoked permissions, disabled admin status and changed management mode where observable.
- Add a recovery screen with actionable instructions for actions only a user/admin can complete.
- Do not promise recovery after uninstall, factory reset, OS restriction or loss of required privileges.

**Exit criteria:** tests demonstrate recovery from process death, reboot, temporary network loss and corrupted local cache without bypassing Android protections.

### Phase 5 — Tamper and integrity monitoring
- Define observable events: permission/admin-state changes, management-mode changes, app version mismatch, configuration drift, repeated failed authentication and device credential revocation.
- Sign device reports or use short-lived server-issued credentials; validate all reports server-side.
- Keep event data minimal and avoid collecting unrelated personal content.
- Queue events offline and upload securely when connectivity returns.
- Alert authorized staff and show a clear device-side status notice.
- Distinguish confirmed events from signals that are only suspicious.

**Exit criteria:** tamper events are auditable, rate-limited, privacy-minimized and accurately classified.

### Phase 6 — Secure command and policy framework
- Establish a typed command schema, per-device targeting, unique IDs, issue/expiry timestamps, nonce/replay protection, status lifecycle and result reporting.
- Use server-authorized command signing/verification with key rotation and no embedded server secret in the APK.
- Start with safe operations: request check-in, refresh policy, display notice and open recovery guidance.
- Require explicit policy authorization, device capability checks and clear user visibility for any future device restrictions.
- Do not permit finance events to generate device-control commands.
- Provide expiry, cancellation, duplicate rejection, offline behavior and command audit trails.

**Exit criteria:** invalid, expired, replayed, wrong-device and unauthorized commands are rejected; supported commands produce verifiable results.

### Phase 7 — Web portal completion
- Super Admin dashboard and system settings.
- Staff management: Admin/Assistant assignment, disable/enable and audit.
- User management: account status, profile and owned-device view.
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
| Android authentication | Email/password Firebase Auth screen exists | Confirm account policy, errors and profile rules |
| Device status | Manufacturer/model/Android/API and owner-mode check exists | Expand safe inventory and capability discovery |
| Device enrollment | Not implemented | Phase 2 |
| Device check-in | Not implemented end-to-end | Phases 2–4 |
| Self-healing | Not implemented | Phase 4 |
| Tamper monitoring | Not implemented | Phase 5 |
| Signed commands | Not implemented | Phase 6 |
| Portal role views | Partial scaffold exists | Audit and complete Phase 7 |
| Staff management API | Partial endpoint exists | Harden, paginate and test Phase 1 |
| Finance records | Rules/schema proposal exists; no complete workflows | Phase 8 |
| Firestore rules | Draft exists in repository | Test and deploy only after review |
| CI | Android and separate Vite web build workflows exist; web workflow hardened | Verify both workflow results and add rules/API tests |
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
