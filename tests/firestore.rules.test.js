import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, setDoc } from "firebase/firestore";

const projectId = "demo-z3x-finance-agent";
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8")
    }
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "devices/device-a"), { ownerUid: "owner-a", model: "Test Model" });
    await setDoc(doc(db, "devices/device-b"), { ownerUid: "owner-b", model: "Other Model" });
    await setDoc(doc(db, "device_locations/location-a"), { ownerUid: "owner-a", deviceId: "device-a" });
    await setDoc(doc(db, "device_installments/installment-a"), {
      ownerUid: "owner-a", deviceId: "device-a", amountMinor: 5000, currencyCode: "KES"
    });
  });
});

after(async () => {
  await env?.cleanup();
});

function user(uid, role) {
  return env.authenticatedContext(uid, role ? { role } : {}).firestore();
}

test("normal users can read their own device but not another user's device", async () => {
  await assertSucceeds(getDoc(doc(user("owner-a"), "devices/device-a")));
  await assertFails(getDoc(doc(user("owner-a"), "devices/device-b")));
});

test("Admin can read device inventory", async () => {
  await assertSucceeds(getDoc(doc(user("admin-a", "admin"), "devices/device-b")));
});

test("Assistant cannot read another user's device location", async () => {
  await assertFails(getDoc(doc(user("assistant-a", "assistant"), "device_locations/location-a")));
});

test("device owner and Admin can read location records", async () => {
  await assertSucceeds(getDoc(doc(user("owner-a"), "device_locations/location-a")));
  await assertSucceeds(getDoc(doc(user("admin-a", "admin"), "device_locations/location-a")));
});

test("Assistant cannot read another user's finance record", async () => {
  await assertFails(getDoc(doc(user("assistant-a", "assistant"), "device_installments/installment-a")));
});

test("finance record owner and Admin can read the record", async () => {
  await assertSucceeds(getDoc(doc(user("owner-a"), "device_installments/installment-a")));
  await assertSucceeds(getDoc(doc(user("admin-a", "admin"), "device_installments/installment-a")));
});

test("clients cannot create audit records or device inventory records", async () => {
  const db = user("owner-a");
  await assertFails(setDoc(doc(db, "audit_logs/client-forged"), { action: "fake" }));
  await assertFails(setDoc(doc(db, "devices/client-forged"), { ownerUid: "owner-a" }));
});

test("Assistant cannot queue privileged device commands", async () => {
  const db = user("assistant-a", "assistant");
  await assertFails(setDoc(doc(db, "device_commands/assistant-command"), {
    deviceId: "device-a", command: "display_notice", payload: {}, status: "pending",
    createdAt: new Date(), createdBy: "assistant-a"
  }));
});

test("device commands can only be created, read and acknowledged through trusted server APIs", async () => {
  const db = user("admin-a", "admin");
  await assertFails(setDoc(doc(db, "device_commands/admin-command"), {
    deviceId: "device-a", command: "display_notice", payload: { message: "Please open the app." },
    status: "pending", createdAt: new Date(), createdBy: "admin-a"
  }));
  await assertFails(getDoc(doc(db, "device_commands/admin-command")));
});

test("users cannot grant themselves a staff role through their profile", async () => {
  const db = user("owner-a");
  await assertFails(setDoc(doc(db, "users/owner-a"), { displayName: "Owner", role: "super_admin" }));
});
