import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { isValidInstallId, normalizeDevicePayload, isDeviceEnrolled } from "../lib/device-validation.js";
import { canonicalDevicePayload } from "../lib/device-crypto.js";

const PROJECT_ID = process.env.FIRESTORE_EMULATOR_HOST ? (process.env.FIREBASE_PROJECT_ID || "device-owner-manager") : "device-owner-manager";
function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(body);
}
function services() {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
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
export function deviceSignatureMessage(installId, challenge, device) {
  const digest = createHash("sha256").update(canonicalDevicePayload(device)).digest("hex");
  return Buffer.from(installId + "\n" + challenge + "\n" + digest, "utf8");
}
export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { error: "Method not allowed." }); }
  try {
    const { auth, db } = services();
    const body = req.body || {};
    const installId = String(body.installId || "");
    if (!isValidInstallId(installId)) return send(res, 400, { error: "Invalid app installation identifier." });
    const normalized = normalizeDevicePayload(body.device);
    if (!normalized.ok) return send(res, 400, { error: normalized.error });
    const deviceSnap = await db.collection("devices").doc(installId).get();
    if (!deviceSnap.exists || !isDeviceEnrolled(deviceSnap.data())) return send(res, 404, { error: "This device is not enrolled." });
    const deviceRecord = deviceSnap.data();
    if (!deviceRecord.devicePublicKeyPem && !deviceRecord.deviceAuthStatus) {
      // Temporary compatibility for already-enrolled legacy agents. New
      // enrollments always carry a device key; staff key registration migrates
      // existing records and permanently moves them to signed-device auth.
      const bearer = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
      if (!bearer) return send(res, 401, { error: "Legacy device migration requires an authenticated staff session." });
      const user = await auth.verifyIdToken(bearer[1], !process.env.FIRESTORE_EMULATOR_HOST);
      if (deviceRecord.ownerUid !== user.uid) return send(res, 403, { error: "This device is not linked to the signed-in staff account." });
      const { sdkInt, batteryLevel, isCharging, ...legacyPatch } = normalized.value;
      await db.runTransaction(async (tx) => {
        const current = await tx.get(db.collection("devices").doc(installId));
        if (!current.exists || !isDeviceEnrolled(current.data()) || current.data().devicePublicKeyPem) {
          throw Object.assign(new Error("Device credentials changed; retry with the current agent."), { status: 409 });
        }
        tx.update(db.collection("devices").doc(installId), {
          ...legacyPatch, sdkInt, batteryLevel, isCharging,
          lastSeenAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
        });
      });
      return send(res, 200, { success: true, legacyCompatibility: true, checkedInAt: new Date().toISOString() });
    }
    if (!deviceRecord.devicePublicKeyPem || deviceRecord.deviceAuthStatus !== "active") {
      return send(res, 403, { error: "Device authorization is disabled. Contact authorized staff." });
    }
    const challenge = String(body.challenge || "");
    const signature = String(body.signature || "");
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(challenge) || !/^[A-Za-z0-9_-]+$/.test(signature) || signature.length > 256) {
      return send(res, 400, { error: "A valid challenge and device signature are required." });
    }
    const challengeHash = createHash("sha256").update(challenge).digest("hex");
    const challengeRef = db.collection("device_auth_challenges").doc(challengeHash);
    const challengeSnap = await challengeRef.get();
    if (!challengeSnap.exists) return send(res, 401, { error: "Device challenge is invalid or expired." });
    const challengeData = challengeSnap.data();
    if (challengeData.installId !== installId || challengeData.used || challengeData.expiresAt.toMillis() <= Date.now()) {
      return send(res, 401, { error: "Device challenge is invalid, expired or already used." });
    }
    let validSignature = false;
    try {
      validSignature = verifySignature(
        "sha256",
        deviceSignatureMessage(installId, challenge, normalized.value),
        createPublicKey(deviceRecord.devicePublicKeyPem),
        Buffer.from(signature, "base64url")
      );
    } catch { validSignature = false; }
    if (!validSignature) return send(res, 401, { error: "Device signature verification failed." });

    const { sdkInt, batteryLevel, isCharging, ...patch } = normalized.value;
    await db.runTransaction(async (tx) => {
      const [currentChallenge, currentDevice] = await Promise.all([
        tx.get(challengeRef), tx.get(db.collection("devices").doc(installId))
      ]);
      if (!currentChallenge.exists || currentChallenge.data().used ||
          currentChallenge.data().installId !== installId ||
          currentChallenge.data().expiresAt.toMillis() <= Date.now()) {
        throw Object.assign(new Error("Device challenge was already used or expired."), { status: 409 });
      }
      if (!currentDevice.exists || !isDeviceEnrolled(currentDevice.data()) ||
          currentDevice.data().deviceKeyFingerprint !== deviceRecord.deviceKeyFingerprint ||
          currentDevice.data().deviceAuthStatus !== "active") {
        throw Object.assign(new Error("Device authorization has changed. Contact support."), { status: 403 });
      }
      tx.update(challengeRef, { used: true, usedAt: FieldValue.serverTimestamp() });
      tx.update(db.collection("devices").doc(installId), {
        ...patch, sdkInt, batteryLevel, isCharging,
        lastSeenAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
      });
    });
    return send(res, 200, { success: true, checkedInAt: new Date().toISOString() });
  } catch (error) {
    return send(res, error.status || 500, { error: error.status ? error.message : "Device check-in failed. Retry when connectivity is available." });
  }
}
