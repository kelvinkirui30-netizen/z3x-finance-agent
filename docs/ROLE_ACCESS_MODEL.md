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

The portal now includes role-aware navigation, a normal-user self-service view, staff/user account listings, and a trusted Firebase Admin SDK endpoint for account listing and Super Admin-only role changes. The endpoint writes role-change events through the Admin SDK to the audit log.

The web build passed in GitHub Actions for commit 427fba99b5116048f9967d553ed4c8e0f3d87f65. Vercel deployment and live Firebase integration still need confirmation. Firestore rules remain a separate deployment: a GitHub commit does not publish them to Firebase. Test the rules in the Firebase Emulator or Rules Playground before deploying. The personal dashboard expects records to carry ownerUid matching the authenticated Firebase UID. Finance data remains display-only; no payments are initiated by the portal.

Only the Super Admin can change staff roles. Normal users are restricted to queries for their own devices and finance records. Staff role changes are made server-side and require the caller's verified Super Admin custom claim.
