import { createHash } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { isValidInstallId, isValidEnrollmentCode, normalizeDevicePayload, isEnrollmentCodeUsable, isDeviceEnrolled } from "../lib/device-validation.js";
import { normalizeDevicePublicKey } from "../lib/device-crypto.js";

const PROJECT_ID = process.env.FIRESTORE_EMULATOR_HOST ? (process.env.FIREBASE_PROJECT_ID || "device-owner-manager") : "device-owner-manager";
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
    if (!match) return send(res, 401, { error: "Staff sign-in is required to provision a company device." });
    const user = await auth.verifyIdToken(match[1], !process.env.FIRESTORE_EMULATOR_HOST);
    if (!new Set(["super_admin", "admin"]).has(user.role || "user")) {
      return send(res, 403, { error: "Only Admin or Super Admin can provision company devices." });
    }
    const body = req.body || {};
    const code = String(body.code || "").trim().toUpperCase();
    if (!isValidEnrollmentCode(code)) return send(res, 400, { error: "Enter a valid 8-character provisioning code." });
    const installId = String(body.installId || "");
    if (!isValidInstallId(installId)) return send(res, 400, { error: "Invalid app installation identifier." });
    const normalized = normalizeDevicePayload(body.device);
    if (!normalized.ok) return send(res, 400, { error: normalized.error });
    const parsedKey = normalizeDevicePublicKey(body.publicKeyPem);
    if (!parsedKey.ok) return send(res, 400, { error: parsedKey.error });
    const { manufacturer, model, androidVersion, appVersion, managementMode, sdkInt, batteryLevel, isCharging, managementCapabilities } = normalized.value;
    const device = { manufacturer, model, androidVersion, appVersion, managementMode, managementCapabilities };
    const codeHash = createHash("sha256").update(code).digest("hex");
    const codeRef = db.collection("enrollment_codes").doc(codeHash);
    const deviceRef = db.collection("devices").doc(installId);
    const now = Timestamp.now();
    await db.runTransaction(async (tx) => {
      const [codeSnap, deviceSnap] = await Promise.all([tx.get(codeRef), tx.get(deviceRef)]);
      if (!codeSnap.exists) throw Object.assign(new Error("This code is invalid or has expired."), { status: 404 });
      const data = codeSnap.data();
      if (data.ownerUid !== user.uid) throw Object.assign(new Error("Sign in using the staff account that created this code."), { status: 403 });
      if (!isEnrollmentCodeUsable({ ownerUid: data.ownerUid, status: data.status, expiresAtMillis: data.expiresAt?.toMillis() }, user.uid, now.toMillis())) {
        throw Object.assign(new Error("This code has expired or has already been used. Generate a new code."), { status: 410 });
      }
      if (deviceSnap.exists && deviceSnap.data().ownerUid !== user.uid) throw Object.assign(new Error("This installation is already registered to another company account."), { status: 409 });
      if (deviceSnap.exists && isDeviceEnrolled(deviceSnap.data())) throw Object.assign(new Error("This installation is already enrolled. Use the staff credential-rotation workflow instead."), { status: 409 });
      tx.set(deviceRef, {
        ownerUid: user.uid,
        displayName: [device.manufacturer, device.model].filter(Boolean).join(" ") || "Android device",
        ...device, sdkInt, batteryLevel, isCharging, deviceName: device.model,
        enrollmentStatus: "enrolled", enrollmentMethod: "single_use_code",
        inventorySource: "device_agent_reported",
        devicePublicKeyPem: parsedKey.pem,
        deviceKeyFingerprint: parsedKey.fingerprint,
        deviceKeyAlgorithm: "ECDSA_P256_SHA256",
        deviceKeyRegisteredAt: FieldValue.serverTimestamp(),
        deviceKeyRegisteredByUid: user.uid,
        deviceAuthStatus: "active",
        lastSeenAt: FieldValue.serverTimestamp(), enrolledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      tx.update(codeRef, { status: "used", usedAt: FieldValue.serverTimestamp(), deviceId: installId });
      tx.create(db.collection("audit_logs").doc(), {
        action: "device_enrolled", actorUid: user.uid, actorEmail: user.email || "",
        targetDeviceId: installId, deviceKeyFingerprint: parsedKey.fingerprint,
        createdAt: FieldValue.serverTimestamp()
      });
    });
    return send(res, 200, { success: true, deviceId: installId, deviceKeyFingerprint: parsedKey.fingerprint, message: "Company device cryptographically provisioned." });
  } catch (error) {
    return send(res, error.status || 500, { error: error.status ? error.message : "Device enrollment failed. Please try again." });
  }
}
