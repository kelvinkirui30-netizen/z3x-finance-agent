import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.FIRESTORE_EMULATOR_HOST
  ? (process.env.FIREBASE_PROJECT_ID || "device-owner-manager")
  : "device-owner-manager";
function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(body);
}
function services() {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
    const app = getApps()[0] || initializeApp({ projectId: PROJECT_ID });
    return { auth: getAuth(app), db: getFirestore(app) };
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing Firebase Admin credential.");
  const account = JSON.parse(raw);
  if (account.project_id !== PROJECT_ID) throw new Error("Wrong Firebase project.");
  const app = getApps()[0] || initializeApp({ credential: cert(account), projectId: PROJECT_ID });
  return { auth: getAuth(app), db: getFirestore(app) };
}
export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { error: "Method not allowed." }); }
  try {
    const { auth, db } = services();
    const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
    if (!match) return send(res, 401, { error: "Sign in is required." });
    const user = await auth.verifyIdToken(match[1], !process.env.FIRESTORE_EMULATOR_HOST);
    const installId = String(req.body?.installId || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installId)) {
      return send(res, 400, { error: "Invalid installation identifier." });
    }
    const ref = db.collection("devices").doc(installId);
    const device = await ref.get();
    if (!device.exists) return send(res, 404, { error: "No existing device link was found. Generate a new enrollment code in your portal." });
    if (device.data().ownerUid !== user.uid) return send(res, 403, { error: "This installation is linked to a different account." });
    if (device.data().enrollmentStatus !== "enrolled") return send(res, 410, { error: "This device was explicitly unlinked. Generate a new enrollment code to link it again." });
    return send(res, 200, { success: true, deviceId: installId, message: "Your existing device link has been restored." });
  } catch (error) {
    console.error("Device enrollment restore failed:", error?.message || "Unknown error");
    return send(res, 500, { error: "Unable to restore this device link right now." });
  }
}
