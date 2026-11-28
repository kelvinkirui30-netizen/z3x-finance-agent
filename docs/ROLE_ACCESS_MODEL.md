# Z3X Finance Agent — four-role access model

## Roles

| Role | Authority |
|---|---|
| `super_admin` | Sole authority to promote/demote staff, assign Admin/Assistant roles and manage system-wide settings |
| `admin` | Manage authorized company devices, assign customers, manage permitted finance records and support workflows |
| `assistant` | Limited support access; no staff-role management, device assignment, unlinking or privileged finance writes |
| `user` | Customer self-service: own profile, devices assigned to their account and own finance records |

A missing role claim is always treated as a normal customer account.

## Company device ownership and assignment

- Company device inventory remains owned by the Z3X organization; the device record's `ownerUid` identifies its staff provisioning owner, not its financed customer.
- Only Admin/Super Admin can create company-device provisioning codes.
- Only Admin/Super Admin can assign an already-enrolled company device to an existing normal customer account by verified Firebase email.
- A customer cannot assign, transfer, unlink or release a device.
- An active assignment cannot be overwritten. It must pass a future return/release workflow first.
- Customer account data is queried by `assignedCustomerUid`; staff inventory is queried by `ownerUid`.
- The Android agent's current check-in identity remains staff-authenticated. Device-scoped credentials are a separate required migration before customer app sign-in is enabled on a financed handset.

## Release and unlink

The old direct unlink operation is disabled. The forthcoming release process must verify a fully settled finance agreement, obtain an independent authorized approval, create an immutable audit event, and issue a short-lived device-specific release authorization. No customer account can trigger release.

## Role assignment and approval

- Sign-in establishes identity only; it does not grant staff role.
- Only trusted server code sets custom role claims.
- Only Super Admin can promote/demote Admin and Assistant.
- All privileged changes require server-side authorization and audit events.
