# Z3X Finance Agent — four-role access model

## Roles

The portal has exactly four application roles, stored as Firebase Authentication custom claims:

| Role claim | Portal area | Authority |
|---|---|---|
| `super_admin` | Super Admin | Sole authority to promote/demote staff, assign Admin or Assistant roles, and manage system-wide settings |
| `admin` | Admin | Manage permitted user, device, policy and finance records; cannot change staff roles |
| `assistant` | Assistant | Support access; read authorized operational records; no staff-role management or privileged policy/command/finance writes |
| `user` | User | Self-service access to own profile, own devices and own finance records only |

A missing `role` claim is treated as a normal user. It must never be treated as staff.

## Role assignment and approval

- Google/Firebase sign-in establishes identity only; it does not grant a staff role.
- New accounts receive normal-user access by default.
- Only a trusted server process may set or change the custom `role` claim.
- Only the Super Admin may request Admin or Assistant promotion/demotion.
- The browser must never write a role claim or a trusted role field to Firestore.
- Role changes must be recorded in an append-only audit event by trusted server code.
- The first Super Admin must be bootstrapped out-of-band using Firebase Admin SDK after verifying the project owner's account UID. Do not put service-account keys in GitHub, Vercel browser variables, or chat.

## Firestore authorization

The rules in `firestore.rules` implement the base separation:
- Normal users can read their own records only.
- Staff can read operational records according to their role.
- Only Admin and Super Admin can perform the specified privileged policy, command-queue and finance-review writes.
- Assistants are read/support-only for those privileged collections.
- Only Super Admin can delete protected records.
- Device inventory, enrollment codes, device check-ins, audit logs and location writes remain server-managed.
- Client-queued device requests remain limited to non-destructive, user-visible operations.

## Implementation status

The portal has role-aware navigation, a normal-user self-service view, account/staff tables, and a Firebase Admin SDK endpoint for staff account operations.

Phase 1 hardening now includes:
- Server-verified Firebase ID tokens and custom role claims on the account API.
- Admin and Super Admin access to the paginated account directory; Assistants are denied access to the full directory.
- Super Admin-only role/status changes, protected Super Admin accounts, self-change prevention, input validation and audit event writes.
- Firestore rules restrict finance record reads to Admin/Super Admin and the record owner; profile display-name writes are constrained; policy document IDs must match their device IDs.

Important remaining work:
- Automated Firebase Emulator tests for all four roles and cross-account access.
- App Check/rate-limiting and complete API security review.
- Review and test bootstrap recovery and audit failure handling.
- Firestore rules have NOT been deployed to Firebase. Do not deploy production rules until tests pass and the project data model has been reviewed.
- A GitHub commit does not prove a Vercel production deployment or successful CI build. Confirm the dedicated Web Portal workflow and Android APK workflow separately.
- Finance data remains display-only; no payments are initiated by the portal.
