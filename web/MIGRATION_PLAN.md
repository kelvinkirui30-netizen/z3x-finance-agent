# Website-to-Firebase migration plan

## Source inventory
The supplied archive contains a TanStack Start + React 19 website with:
- Auth and password-reset routes
- Authenticated device list and device-detail routes
- Public Android enrollment and sync endpoints
- A policy model in `src/lib/policy.ts`
- Supabase browser, server-admin, and bearer-token middleware integrations

The original website source is to be imported under `web/`. The archive's `.env`, any credentials, and the old Android project are excluded from this website import. The existing root Android starter remains the active Android build.

## Target architecture
- Firebase Authentication for Google and email/password sign-in.
- Firebase Web SDK in browser code for sign-in and user-scoped reads.
- Firebase Admin SDK only in trusted TanStack Start server handlers.
- Firestore as the sole application database.
- Verify Firebase ID tokens on every authenticated server request; derive UID and role from verified token claims, never from client-submitted role fields.
- Keep service-account credentials in deployment secret storage only. Never commit them or put them in browser or Android configuration.

## Migration sequence
1. Import the original website source into `web/`, excluding `.env`, secrets, generated build output, and the old Android source.
2. Replace the Supabase browser client and auth-attacher with Firebase Auth session handling.
3. Replace Supabase server middleware with Firebase Admin ID-token verification.
4. Port device list/detail reads and edits to Firestore, matching the committed Firestore schema and security rules.
5. Port enrollment and check-in endpoints to trusted server-side Firestore transactions. Validate enrollment codes, bind a code once, and authenticate subsequent check-ins with a per-device credential.
6. Port finance schedules and payment records with owner-scoped access and staff roles.
7. Run typecheck, lint, production build, and route/API tests before deployment.

## Safety and authorization boundaries
- No remote factory reset/wipe, remote password reset, covert location collection, or finance-triggered device restriction.
- Device actions are limited to transparent, non-destructive check-in and policy-refresh requests and visible notices, subject to the device owner's authorization.
- Location is optional, disclosed, permission-based, and recorded only when the user explicitly enables sharing.
- Finance records do not trigger device controls.

## Current status
This document records the reviewed source inventory and implementation sequence. It does not claim that the original source has been imported or that the migration is complete.
