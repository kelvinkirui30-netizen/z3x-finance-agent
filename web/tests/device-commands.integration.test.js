import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getApps, initializeApp } from "firebase-admin/app";
import createCommand from "../api/create-device-command.js";
import fetchCommands from "../api/fetch-device-commands.js";
import completeCommand from "../api/complete-device-command.js";

const projectId = process.env.FIREBASE_PROJECT_ID || "demo-z3x-finance-agent";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const apiKey = "fake-api-key";
const app = getApps()[0] || initializeApp({ projectId });
const auth = getAuth(app);
const db = getFirestore(app);

async function createUser(label, role) {
  const email = `command-${label}-${randomUUID()}@example.test`;
  const password = "test-password-123";
  const signUp = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const created = await signUp.json();
  assert.equal(signUp.ok, true, JSON.stringify(created));
  if (role) await auth.setCustomUserClaims(created.localId, { role });
  const signIn = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const session = await signIn.json();
  assert.equal(signIn.ok, true, JSON.stringify(session));
  return { uid: created.localId, token: session.idToken };
}

function responseMock() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

async function invoke(handler, token, body) {
  const req = { method: "POST", headers: { authorization: `Bearer ${token}` }, body };
  const res = responseMock();
  await handler(req, res);
  return res;
}

test("device commands are role-gated, owner-scoped, expiring and protected against replay", async () => {
  const owner = await createUser("owner");
  const other = await createUser("other");
  const admin = await createUser("admin", "admin");
  const installId = randomUUID();
  await db.collection("devices").doc(installId).set({
    ownerUid: owner.uid,
    enrollmentStatus: "enrolled",
    model: "Test Phone"
  });

  const denied = await invoke(createCommand, owner.token, {
    deviceId: installId, command: "display_notice", payload: { message: "Hello" }
  });
  assert.equal(denied.statusCode, 403);

  const invalid = await invoke(createCommand, admin.token, {
    deviceId: installId, command: "factory_reset", payload: {}
  });
  assert.equal(invalid.statusCode, 400);

  const created = await invoke(createCommand, admin.token, {
    deviceId: installId, command: "display_notice", payload: { message: "Please open the app." }, ttlSeconds: 600
  });
  assert.equal(created.statusCode, 201);

  const wrongOwner = await invoke(fetchCommands, other.token, { installId });
  assert.equal(wrongOwner.statusCode, 403);

  const delivered = await invoke(fetchCommands, owner.token, { installId });
  assert.equal(delivered.statusCode, 200);
  assert.equal(delivered.body.commands.length, 1);
  const command = delivered.body.commands[0];
  assert.equal(command.command, "display_notice");
  assert.equal(command.payload.message, "Please open the app.");

  const replay = await invoke(completeCommand, owner.token, {
    installId, commandId: command.commandId, nonce: "0".repeat(64), outcome: "success"
  });
  assert.equal(replay.statusCode, 403);

  const completed = await invoke(completeCommand, owner.token, {
    installId, commandId: command.commandId, nonce: command.nonce,
    outcome: "success", message: "Notice saved."
  });
  assert.equal(completed.statusCode, 200);

  const duplicate = await invoke(completeCommand, owner.token, {
    installId, commandId: command.commandId, nonce: command.nonce, outcome: "success"
  });
  assert.equal(duplicate.statusCode, 409);

  const expiring = await invoke(createCommand, admin.token, {
    deviceId: installId, command: "request_check_in", ttlSeconds: 60
  });
  assert.equal(expiring.statusCode, 201);
  await db.collection("device_commands").doc(expiring.body.commandId).update({
    expiresAt: Timestamp.fromMillis(Date.now() - 1000)
  });
  const expired = await invoke(fetchCommands, owner.token, { installId });
  assert.equal(expired.statusCode, 200);
  assert.equal(expired.body.commands.length, 0);
  const expiredDoc = await db.collection("device_commands").doc(expiring.body.commandId).get();
  assert.equal(expiredDoc.data().status, "expired");
});
