import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "device-owner-manager";
const ALLOWED_COMMANDS = new Set(["request_check_in", "display_notice"]);
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
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { error: "Method not allowed." }); }
  try {
    const { auth, db } = services();
    const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
    if (!match) return send(res, 401, { error: "Sign in is required." });
    const user = await auth.verifyIdToken(match[1], true);
    if (!["super_admin", "admin"].includes(user.role || "user")) {
      return send(res, 403, { error: "Only Admin or Super Admin can issue device requests." });
    }
    const deviceId = String(req.body?.deviceId || "");
    const command = String(req.body?.command || "");
    const ttlSeconds = Number(req.body?.ttlSeconds ?? 900);
    if (!/^[0-9a-f-]{36}$/i.test(deviceId)) return send(res, 400, { error: "Invalid device identifier." });
    if (!ALLOWED_COMMANDS.has(command)) return send(res, 400, { error: "Unsupported device request." });
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600) {
      return send(res, 400, { error: "Command expiry must be between 60 and 3600 seconds." });
    }
    let payload = {};
    if (command === "display_notice") {
      const message = String(req.body?.payload?.message || "").trim();
      if (!message || message.length > 300) return send(res, 400, { error: "A notice of 1 to 300 characters is required." });
      payload = { message };
    }
    const deviceRef = db.collection("devices").doc(deviceId);
    const deviceSnap = await deviceRef.get();
    if (!deviceSnap.exists || deviceSnap.data().enrollmentStatus !== "enrolled") {
      return send(res, 404, { error: "The selected device is not currently enrolled." });
    }
    const commandRef = db.collection("device_commands").doc();
    const expiresAt = Timestamp.fromMillis(Date.now() + ttlSeconds * 1000);
    await db.runTransaction(async (tx) => {
      const current = await tx.get(deviceRef);
      if (!current.exists || current.data().enrollmentStatus !== "enrolled") {
        throw Object.assign(new Error("The selected device is no longer enrolled."), { status: 409 });
      }
      tx.create(commandRef, {
        deviceId,
        ownerUid: current.data().ownerUid,
        command,
        payload,
        status: "pending",
        createdBy: user.uid,
        createdByEmail: user.email || "",
        createdAt: FieldValue.serverTimestamp(),
        expiresAt
      });
      tx.create(db.collection("audit_logs").doc(), {
        action: "device_command_issued",
        actorUid: user.uid,
        actorEmail: user.email || "",
        targetDeviceId: deviceId,
        targetCommandId: commandRef.id,
        command,
        createdAt: FieldValue.serverTimestamp()
      });
    });
    return send(res, 201, { success: true, commandId: commandRef.id, expiresAt: expiresAt.toDate().toISOString() });
  } catch (error) {
    return send(res, error.status || 500, { error: error.status ? error.message : "Unable to issue this device request." });
  }
}
