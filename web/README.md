# Z3X Finance Agent Web Migration Workspace

This directory is the migration boundary for the original Sentinel/Z3X TanStack Start website. The Android project remains in the repository root under `app/`.

## Source import status

The original archive has been inspected, but its website source has not yet been copied into this directory. Do not treat this folder as a complete website or deploy it yet.

The source archive contains 127 files and uses TanStack Start, React 19, and Supabase. Its `.env` file is intentionally excluded from GitHub. Supabase test records will not be migrated.

## Firebase client setup

The Firebase browser client is in `src/lib/firebase.ts`. Set the `VITE_FIREBASE_*` variables from the Firebase Web app configuration in your local web environment. These are public client configuration values, not service-account credentials.

Never put Firebase Admin SDK credentials, service-account JSON, passwords, or private tokens in browser code or this directory.

## Migration sequence

1. Import the original website source here, excluding `.env`, local secrets, build output, and dependency folders.
2. Preserve the existing dashboard routes and visual design.
3. Replace Supabase auth/session handling with Firebase Authentication.
4. Replace Supabase data access with Firestore and trusted server operations.
5. Validate Firestore rules and role provisioning before enabling staff/admin workflows.
6. Run type checks, lint, and production build before deployment.

Remote wipe, forced password reset, finance-triggered device restrictions, covert location tracking, and similar destructive/coercive actions are not part of this migration. Device enrollment and status reporting must be transparent and authorized.
