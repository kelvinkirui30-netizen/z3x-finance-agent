import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { normalizeDevicePublicKey } from "../lib/device-crypto.js";
import { isValidInstallId, isDeviceEnrolled } from "../lib/device-validation.js";

const PROJECT_ID = process.env.FIRESTORE_EMULATOR_HOST ? (process.env.FIREBASE_PROJECT_ID || "device-owner-manager") : "device-owner-manager";
const STAFF_ROLES = new Set(["super_admin", "admin"]);
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
    if (!match) return send(res, 401, { error: "Staff authentication is required." });
    const actor = await auth.verifyIdToken(match[1], !process.env.FIRESTORE_EMULATOR_HOST);
    const role = actor.role || "user";
    if (!STAFF_ROLES.has(role)) return send(res, 403, { error: "Only Admin or Super Admin can register or rotate a device key." });
    const installId = String(req.body?.installId || "");
    if (!isValidInstallId(installId)) return send(res, 400, { error: "Invalid device identifier." });
    const parsed = normalizeDevicePublicKey(req.body?.publicKeyPem);
    if (!parsed.ok) return send(res, 400, { error: parsed.error });
    const ref = db.collection("devices").doc(installId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Device inventory record not found."), { status: 404 });
      const device = snap.data();
      if (!isDeviceEnrolled(device)) throw Object.assign(new Error("Only an enrolled company device can receive a device key."), { status: 409 });
      if (role !== "super_admin" && device.ownerUid !== actor.uid) throw Object.assign(new Error("You cannot manage keys for this device."), { status: 403 });
      tx.update(ref, {
        devicePublicKeyPem: parsed.pem,
        deviceKeyFingerprint: parsed.fingerprint,
        deviceKeyAlgorithm: "ECDSA_P256_SHA256",
        deviceKeyRegisteredAt: FieldValue.serverTimestamp(),
        deviceKeyRegisteredByUid: actor.uid,
        deviceAuthStatus: "active",
        updatedAt: FieldValue.serverTimestamp()
      });
      tx.create(db.collection("audit_logs").doc(), {
        action: device.deviceKeyFingerprint ? "device_credential_rotated" : "device_credential_registered",
        actorUid: actor.uid,
        actorEmail: actor.email || "",
        targetDeviceId: installId,
        previousFingerprint: device.deviceKeyFingerprint || null,
        newFingerprint: parsed.fingerprint,
        createdAt: FieldValue.serverTimestamp()
      });
    });
    return send(res, 200, { success: true, fingerprint: parsed.fingerprint, algorithm: "ECDSA_P256_SHA256" });
  } catch (error) {
    return send(res, error.status || 500, { error: error.status ? error.message : "Unable to register the device key." });
  }
}
