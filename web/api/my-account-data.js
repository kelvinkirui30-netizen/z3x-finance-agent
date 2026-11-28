import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.FIRESTORE_EMULATOR_HOST
  ? (process.env.FIREBASE_PROJECT_ID || "device-owner-manager")
  : "device-owner-manager";
const STAFF_ROLES = new Set(["super_admin", "admin"]);
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
function iso(value) {
  return value && typeof value.toDate === "function" ? value.toDate().toISOString() : null;
}
function uniqueDocs(...snapshots) {
  const byId = new Map();
  for (const snapshot of snapshots) for (const doc of snapshot.docs) byId.set(doc.id, doc);
  return [...byId.values()];
}
export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return send(res, 405, { error: "Method not allowed." }); }
  try {
    const { auth, db } = services();
    const match = String(req.headers.authorization || "").match(/^Bearer\\s+(.+)$/i);
    if (!match) return send(res, 401, { error: "Sign in is required." });
    const user = await auth.verifyIdToken(match[1], !process.env.FIRESTORE_EMULATOR_HOST);
    const isStaff = STAFF_ROLES.has(user.role || "user");
    const [devices, primaryInstallments, legacyInstallments, primaryPayments, legacyPayments] = await Promise.all([
      db.collection("devices").where(isStaff ? "ownerUid" : "assignedCustomerUid", "==", user.uid).limit(100).get(),
      db.collection("device_installments").where(isStaff ? "ownerUid" : "customerUid", "==", user.uid).limit(200).get(),
      isStaff ? Promise.resolve({ docs: [] }) : db.collection("device_installments").where("ownerUid", "==", user.uid).limit(200).get(),
      db.collection("device_installment_payments").where(isStaff ? "ownerUid" : "customerUid", "==", user.uid).limit(500).get(),
      isStaff ? Promise.resolve({ docs: [] }) : db.collection("device_installment_payments").where("ownerUid", "==", user.uid).limit(500).get()
    ]);
    return send(res, 200, {
      devices: devices.docs.map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          displayName: d.displayName || "",
          manufacturer: d.manufacturer || "",
          model: d.model || "",
          androidVersion: d.androidVersion || "",
          appVersion: d.appVersion || "",
          managementMode: d.managementMode || "",
          enrollmentStatus: d.enrollmentStatus || "",
          assignmentStatus: d.assignmentStatus || "unassigned",
          batteryLevel: Number.isInteger(d.batteryLevel) ? d.batteryLevel : null,
          isCharging: typeof d.isCharging === "boolean" ? d.isCharging : null,
          lastSeenAt: iso(d.lastSeenAt)
        };
      }),
      installments: uniqueDocs(primaryInstallments, legacyInstallments).map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          deviceId: d.deviceId || "",
          label: d.label || "",
          amountMinor: Number.isSafeInteger(d.amountMinor) ? d.amountMinor : 0,
          currencyCode: d.currencyCode || "KES",
          dueDate: iso(d.dueDate)
        };
      }),
      payments: uniqueDocs(primaryPayments, legacyPayments).map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          installmentId: d.installmentId || "",
          amountMinor: Number.isSafeInteger(d.amountMinor) ? d.amountMinor : 0,
          currencyCode: d.currencyCode || "KES",
          paidAt: iso(d.paidAt),
          reference: d.reference || ""
        };
      })
    });
  } catch (error) {
    console.error("My account data API failed:", error?.message || "Unknown error");
    return send(res, 500, { error: "Unable to load your account data right now." });
  }
}
