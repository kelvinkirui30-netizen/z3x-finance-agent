import { randomBytes, createHash } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

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

export async function fetchDeviceCommands(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { error: "Method not allowed." }); }
  try {
    const { auth, db } = services();
    const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
    if (!match) return send(res, 401, { error: "Sign in is required." });
    const user = await auth.verifyIdToken(match[1], true);
    const installId = String(req.body?.installId || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installId)) {
      return send(res, 400, { error: "Invalid installation identifier." });
    }
    const deviceRef = db.collection("devices").doc(installId);
    const device = await deviceRef.get();
    if (!device.exists || device.data().ownerUid !== user.uid) return send(res, 403, { error: "This device is not linked to the signed-in account." });
    if (device.data().enrollmentStatus !== "enrolled") return send(res, 410, { error: "This device is no longer enrolled." });

    const candidates = await db.collection("device_commands")
      .where("deviceId", "==", installId)
      .where("status", "in", ["pending", "delivered"])
      .orderBy("createdAt", "asc")
      .limit(50)
      .get();
    const commands = [];
    const now = Date.now();
    for (const candidate of candidates.docs) {
      if (commands.length >= 10) break;
      const nonce = randomBytes(32).toString("hex");
      const nonceHash = createHash("sha256").update(nonce).digest("hex");
      let issued = null;
      await db.runTransaction(async (tx) => {
        const [commandSnap, deviceSnap] = await Promise.all([tx.get(candidate.ref), tx.get(deviceRef)]);
        if (!commandSnap.exists || !deviceSnap.exists) return;
        const data = commandSnap.data();
        const currentDevice = deviceSnap.data();
        if (currentDevice.ownerUid !== user.uid || currentDevice.enrollmentStatus !== "enrolled") return;
        if (data.deviceId !== installId || data.ownerUid !== user.uid) return;
        if (!["request_check_in", "display_notice"].includes(data.command)) return;
        const expiry = data.expiresAt?.toMillis?.() || 0;
        if (expiry <= now) {
          if (data.status === "pending" || data.status === "delivered") {
            tx.update(candidate.ref, { status: "expired", expiredAt: FieldValue.serverTimestamp(), deliveryNonceHash: FieldValue.delete() });
          }
          return;
        }
        const leaseExpiry = data.deliveryLeaseUntil?.toMillis?.() || 0;
        const available = data.status === "pending" || (data.status === "delivered" && leaseExpiry <= now);
        if (!available) return;
        tx.update(candidate.ref, {
          status: "delivered",
          deliveredAt: FieldValue.serverTimestamp(),
          deliveredToUid: user.uid,
          deliveryNonceHash: nonceHash,
          deliveryLeaseUntil: Timestamp.fromMillis(Math.min(expiry, now + 5 * 60 * 1000))
        });
        issued = {
          commandId: candidate.id,
          command: data.command,
          payload: data.command === "display_notice" && typeof data.payload?.message === "string"
            ? { message: data.payload.message.slice(0, 300) } : {},
          nonce
        };
      });
      if (issued) commands.push(issued);
    }
    return send(res, 200, { commands });
  } catch (error) {
    console.error("Device command fetch failed:", error?.message || "Unknown error");
    return send(res, 500, { error: "Unable to retrieve device requests." });
  }
}

export async function completeDeviceCommand(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { error: "Method not allowed." }); }
  try {
    const { auth, db } = services();
    const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
    if (!match) return send(res, 401, { error: "Sign in is required." });
    const user = await auth.verifyIdToken(match[1], true);
    const installId = String(req.body?.installId || "");
    const commandId = String(req.body?.commandId || "");
    const nonce = String(req.body?.nonce || "");
    const outcome = String(req.body?.outcome || "");
    if (!/^[0-9a-f-]{36}$/i.test(installId) || !/^[A-Za-z0-9_-]{10,150}$/.test(commandId) ||
        !/^[0-9a-f]{64}$/.test(nonce) || !["success", "failed"].includes(outcome)) {
      return send(res, 400, { error: "Invalid command result." });
    }
    const commandRef = db.collection("device_commands").doc(commandId);
    const deviceRef = db.collection("devices").doc(installId);
    await db.runTransaction(async (tx) => {
      const [commandSnap, deviceSnap] = await Promise.all([tx.get(commandRef), tx.get(deviceRef)]);
      if (!commandSnap.exists || !deviceSnap.exists) throw Object.assign(new Error("Command or device not found."), { status: 404 });
      const command = commandSnap.data();
      const device = deviceSnap.data();
      if (device.ownerUid !== user.uid || device.enrollmentStatus !== "enrolled" ||
          command.deviceId !== installId || command.ownerUid !== user.uid) {
        throw Object.assign(new Error("This command does not belong to the signed-in account."), { status: 403 });
      }
      if (command.status !== "delivered") throw Object.assign(new Error("This command is no longer awaiting a result."), { status: 409 });
      if ((command.deliveryNonceHash || "") !== createHash("sha256").update(nonce).digest("hex")) {
        throw Object.assign(new Error("Command receipt verification failed."), { status: 403 });
      }
      if ((command.expiresAt?.toMillis?.() || 0) <= Date.now() ||
          (command.deliveryLeaseUntil?.toMillis?.() || 0) <= Date.now()) {
        throw Object.assign(new Error("This command has expired. The administrator can issue a new request."), { status: 410 });
      }
      tx.update(commandRef, {
        status: outcome === "success" ? "completed" : "failed",
        resultCode: outcome,
        resultMessage: String(req.body?.message || "").slice(0, 200),
        completedAt: FieldValue.serverTimestamp(),
        deliveryNonceHash: FieldValue.delete(),
        deliveryLeaseUntil: FieldValue.delete()
      });
      tx.create(db.collection("audit_logs").doc(), {
        action: "device_command_result",
        actorUid: user.uid,
        targetDeviceId: installId,
        targetCommandId: commandId,
        outcome,
        createdAt: FieldValue.serverTimestamp()
      });
    });
    return send(res, 200, { success: true });
  } catch (error) {
    return send(res, error.status || 500, { error: error.status ? error.message : "Unable to record the command result." });
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { error: "Method not allowed." }); }
  const action = String(req.query?.action || "");
  if (action === "fetch") return fetchDeviceCommands(req, res);
  if (action === "complete") return completeDeviceCommand(req, res);
  return send(res, 404, { error: "Unknown device command action." });
}
