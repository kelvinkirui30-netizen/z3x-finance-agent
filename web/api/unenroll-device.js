import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.FIRESTORE_EMULATOR_HOST
  ? (process.env.FIREBASE_PROJECT_ID || "device-owner-manager")
  : "device-owner-manager";
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

// Direct unlinking is deliberately disabled. A later release endpoint will
// require a settled finance agreement, independent approval and a server-issued
// release authorization before changing device assignment or enrollment.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed." });
  }
  try {
    const { auth } = services();
    const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
    if (!match) return send(res, 401, { error: "Sign in is required." });
    const user = await auth.verifyIdToken(match[1], !process.env.FIRESTORE_EMULATOR_HOST);
    if (!["super_admin", "admin"].includes(user.role || "user")) {
      return send(res, 403, { error: "Customer accounts cannot unlink or release company devices." });
    }
    return send(res, 409, {
      error: "Direct unlinking is disabled. Use the approved finance-settlement and device-release workflow."
    });
  } catch {
    return send(res, 401, { error: "Unable to verify your authorization." });
  }
}
