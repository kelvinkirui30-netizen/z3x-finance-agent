import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { isValidInstallId, isDeviceOwnedBy, isDeviceEnrolled } from "../lib/device-validation.js";

const PROJECT_ID = "device-owner-manager";
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
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed." });
  }
  try {
    const { auth, db } = services();
    const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
    if (!match) return send(res, 401, { error: "Sign in is required." });
    const user = await auth.verifyIdToken(match[1], true);
    const installId = String(req.body?.installId || "");
    if (!isValidInstallId(installId)) {
      return send(res, 400, { error: "Invalid app installation identifier." });
    }
    const deviceRef = db.collection("devices").doc(installId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(deviceRef);
      if (!snap.exists) throw Object.assign(new Error("Device record not found."), { status: 404 });
      const device = snap.data();
      if (!isDeviceOwnedBy(device, user.uid)) {
        throw Object.assign(new Error("Only the account that owns this device can unlink it."), { status: 403 });
      }
      if (!isDeviceEnrolled(device)) {
        throw Object.assign(new Error("This device is already unlinked."), { status: 409 });
      }
      tx.update(deviceRef, {
        enrollmentStatus: "unenrolled",
        unenrolledAt: FieldValue.serverTimestamp(),
        unenrolledByUid: user.uid,
        updatedAt: FieldValue.serverTimestamp()
      });
      tx.create(db.collection("audit_logs").doc(), {
        action: "device_unenrolled",
        actorUid: user.uid,
        actorEmail: user.email || "",
        targetDeviceId: installId,
        createdAt: FieldValue.serverTimestamp()
      });
    });
    return send(res, 200, { success: true, message: "Device unlinked. Its existing history has been retained." });
  } catch (error) {
    return send(res, error.status || 500, {
      error: error.status ? error.message : "Unable to unlink this device. Please try again."
    });
  }
}
