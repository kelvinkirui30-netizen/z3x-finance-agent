import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import createCode from "../web/api/create-enrollment-code.js";
import enrollDevice from "../web/api/enroll-device.js";
import checkIn from "../web/api/device-checkin.js";
import unenrollDevice from "../web/api/unenroll-device.js";
import revokeCode from "../web/api/revoke-enrollment-code.js";
import restoreEnrollment from "../web/api/restore-device-enrollment.js";

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const apiKey = "fake-api-key";

async function createUser(label) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `z3x-${label}-${randomUUID()}@example.test`,
      password: "test-password-123",
      returnSecureToken: true
    })
  });
  const data = await response.json();
  assert.equal(response.ok, true, JSON.stringify(data));
  return { token: data.idToken, uid: data.localId };
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

test("enrollment lifecycle enforces ownership, one-time use, check-in and unlinking", async () => {
  const owner = await createUser("owner");
  const other = await createUser("other");
  const created = await invoke(createCode, owner.token);
  assert.equal(created.statusCode, 200);
  assert.match(created.body.code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);

  const installId = randomUUID();
  const crossAccount = await invoke(enrollDevice, other.token, { code: created.body.code, installId, device });
  assert.equal(crossAccount.statusCode, 403);

  const invalid = await invoke(enrollDevice, owner.token, {
    code: created.body.code, installId, device: { ...device, sdkInt: 10 }
  });
  assert.equal(invalid.statusCode, 400);

  const enrolled = await invoke(enrollDevice, owner.token, { code: created.body.code, installId, device });
  assert.equal(enrolled.statusCode, 200);
  assert.equal(enrolled.body.success, true);

  const replay = await invoke(enrollDevice, owner.token, { code: created.body.code, installId, device });
  assert.equal(replay.statusCode, 410);

  const wrongOwnerCheckIn = await invoke(checkIn, other.token, { installId, device });
  assert.equal(wrongOwnerCheckIn.statusCode, 403);

  const validCheckIn = await invoke(checkIn, owner.token, { installId, device: { ...device, batteryLevel: 66 } });
  assert.equal(validCheckIn.statusCode, 200);

  const restored = await invoke(restoreEnrollment, owner.token, { installId });
  assert.equal(restored.statusCode, 200);
  const wrongAccountRestore = await invoke(restoreEnrollment, other.token, { installId });
  assert.equal(wrongAccountRestore.statusCode, 403);

  const unlinked = await invoke(unenrollDevice, owner.token, { installId });
  assert.equal(unlinked.statusCode, 200);

  const stoppedCheckIn = await invoke(checkIn, owner.token, { installId, device });
  assert.equal(stoppedCheckIn.statusCode, 410);
  const blockedRestore = await invoke(restoreEnrollment, owner.token, { installId });
  assert.equal(blockedRestore.statusCode, 410);
});

test("enrollment codes can be revoked only by their owner and then cannot enroll", async () => {
  const owner = await createUser("revoker");
  const other = await createUser("non-owner");
  const created = await invoke(createCode, owner.token);
  assert.equal(created.statusCode, 200);

  const forbidden = await invoke(revokeCode, other.token, { code: created.body.code });
  assert.equal(forbidden.statusCode, 403);

  const revoked = await invoke(revokeCode, owner.token, { code: created.body.code });
  assert.equal(revoked.statusCode, 200);

  const enrollment = await invoke(enrollDevice, owner.token, {
    code: created.body.code, installId: randomUUID(), device
  });
  assert.equal(enrollment.statusCode, 410);
});

test("enrollment code generation is rate limited per account", async () => {
  const owner = await createUser("rate-limit");
  const first = await invoke(createCode, owner.token);
  assert.equal(first.statusCode, 200);
  const second = await invoke(createCode, owner.token);
  assert.equal(second.statusCode, 429);
});

test("simultaneous redemption of one code can create only one enrollment", async () => {
  const owner = await createUser("race");
  const created = await invoke(createCode, owner.token);
  assert.equal(created.statusCode, 200);
  const payload = { code: created.body.code, installId: randomUUID(), device };
  const results = await Promise.all([
    invoke(enrollDevice, owner.token, payload),
    invoke(enrollDevice, owner.token, payload)
  ]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 410]);
});
