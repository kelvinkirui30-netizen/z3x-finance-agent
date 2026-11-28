import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed." });
  }
  try {
    const { auth, db } = services();
    const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
    if (!match) return send(res, 401, { error: "Sign in is required." });
    const actor = await auth.verifyIdToken(match[1], !process.env.FIRESTORE_EMULATOR_HOST);
    const actorRole = actor.role || "user";
    if (!STAFF_ROLES.has(actorRole)) {
      return send(res, 403, { error: "Only Admin or Super Admin can assign company devices." });
    }

    const deviceId = String(req.body?.deviceId || "").trim();
    const customerEmail = String(req.body?.customerEmail || "").trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)) {
      return send(res, 400, { error: "Invalid device identifier." });
    }
    if (customerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      return send(res, 400, { error: "Enter the customer's registered email address." });
    }

    let customer;
    try {
      customer = await auth.getUserByEmail(customerEmail);
    } catch (error) {
      if (error?.code === "auth/user-not-found") {
        return send(res, 404, { error: "No account exists for that email. Ask the customer to create their account first." });
      }
      throw error;
    }
    if (customer.disabled) return send(res, 409, { error: "This customer account is disabled." });
    if (STAFF_ROLES.has(customer.customClaims?.role || "user")) {
      return send(res, 400, { error: "A company staff account cannot be assigned as a customer." });
    }

    const deviceRef = db.collection("devices").doc(deviceId);
    await db.runTransaction(async (tx) => {
      const deviceSnap = await tx.get(deviceRef);
      if (!deviceSnap.exists) throw Object.assign(new Error("Device inventory record not found."), { status: 404 });
      const device = deviceSnap.data();
      if (device.enrollmentStatus !== "enrolled") {
        throw Object.assign(new Error("Only an enrolled company device can be assigned."), { status: 409 });
      }
      if (actorRole !== "super_admin" && device.ownerUid !== actor.uid) {
        throw Object.assign(new Error("Admins can assign only devices in their authorized inventory."), { status: 403 });
      }
      if (device.assignedCustomerUid && device.assignmentStatus === "active") {
        throw Object.assign(new Error("This device is already assigned. Complete its approved return/release workflow before reassignment."), { status: 409 });
      }
      tx.update(deviceRef, {
        assignedCustomerUid: customer.uid,
        assignedCustomerEmail: customer.email || customerEmail,
        assignmentStatus: "active",
        assignedAt: FieldValue.serverTimestamp(),
        assignedByUid: actor.uid,
        updatedAt: FieldValue.serverTimestamp()
      });
      tx.create(db.collection("audit_logs").doc(), {
        action: "device_assigned_to_customer",
        actorUid: actor.uid,
        actorEmail: actor.email || "",
        targetDeviceId: deviceId,
        customerUid: customer.uid,
        customerEmail: customer.email || customerEmail,
        createdAt: FieldValue.serverTimestamp()
      });
    });

    return send(res, 200, {
      success: true,
      deviceId,
      customerUid: customer.uid,
      customerEmail: customer.email || customerEmail,
      message: "Company device assigned to the customer account."
    });
  } catch (error) {
    return send(res, error.status || 500, {
      error: error.status ? error.message : "Unable to assign this device. Please try again."
    });
  }
}
