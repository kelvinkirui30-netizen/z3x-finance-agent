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
    const installId = String(req.body?.installId || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installId)) {
      return send(res, 400, { error: "Invalid installation identifier." });
    }
    const deviceRef = db.collection("devices").doc(installId);
    const device = await deviceRef.get();
    if (!device.exists || device.data().ownerUid !== user.uid) return send(res, 403, { error: "This device is not linked to the signed-in account." });
    if (device.data().enrollmentStatus !== "enrolled") return send(res, 410, { error: "This device is no longer enrolled." });

    const candidates = await db.collection("device_commands").where("deviceId", "==", installId).limit(50).get();
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
