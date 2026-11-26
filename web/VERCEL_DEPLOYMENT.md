# Deploy the portal on Vercel

The website lives in this directory and is independent of the Android Gradle project at the repository root.

## Vercel project settings

- Git repository: `kelvinkirui30-netizen/z3x-finance-agent`
- Production branch: `main`
- Root Directory: `web`
- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

Vercel will redeploy automatically after commits are pushed to `main`.

## Environment variables

Add these in Vercel → Project Settings → Environment Variables. Use the values from `.env.example` in this directory:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

These are Firebase Web SDK client configuration values. Never add a Firebase service-account JSON, private key, or Admin SDK credential to Vercel's Vite/browser variables.

## Firebase Authentication

After the first Vercel deployment, copy the assigned Vercel domain and add it under Firebase Console → Authentication → Settings → Authorized domains.

The portal currently uses Google sign-in. A signed-in account must also have a trusted custom claim `role` set to `super_admin`, `admin`, or `assistant`. The browser cannot grant itself a role. If the claim is missing, access is denied by design.

## Current feature boundary

This first Vercel version provides staff sign-in and read-only Firestore dashboard views. Device enrollment/check-in endpoints and safe command delivery have not yet been implemented. The old Hatchable/Postgres test data is not imported. Existing Firestore rules remain the authority for data access.
