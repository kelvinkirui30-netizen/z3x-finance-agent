import { createHash, randomInt } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "device-owner-manager";
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

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
function newCode() {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}
function hashCode(code) {
  return createHash("sha256").update(code).digest("hex");
}
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed." });
  }
  try {
    const { auth, db } = services();
    const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
    if (!match) return send(res, 401, { error: "Sign in is required." });
    const user = await auth.verifyIdToken(match[1], true);
    const code = newCode();
    const codeHash = hashCode(code);
    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(now.toMillis() + 10 * 60 * 1000);
    const codeRef = db.collection("enrollment_codes").doc(codeHash);
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(db.collection("enrollment_codes")
        .where("ownerUid", "==", user.uid).where("status", "==", "pending").where("expiresAt", ">", now).limit(3));
      if (existing.size >= 3) {
        const error = new Error("You already have three active enrollment codes. Wait for them to expire or use one.");
        error.status = 429;
        throw error;
      }
      tx.create(codeRef, {
        ownerUid: user.uid,
        ownerEmail: user.email || "",
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
        expiresAt
      });
    });
    return send(res, 200, { code, expiresAt: expiresAt.toDate().toISOString(), expiresInSeconds: 600 });
  } catch (error) {
    return send(res, error.status || 500, {
      error: error.status ? error.message : "Unable to create an enrollment code. Check server configuration."
    });
  }
}
