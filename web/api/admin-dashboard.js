import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
const PROJECT_ID = "device-owner-manager";
function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(body);
}
function services() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing Firebase Admin credential.");
  const account = JSON.parse(raw);
  if (account.project_id !== PROJECT_ID) throw new Error("Wrong Firebase project.");
  const app = getApps()[0] || initializeApp({ credential: cert(account), projectId: PROJECT_ID });
  return { auth: getAuth(app), db: getFirestore(app) };
}
function serialize(value) {
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
  }
  return value;
}
export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return send(res, 405, { error: "Method not allowed." }); }
  try {
    const { auth, db } = services();
    const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
    if (!match) return send(res, 401, { error: "Sign in is required." });
    const user = await auth.verifyIdToken(match[1], true);
    const role = user.role || "user";
    if (!["super_admin", "admin", "assistant"].includes(role)) return send(res, 403, { error: "Staff access is required. This account currently has the '" + role + "' role." });
    const [devices, policies, activity] = await Promise.all([
      db.collection("devices").limit(500).get(),
      db.collection("device_policies").limit(500).get(),
      db.collection("audit_logs").orderBy("createdAt", "desc").limit(8).get()
    ]);
    return send(res, 200, {
      role,
      devices: devices.docs.map((d) => serialize({ id: d.id, ...d.data() })),
      policies: policies.docs.map((d) => serialize({ id: d.id, ...d.data() })),
      activities: activity.docs.map((d) => serialize({ id: d.id, ...d.data() }))
    });
  } catch (error) {
    console.error("Admin dashboard API failed:", error?.message || "Unknown error");
    const status = error?.code === "auth/id-token-expired" || error?.code === "auth/argument-error" ? 401 : 500;
    return send(res, status, { error: status === 401 ? "Your session expired. Sign in again." : "Unable to load dashboard data. Check Firebase Admin credentials and server logs." });
  }
}