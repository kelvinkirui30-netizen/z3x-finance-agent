# Importing the original Sentinel project

The original project archive is the source of truth for the legacy website and Android feature inventory. Do not copy its Supabase data or environment secrets into the new application.

## One-time upload

1. Open the repository on GitHub: https://github.com/kelvinkirui30-netizen/z3x-finance-agent
2. On the **Code** tab, choose **Add file → Upload files**.
3. Upload the original archive `hello-world-project-main(1).zip` (or the same original ZIP with its original filename) to the repository root.
4. Commit the upload to `main`.
5. Open **Actions → Import original Sentinel source archive** and wait for it to finish.

The workflow extracts the archive into `legacy-source/`, removes the uploaded ZIP after extraction, and commits the imported source. It deliberately excludes environment files, private keys, build output, and nested GitHub workflow files. It does not deploy or run the legacy application.

## Migration policy

- Firebase project `device-owner-manager` is the only live backend.
- Supabase records are test data and are not migrated.
- Keep the imported source as a reference while porting the website and Android functionality into the maintained app.
- Review and replace Supabase client/auth/database calls with Firebase Auth, Firestore, and trusted server endpoints.
- Do not port destructive device actions, hidden location collection, or finance-triggered device restrictions.
- Preserve clear user notice, consent, Android permissions, and non-destructive device-management behavior.
