import { createHash } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { isValidEnrollmentCode } from "../lib/device-validation.js";

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
    const match = String(req.headers.authorization || "").match(/^Bearer\\s+(.+)$/i);
    if (!match) return send(res, 401, { error: "Sign in is required." });
    const user = await auth.verifyIdToken(match[1], !process.env.FIRESTORE_EMULATOR_HOST);
    const code = String(req.body?.code || "").trim().toUpperCase();
    if (!isValidEnrollmentCode(code)) return send(res, 400, { error: "Enter a valid 8-character enrollment code." });
    const hash = createHash("sha256").update(code).digest("hex");
    const ref = db.collection("enrollment_codes").doc(hash);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Enrollment code not found."), { status: 404 });
      const data = snap.data();
      if (data.ownerUid !== user.uid) throw Object.assign(new Error("Only the account that created this code can revoke it."), { status: 403 });
      if (data.status !== "pending") throw Object.assign(new Error("Only an unused pending code can be revoked."), { status: 409 });
      tx.update(ref, {
        status: "revoked",
        revokedAt: FieldValue.serverTimestamp(),
        revokedByUid: user.uid
      });
      tx.create(db.collection("audit_logs").doc(), {
        action: "enrollment_code_revoked",
        actorUid: user.uid,
        actorEmail: user.email || "",
        targetCodeHash: hash,
        createdAt: FieldValue.serverTimestamp()
      });
    });
    return send(res, 200, { success: true, message: "Enrollment code revoked. It can no longer be used." });
  } catch (error) {
    return send(res, error.status || 500, {
      error: error.status ? error.message : "Unable to revoke this enrollment code. Please try again."
    });
  }
}
