import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { isValidInstallId, normalizeDevicePayload, isDeviceOwnedBy, isDeviceEnrolled } from "../lib/device-validation.js";

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
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed." });
  }
  try {
    const { auth, db } = services();
    const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
    if (!match) return send(res, 401, { error: "Sign in is required for device check-in." });
    const user = await auth.verifyIdToken(match[1], true);
    const body = req.body || {};
    const installId = String(body.installId || "");
    if (!isValidInstallId(installId)) return send(res, 400, { error: "Invalid app installation identifier." });
    const normalized = normalizeDevicePayload(body.device);
    if (!normalized.ok) return send(res, 400, { error: normalized.error });
    const { sdkInt, batteryLevel, isCharging, ...patch } = normalized.value;
    const ref = db.collection("devices").doc(installId);
    const snap = await ref.get();
    if (!snap.exists) return send(res, 404, { error: "This installation is not enrolled. Generate a new code in your portal." });
    if (!isDeviceOwnedBy(snap.data(), user.uid)) return send(res, 403, { error: "This device is not linked to the signed-in account." });
    if (!isDeviceEnrolled(snap.data())) return send(res, 410, { error: "This device is no longer enrolled. Link it again from your portal if you want to resume check-ins." });
    await ref.update({
      ...patch,
      sdkInt,
      batteryLevel,
      isCharging,
      lastSeenAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    return send(res, 200, { success: true, checkedInAt: new Date().toISOString() });
  } catch (error) {
    return send(res, error.status || 500, {
      error: error.status ? error.message : "Device check-in failed. Retry when connectivity is available."
    });
  }
}
