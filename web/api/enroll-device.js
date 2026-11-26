import { createHash } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "device-owner-manager";
const CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/;
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
    if (!match) return send(res, 401, { error: "Sign in to the same account that created this code." });
    const user = await auth.verifyIdToken(match[1], true);
    const body = req.body || {};
    const code = String(body.code || "").trim().toUpperCase();
    if (!CODE_PATTERN.test(code)) return send(res, 400, { error: "Enter a valid 8-character enrollment code." });
    const installId = String(body.installId || "");
    if (!/^[0-9a-f-]{36}$/i.test(installId)) return send(res, 400, { error: "Invalid app installation identifier." });
    const fields = ["manufacturer", "model", "androidVersion", "appVersion", "managementMode"];
    const device = {};
    for (const key of fields) {
      const value = body.device?.[key];
      if (typeof value !== "string" || value.length > 120) {
        return send(res, 400, { error: "Device information is incomplete or invalid." });
      }
      device[key] = value;
    }
    const sdkInt = Number(body.device?.sdkInt);
    if (!Number.isInteger(sdkInt) || sdkInt < 21 || sdkInt > 100) {
      return send(res, 400, { error: "Invalid Android API level." });
    }
    const batteryLevel = body.device?.batteryLevel == null ? null : Number(body.device.batteryLevel);
    const isCharging = body.device?.isCharging == null ? null : body.device.isCharging;
    if (batteryLevel !== null && (!Number.isInteger(batteryLevel) || batteryLevel < 0 || batteryLevel > 100)) {
      return send(res, 400, { error: "Invalid battery level." });
    }
    if (isCharging !== null && typeof isCharging !== "boolean") {
      return send(res, 400, { error: "Invalid charging state." });
    }
    const codeHash = createHash("sha256").update(code).digest("hex");
    const codeRef = db.collection("enrollment_codes").doc(codeHash);
    const deviceRef = db.collection("devices").doc(installId);
    const now = Timestamp.now();
    await db.runTransaction(async (tx) => {
      const [codeSnap, deviceSnap] = await Promise.all([tx.get(codeRef), tx.get(deviceRef)]);
      if (!codeSnap.exists) throw Object.assign(new Error("This code is invalid or has expired."), { status: 404 });
      const data = codeSnap.data();
      if (data.ownerUid !== user.uid) throw Object.assign(new Error("Sign in using the same account that generated this code."), { status: 403 });
      if (data.status !== "pending" || !data.expiresAt || data.expiresAt.toMillis() <= now.toMillis()) {
        throw Object.assign(new Error("This code has expired or has already been used. Generate a new code."), { status: 410 });
      }
      if (deviceSnap.exists && deviceSnap.data().ownerUid !== user.uid) {
        throw Object.assign(new Error("This app installation is already linked to another account."), { status: 409 });
      }
      tx.set(deviceRef, {
        ownerUid: user.uid,
        displayName: [device.manufacturer, device.model].filter(Boolean).join(" ") || "Android device",
        ...device,
        sdkInt,
        batteryLevel,
        isCharging,
        deviceName: device.model,
        enrollmentStatus: "enrolled",
        enrollmentMethod: "single_use_code",
        inventorySource: "device_agent_reported",
        lastSeenAt: FieldValue.serverTimestamp(),
        enrolledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      tx.update(codeRef, {
        status: "used",
        usedAt: FieldValue.serverTimestamp(),
        deviceId: installId
      });
      const auditRef = db.collection("audit_logs").doc();
      tx.create(auditRef, {
        action: "device_enrolled",
        actorUid: user.uid,
        actorEmail: user.email || "",
        targetDeviceId: installId,
        createdAt: FieldValue.serverTimestamp()
      });
    });
    return send(res, 200, { success: true, deviceId: installId, message: "Device successfully linked to your account." });
  } catch (error) {
    return send(res, error.status || 500, {
      error: error.status ? error.message : "Device enrollment failed. Please try again."
    });
  }
}
