# First Super Admin activation

This endpoint is intended only for the first owner account, `shadowvybez001@gmail.com`.

## Required Vercel environment variables

Set both variables for Production (and Preview only if you intentionally test there):

- `FIREBASE_SERVICE_ACCOUNT_JSON`: the complete JSON contents of a Firebase service-account key for project `device-owner-manager`. Keep it private. Never add it to GitHub, browser variables, Android resources, or chat.
- `SUPER_ADMIN_BOOTSTRAP_SECRET`: a randomly generated secret of at least 32 characters. Store it only in Vercel.

After setting both variables, redeploy so the function receives them.

## Important

- The endpoint verifies a Firebase ID token, verified email, exact approved email, and project ID.
- It refuses to run if a different Super Admin already exists.
- After successful activation, remove `SUPER_ADMIN_BOOTSTRAP_SECRET` from Vercel and redeploy. Keep the service credential only if later trusted server features need it.
- Never expose either value to the browser or prefix them with `VITE_`.
- This endpoint only assigns the first Super Admin claim. It does not yet implement the staff role-management interface.
