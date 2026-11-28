import { createHash, randomBytes } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { isValidInstallId, isDeviceEnrolled } from "../lib/device-validation.js";

const PROJECT_ID = process.env.FIRESTORE_EMULATOR_HOST ? (process.env.FIREBASE_PROJECT_ID || "device-owner-manager") : "device-owner-manager";
function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(body);
}
function services() {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const app = getApps()[0] || initializeApp({ projectId: PROJECT_ID });
    return getFirestore(app);
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing Firebase Admin credential.");
  const account = JSON.parse(raw);
  if (account.project_id !== PROJECT_ID) throw new Error("Wrong Firebase project.");
  const app = getApps()[0] || initializeApp({ credential: cert(account), projectId: PROJECT_ID });
  return getFirestore(app);
}
export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { error: "Method not allowed." }); }
  try {
    const db = services();
    const installId = String(req.body?.installId || "");
    if (!isValidInstallId(installId)) return send(res, 400, { error: "Invalid device identifier." });
    const deviceSnap = await db.collection("devices").doc(installId).get();
    if (!deviceSnap.exists || !isDeviceEnrolled(deviceSnap.data()) || !deviceSnap.data().devicePublicKeyPem) {
      return send(res, 404, { error: "This device has not completed cryptographic provisioning." });
    }
    const challenge = randomBytes(32).toString("base64url");
    const challengeHash = createHash("sha256").update(challenge).digest("hex");
    const now = Timestamp.now();
    await db.collection("device_auth_challenges").doc(challengeHash).create({
      installId, used: false, createdAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + 90_000)
    });
    return send(res, 200, { challenge, expiresInSeconds: 90 });
  } catch (error) {
    console.error("Device challenge failed:", error?.message || "Unknown error");
    return send(res, 500, { error: "Unable to issue a device challenge." });
  }
}
