import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "device-owner-manager";
const INITIAL_OWNER_EMAIL = "shadowvybez001@gmail.com";
const ALLOWED_ROLES = new Set(["user", "admin", "assistant"]);
const PAGE_SIZE = 100;

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(body);
}

function adminServices() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing Firebase Admin credential.");
  const account = JSON.parse(raw);
  if (account.project_id !== PROJECT_ID) throw new Error("Wrong Firebase project.");
  const app = getApps()[0] || initializeApp({
    credential: cert(account),
    projectId: PROJECT_ID
  });
  return { auth: getAuth(app), db: getFirestore(app) };
}

async function authorize(req, auth) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error("Sign in is required."), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1], true);
  const role = decoded.role || "user";
  if (!["super_admin", "admin", "assistant"].includes(role)) {
    throw Object.assign(new Error("Staff access is required."), { status: 403 });
  }
  return { ...decoded, role };
}

function publicUser(u) {
  return {
    uid: u.uid,
    email: u.email || "",
    displayName: u.displayName || "",
    disabled: Boolean(u.disabled),
    emailVerified: Boolean(u.emailVerified),
    role: u.customClaims?.role || "user",
    createdAt: u.metadata.creationTime || null,
    lastSignInAt: u.metadata.lastSignInTime || null
  };
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
      if (!["super_admin", "admin"].includes(actor.role)) {
        return send(res, 403, { error: "Assistant accounts do not have access to the full account directory." });
      }
      const requestedToken = typeof req.query?.pageToken === "string" ? req.query.pageToken : undefined;
      const listed = await auth.listUsers(PAGE_SIZE, requestedToken);
      return send(res, 200, {
        users: listed.users.map(publicUser),
        nextPageToken: listed.pageToken || null
      });
    }

    if (actor.role !== "super_admin") {
      return send(res, 403, { error: "Only Super Admin can change account roles or status." });
    }

    const { uid, role, disabled } = req.body || {};
    if (typeof uid !== "string" || !uid.trim() || uid.length > 128) {
      return send(res, 400, { error: "A valid account UID is required." });
    }
    if (role === undefined && disabled === undefined) {
      return send(res, 400, { error: "No account change was supplied." });
    }
    if (role !== undefined && !ALLOWED_ROLES.has(role)) {
      return send(res, 400, { error: "Choose user, assistant, or admin. Super Admin cannot be assigned here." });
    }
    if (disabled !== undefined && typeof disabled !== "boolean") {
      return send(res, 400, { error: "Account status must be enabled or disabled." });
    }
    if (uid === actor.uid) {
      return send(res, 400, { error: "You cannot change your own account role or status here." });
    }

    const target = await auth.getUser(uid);
    if (target.customClaims?.role === "super_admin" || target.email === INITIAL_OWNER_EMAIL) {
      return send(res, 403, { error: "The Super Admin account is protected from changes here." });
    }

    const oldRole = target.customClaims?.role || "user";
    const oldDisabled = Boolean(target.disabled);
    const nextClaims = { ...(target.customClaims || {}) };
    if (role !== undefined) {
      delete nextClaims.role;
      if (role !== "user") nextClaims.role = role;
      await auth.setCustomUserClaims(uid, nextClaims);
    }
    if (disabled !== undefined) {
      await auth.updateUser(uid, { disabled });
    }

    await db.collection("audit_logs").add({
      action: role !== undefined ? "account_role_changed" : "account_status_changed",
      actorUid: actor.uid,
      actorEmail: actor.email || "",
      targetUid: uid,
      targetEmail: target.email || "",
      previousRole: oldRole,
      newRole: role !== undefined ? role : oldRole,
      previousDisabled: oldDisabled,
      disabled: disabled !== undefined ? disabled : oldDisabled,
      createdAt: FieldValue.serverTimestamp()
    });

    return send(res, 200, {
      success: true,
      message: "Account updated. The affected user must sign in again to refresh their access token."
    });
  } catch (error) {
    const status = error.status || (error.code === "auth/user-not-found" ? 404 : 500);
    return send(res, status, {
      error: status < 500 ? error.message : "Unable to complete the account operation. Check Vercel function logs."
    });
  }
}
