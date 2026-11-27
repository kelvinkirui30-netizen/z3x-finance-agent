import test from "node:test";
import assert from "node:assert/strict";

const endpoints = [
  ["create enrollment code", "../web/api/create-enrollment-code.js"],
  ["enroll device", "../web/api/enroll-device.js"],
  ["device check-in", "../web/api/device-checkin.js"],
  ["unenroll device", "../web/api/unenroll-device.js"],
  ["revoke enrollment code", "../web/api/revoke-enrollment-code.js"],
  ["restore device enrollment", "../web/api/restore-device-enrollment.js"],
  ["my account data", "../web/api/my-account-data.js", "GET"],
  ["create device command", "../web/api/create-device-command.js"],
  ["fetch device commands", "../web/api/fetch-device-commands.js"],
  ["complete device command", "../web/api/complete-device-command.js"]
];

function mockResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

for (const [name, path, allowedMethod = "POST"] of endpoints) {
  test(`${name} handler imports and rejects unsupported methods`, async () => {
    const module = await import(path);
    assert.equal(typeof module.default, "function");

    const req = { method: allowedMethod === "GET" ? "POST" : "GET", headers: {} };
    const res = mockResponse();
    await module.default(req, res);

    assert.equal(res.statusCode, 405);
    assert.deepEqual(res.body, { error: "Method not allowed." });
    assert.equal(res.headers.Allow, allowedMethod);
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.equal(res.headers["X-Content-Type-Options"], "nosniff");
  });
}

test("admin dashboard handler imports and rejects non-GET requests", async () => {
  const module = await import("../web/api/admin-dashboard.js");
  assert.equal(typeof module.default, "function");
  const req = { method: "POST", headers: {} };
  const res = mockResponse();
  await module.default(req, res);
  assert.equal(res.statusCode, 405);
  assert.deepEqual(res.body, { error: "Method not allowed." });
  assert.equal(res.headers.Allow, "GET");
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(res.headers["X-Content-Type-Options"], "nosniff");
});
