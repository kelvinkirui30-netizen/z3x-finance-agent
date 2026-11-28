import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import createCode from "../web/api/create-enrollment-code.js";
import deviceChallenge from "../web/api/device-challenge.js";
import { deviceSignatureMessage } from "../web/api/device-checkin.js";
import enrollDevice from "../web/api/enroll-device.js";
import checkIn from "../web/api/device-checkin.js";
import unenrollDevice from "../web/api/unenroll-device.js";
import revokeCode from "../web/api/revoke-enrollment-code.js";
import restoreEnrollment from "../web/api/restore-device-enrollment.js";
import myAccountData from "../web/api/my-account-data.js";
import { createRequire } from "node:module";
const requireWeb = createRequire(new URL("../web/package.json", import.meta.url));
const { getApps, initializeApp } = requireWeb("firebase-admin/app");
const { getAuth } = requireWeb("firebase-admin/auth");
import assignDevice from "../web/api/assign-device-to-customer.js";

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const apiKey = "fake-api-key";

async function createUser(label, role = "admin") {
  const email = `z3x-${label}-${randomUUID()}@example.test`;
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "test-password-123",
      returnSecureToken: true
    })
  });
  const data = await response.json();
  assert.equal(response.ok, true, JSON.stringify(data));
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= authHost;
  const adminApp = getApps()[0] || initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || "demo-z3x-finance-agent"
  });
  await getAuth(adminApp).setCustomUserClaims(data.localId, { role });
  const signInResponse = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "test-password-123", returnSecureToken: true })
  });
  const signedIn = await signInResponse.json();
  assert.equal(signInResponse.ok, true, JSON.stringify(signedIn));
  return { token: signedIn.idToken, uid: data.localId, email };
}

function responseMock() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}
async function invoke(handler, token, body = {}, method = "POST") {
  const req = { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body };
  const res = responseMock();
  await handler(req, res);
  return res;
}
const keyPair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicKeyPem = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();

const device = {
  manufacturer: "Test Manufacturer",
  model: "Test Device",
  androidVersion: "14",
  appVersion: "1.0.0",
  managementMode: "standard_access",
  sdkInt: 34,
  batteryLevel: 67,
  isCharging: false
};

test("company device assignment is staff-controlled and visible only to the assigned customer", async () => {
  const admin = await createUser("assign-admin", "admin");
  const customer = await createUser("assigned-customer", "user");
  const otherCustomer = await createUser("unassigned-customer", "user");
  const created = await invoke(createCode, admin.token);
  assert.equal(created.statusCode, 200);

  const installId = randomUUID();
  const enrolled = await invoke(enrollDevice, admin.token, { code: created.body.code, installId, device, publicKeyPem });
  assert.equal(enrolled.statusCode, 200);

  const assigned = await invoke(assignDevice, admin.token, { deviceId: installId, customerEmail: customer.email });
  assert.equal(assigned.statusCode, 200);
  assert.equal(assigned.body.customerUid, customer.uid);

  const customerData = await invoke(myAccountData, customer.token, {}, "GET");
  assert.equal(customerData.statusCode, 200);
  assert.equal(customerData.body.devices.some((item) => item.id === installId), true);

  const otherData = await invoke(myAccountData, otherCustomer.token, {}, "GET");
  assert.equal(otherData.statusCode, 200);
  assert.equal(otherData.body.devices.some((item) => item.id === installId), false);

  const reassign = await invoke(assignDevice, admin.token, { deviceId: installId, customerEmail: otherCustomer.email });
  assert.equal(reassign.statusCode, 409);
});

test("ordinary customer cannot generate enrollment codes or unlink company devices", async () => {
  const admin = await createUser("staff", "admin");
  const customer = await createUser("ordinary", "user");
  const deniedCode = await invoke(createCode, customer.token);
  assert.equal(deniedCode.statusCode, 403);

  const created = await invoke(createCode, admin.token);
  const installId = randomUUID();
  const enrolled = await invoke(enrollDevice, admin.token, { code: created.body.code, installId, device, publicKeyPem });
  assert.equal(enrolled.statusCode, 200);

  const deniedUnlink = await invoke(unenrollDevice, customer.token, { installId });
  assert.equal(deniedUnlink.statusCode, 403);
  const staffUnlink = await invoke(unenrollDevice, admin.token, { installId });
  assert.equal(staffUnlink.statusCode, 409);

  const restore = await invoke(restoreEnrollment, admin.token, { installId });
  assert.equal(restore.statusCode, 200);
});

test("enrollment codes can be revoked only by their staff owner and then cannot enroll", async () => {
  const owner = await createUser("revoker", "admin");
  const other = await createUser("non-owner", "admin");
  const created = await invoke(createCode, owner.token);
  assert.equal(created.statusCode, 200);
  const forbidden = await invoke(revokeCode, other.token, { code: created.body.code });
  assert.equal(forbidden.statusCode, 403);
  const revoked = await invoke(revokeCode, owner.token, { code: created.body.code });
  assert.equal(revoked.statusCode, 200);
  const enrollment = await invoke(enrollDevice, owner.token, {
    code: created.body.code, installId: randomUUID(), device, publicKeyPem
  });
  assert.equal(enrollment.statusCode, 410);
});

test("enrollment code generation is rate limited per staff account", async () => {
  const owner = await createUser("rate-limit", "admin");
  const first = await invoke(createCode, owner.token);
  assert.equal(first.statusCode, 200);
  const second = await invoke(createCode, owner.token);
  assert.equal(second.statusCode, 429);
});

test("simultaneous redemption of one code can create only one company device enrollment", async () => {
  const owner = await createUser("race", "admin");
  const created = await invoke(createCode, owner.token);
  assert.equal(created.statusCode, 200);
  const payload = { code: created.body.code, installId: randomUUID(), device, publicKeyPem };
  const results = await Promise.all([
    invoke(enrollDevice, owner.token, payload),
    invoke(enrollDevice, owner.token, payload)
  ]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 410]);
});
