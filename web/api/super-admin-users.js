import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "device-owner-manager";
const ALLOWED_ROLES = new Set(["user", "admin", "assistant"]);

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}
function adminServices() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing Firebase Admin credential.");
  const account = JSON.parse(raw);
  if (account.project_id !== PROJECT_ID) throw new Error("Wrong Firebase project.");
  const app = getApps()[0] || initializeApp({ credential: cert(account), projectId: PROJECT_ID });
  return { auth: getAuth(app), db: getFirestore(app) };
}
async function authorize(req, auth) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error("Sign in is required."), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1], true);
  if (decoded.role !== "super_admin") throw Object.assign(new Error("Super Admin access is required."), { status: 403 });
  return decoded;
}
export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Method not allowed." });
  }
  try {
    const { auth, db } = adminServices();
    const actor = await authorize(req, auth);
    if (req.method === "GET") {
      const listed = await auth.listUsers(200);
      return send(res, 200, {
        users: listed.users.map((u) => ({
          uid: u.uid, email: u.email || "", displayName: u.displayName || "",
          disabled: u.disabled, emailVerified: u.emailVerified,
          role: u.customClaims?.role || "user", createdAt: u.metadata.creationTime || null,
          lastSignInAt: u.metadata.lastSignInTime || null
        }))
      });
    }
    const { uid, role, disabled } = req.body || {};
    if (typeof uid !== "string" || !uid.trim()) return send(res, 400, { error: "A valid account UID is required." });
    if (uid === actor.uid) return send(res, 400, { error: "You cannot change your own account role or status here." });
    const target = await auth.getUser(uid);
    if (target.email === "shadowvybez001@gmail.com") return send(res, 403, { error: "The initial Super Admin account is protected." });

    if (role !== undefined) {
      if (!ALLOWED_ROLES.has(role)) return send(res, 400, { error: "Choose user, admin, or assistant. Super Admin cannot be assigned here." });
      const claims = target.customClaims || {};
      delete claims.role;
      if (role !== "user") claims.role = role;
      await auth.setCustomUserClaims(uid, claims);
    }
    if (disabled !== undefined) {
      if (typeof disabled !== "boolean") return send(res, 400, { error: "Account status must be enabled or disabled." });
      await auth.updateUser(uid, { disabled });
    }
    await db.collection("audit_logs").add({
      action: role !== undefined ? "staff_role_changed" : "account_status_changed",
      actorUid: actor.uid, actorEmail: actor.email || "",
      targetUid: uid, targetEmail: target.email || "",
      newRole: role ?? target.customClaims?.role ?? "user",
      disabled: disabled ?? target.disabled,
      createdAt: FieldValue.serverTimestamp()
    });
    return send(res, 200, { success: true, message: "Account updated. The user must sign in again to refresh their role." });
  } catch (error) {
    return send(res, error.status || 500, { error: error.status ? error.message : "Unable to complete the account operation. Check Vercel function logs." });
  }
}