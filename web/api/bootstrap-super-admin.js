import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const ALLOWED_EMAIL = "shadowvybez001@gmail.com";

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed." });
  }

  const bootstrapSecret = process.env.SUPER_ADMIN_BOOTSTRAP_SECRET;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!bootstrapSecret || !serviceAccountJson) {
    return send(res, 503, { error: "Server setup is incomplete. Ask the project owner to check the private Vercel environment variables." });
  }

  const suppliedSecret = req.headers["x-bootstrap-secret"];
  if (typeof suppliedSecret !== "string" || suppliedSecret.length < 32 || suppliedSecret !== bootstrapSecret) {
    return send(res, 403, { error: "Activation secret is incorrect." });
  }

  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return send(res, 401, { error: "Please sign in again and retry." });

  try {
    const serviceAccount = JSON.parse(serviceAccountJson);
    if (serviceAccount.project_id !== "device-owner-manager") {
      return send(res, 500, { error: "The configured Firebase service account belongs to the wrong project." });
    }

    const app = getApps()[0] || initializeApp({
      credential: cert(serviceAccount),
      projectId: "device-owner-manager"
    });
    const auth = getAuth(app);
    const decoded = await auth.verifyIdToken(match[1], true);

    if (decoded.email !== ALLOWED_EMAIL || decoded.email_verified !== true) {
      return send(res, 403, { error: "Only the verified approved Google account can complete this activation." });
    }

    const target = await auth.getUser(decoded.uid);
    if (target.email !== ALLOWED_EMAIL || target.emailVerified !== true) {
      return send(res, 403, { error: "The Firebase account does not match the approved verified email." });
    }

    let pageToken;
    do {
      const page = await auth.listUsers(1000, pageToken);
      const anotherOwner = page.users.find((user) =>
        user.uid !== target.uid && user.customClaims?.role === "super_admin"
      );
      if (anotherOwner) {
        return send(res, 409, { error: "A Super Admin already exists. This one-time bootstrap is only for the first owner." });
      }
      pageToken = page.pageToken;
    } while (pageToken);

    const claims = { ...(target.customClaims || {}), role: "super_admin" };
    await auth.setCustomUserClaims(target.uid, claims);

    return send(res, 200, {
      success: true,
      message: "Super Admin role assigned. Sign out and sign in again to refresh your access token.",
      email: ALLOWED_EMAIL,
      role: "super_admin"
    });
  } catch (error) {
    console.error("Super Admin bootstrap failed:", error?.message || "Unknown error");
    return send(res, 500, { error: "Activation failed. Check the private Firebase Admin credential and Vercel function logs." });
  }
}
