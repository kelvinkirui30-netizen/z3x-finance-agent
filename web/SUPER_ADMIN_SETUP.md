# First Super Admin activation (Vercel)

This is a one-time bootstrap for the verified Firebase account `shadowvybez001@gmail.com` in project `device-owner-manager`.

## Before starting

- Confirm the owner can sign in to the deployed portal with Google using the exact approved email.
- The Vercel project Root Directory must be `web`.
- The `web/api/bootstrap-super-admin.js` function must be deployed with the latest GitHub commit.
- Do not put a service-account key in GitHub, a `VITE_*` variable, browser code, or chat.

## Add private Vercel environment variables

In Vercel → project `z3x-finance-agent` → Settings → Environment Variables, add:

1. `FIREBASE_SERVICE_ACCOUNT_JSON`
   - Value: the complete contents of a newly generated Firebase Admin SDK service-account JSON file for project `device-owner-manager`.
   - Keep it server-only. Do not prefix it with `VITE_`.
2. `SUPER_ADMIN_BOOTSTRAP_SECRET`
   - Value: a unique random secret with at least 32 characters, generated and stored privately by the project owner.
   - Do not reuse a password from another service.

Apply both to Production (and Preview only if intentionally testing there). Save, then redeploy the Vercel project so the server function receives the variables.

## Activate

1. Open the deployed portal and sign in with Google as `shadowvybez001@gmail.com`.
2. The first-owner activation panel should appear.
3. Enter the exact `SUPER_ADMIN_BOOTSTRAP_SECRET` value and choose Activate Super Admin.
4. On success, sign out and sign in again so Firebase refreshes the custom-claim token.
5. Verify the portal recognizes the `super_admin` role.

## Safety and recovery

- The server verifies the Firebase ID token, exact email, and verified-email flag.
- The endpoint accepts only POST requests and checks the secret server-side.
- A Firestore transaction creates `_system/superAdminBootstrap` as a one-time lock before setting the custom claim. A second activation attempt is rejected.
- If activation fails after the lock is created, do not delete or edit the lock casually. Review Vercel function logs and Firebase Auth state, then perform a controlled recovery with an authorized project owner.
- Never send the JSON key or activation secret to anyone. If the service-account key is exposed, revoke it in Google Cloud IAM and generate a replacement.
