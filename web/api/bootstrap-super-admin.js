import { timingSafeEqual } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const ALLOWED_EMAIL = "shadowvybez001@gmail.com";
const PROJECT_ID = "device-owner-manager";
const LOCK_PATH = "_system/superAdminBootstrap";

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

function safeSecretMatch(supplied, expected) {
  if (typeof supplied !== "string" || typeof expected !== "string") return false;
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function getFirebaseAdmin() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) throw new Error("Missing Firebase Admin credential.");
  const serviceAccount = JSON.parse(serviceAccountJson);
  if (serviceAccount.project_id !== PROJECT_ID) throw new Error("Wrong Firebase project credential.");
  const app = getApps()[0] || initializeApp({
    credential: cert(serviceAccount),
    projectId: PROJECT_ID
  });
  return { auth: getAuth(app), db: getFirestore(app) };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed." });
  }

  const expectedSecret = process.env.SUPER_ADMIN_BOOTSTRAP_SECRET;
  if (!expectedSecret || expectedSecret.length < 32 ||
      !safeSecretMatch(req.headers["x-bootstrap-secret"], expectedSecret)) {
    return send(res, 403, { error: "Activation secret is incorrect." });
  }

  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return send(res, 401, { error: "Please sign in again and retry." });

  let auth;
  let db;
  let uid;
  try {
    ({ auth, db } = getFirebaseAdmin());
    const decoded = await auth.verifyIdToken(match[1], true);

    if (decoded.email !== ALLOWED_EMAIL || decoded.email_verified !== true) {
      return send(res, 403, { error: "Only the verified approved Google account can complete this activation." });
    }

    const target = await auth.getUser(decoded.uid);
    if (target.email !== ALLOWED_EMAIL || target.emailVerified !== true) {
      return send(res, 403, { error: "The Firebase account does not match the approved verified email." });
    }
    uid = target.uid;

    const lockRef = db.doc(LOCK_PATH);
    await db.runTransaction(async (transaction) => {
      const lock = await transaction.get(lockRef);
      if (lock.exists) {
        const error = new Error("BOOTSTRAP_ALREADY_USED");
        throw error;
      }
      transaction.create(lockRef, {
        status: "in_progress",
        ownerUid: uid,
        ownerEmail: ALLOWED_EMAIL,
        startedAt: FieldValue.serverTimestamp()
      });
    });

    const existingClaims = target.customClaims || {};
    await auth.setCustomUserClaims(uid, { ...existingClaims, role: "super_admin" });
    await lockRef.update({
      status: "completed",
      completedAt: FieldValue.serverTimestamp()
    });

    return send(res, 200, {
      success: true,
      message: "Super Admin role assigned. Sign out and sign in again to refresh your access token.",
      email: ALLOWED_EMAIL,
      role: "super_admin"
    });
  } catch (error) {
    if (error?.message === "BOOTSTRAP_ALREADY_USED") {
      return send(res, 409, { error: "The one-time Super Admin activation has already been used or is locked. Do not retry; contact the project owner for a controlled recovery." });
    }
    console.error("Super Admin bootstrap failed:", error?.message || "Unknown error");
    return send(res, 500, { error: "Activation failed. Check the private Firebase Admin credential and Vercel function logs." });
  }
}
