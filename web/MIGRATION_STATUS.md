# Website migration inventory

Reviewed from the user-provided `hello-world-project-main.zip` on 2026-11-26.

## Source layout

- 73 files under the original website `src/` directory.
- 26 files under the original `android/` directory.
- Website stack: TanStack Start, TanStack Router, React 19, TypeScript.
- Original data/auth dependency: Supabase JS.
- The original archive also contains a root `.env`; it must not be copied into GitHub.

## Important website routes

- `src/routes/auth.tsx` — sign-in route.
- `src/routes/reset-password.tsx` — password reset route.
- `src/routes/_authenticated/route.tsx` — authenticated application shell.
- `src/routes/_authenticated/devices/index.tsx` — device inventory.
- `src/routes/_authenticated/devices/$deviceId.tsx` — device details.
- `src/routes/api/public/device/enroll.ts` — device enrollment API.
- `src/routes/api/public/device/sync.ts` — device sync API.

## Supabase integration surface

The original website has Supabase-specific modules under `src/integrations/supabase/`:

- `client.ts`
- `client.server.ts`
- `types.ts`
- `auth-middleware.ts`
- `auth-attacher.ts`
- `previewAuthStorage.ts`

The authenticated routes and public enrollment/sync APIs also depend on Supabase. Replacing only the browser client would therefore leave server routes and session handling broken.

## Migration rules

1. Preserve the existing route structure and UI where practical.
2. Replace client auth with Firebase Authentication.
3. Replace database access with Firestore, using user ownership checks and trusted server-side role provisioning.
4. Do not migrate Supabase test records.
5. Do not copy `.env`, Supabase keys, or any private credentials into GitHub.
6. Keep Firebase Admin credentials server-side only; never put them in the web client or Android APK.
7. Do not port remote wipe, forced password resets, finance-triggered device restrictions, or covert tracking. Keep device enrollment/status reporting transparent and authorized.

## Status

- [x] Original archive inspected.
- [x] Firebase web client configuration scaffold added under `web/src/lib/firebase.ts`.
- [x] Public Firebase web config template added at `web/.env.example`.
- [ ] Original 73-file website source imported into `web/`.
- [ ] Supabase authentication and database calls replaced.
- [ ] Firebase Auth and Firestore integration tested.
- [ ] Production website build validated.

This repository does not yet contain a migrated or deployable website. The scaffold is a starting point only.
