import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidInstallId,
  isValidEnrollmentCode,
  normalizeDevicePayload,
  isDeviceOwnedBy,
  isEnrollmentCodeUsable,
  isDeviceEnrolled
} from "../web/lib/device-validation.js";

const validDevice = {
  manufacturer: "Example",
  model: "Phone X",
  androidVersion: "14",
  appVersion: "1.0.0",
  managementMode: "standard_access",
  sdkInt: 34,
  batteryLevel: 72,
  isCharging: false,
  managementCapabilities: {
    deviceOwner: false,
    profileOwner: false,
    legacyDeviceAdmin: false,
    canApplyOwnerPolicies: false,
    lockTaskPermitted: false,
    batteryTelemetryAvailable: true
  }
};

test("accepts a standard UUID installation identifier and rejects malformed values", () => {
  assert.equal(isValidInstallId("550e8400-e29b-41d4-a716-446655440000"), true);
  assert.equal(isValidInstallId("not-a-uuid"), false);
  assert.equal(isValidInstallId("00000000-0000-0000-0000-000000000000"), false);
});

test("accepts only eight-character enrollment codes from the configured alphabet", () => {
  assert.equal(isValidEnrollmentCode("23456789"), true);
  assert.equal(isValidEnrollmentCode("ABCDEFGH"), true);
  assert.equal(isValidEnrollmentCode("ABC0EFGH"), false);
  assert.equal(isValidEnrollmentCode("SHORT"), false);
});

test("normalizes device capability reports without collecting persistent hardware identifiers", () => {
  const result = normalizeDevicePayload(validDevice);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, validDevice);
  assert.equal("imei" in result.value, false);
  assert.equal("serial" in result.value, false);
});

test("rejects missing, oversized, and unsupported device fields", () => {
  assert.equal(normalizeDevicePayload({ ...validDevice, model: "" }).ok, false);
  assert.equal(normalizeDevicePayload({ ...validDevice, manufacturer: "x".repeat(121) }).ok, false);
  assert.equal(normalizeDevicePayload({ ...validDevice, managementMode: "root_override" }).ok, false);
});

test("rejects malformed, unrecognized, or contradictory capability flags", () => {
  assert.equal(normalizeDevicePayload({ ...validDevice, managementCapabilities: { deviceOwner: "yes" } }).ok, false);
  assert.equal(normalizeDevicePayload({ ...validDevice, managementCapabilities: { wipeDevice: true } }).ok, false);
  assert.equal(normalizeDevicePayload({
    ...validDevice,
    managementMode: "device_owner",
    managementCapabilities: { ...validDevice.managementCapabilities, deviceOwner: false }
  }).ok, false);
});

test("rejects invalid Android, battery, and charging values", () => {
  assert.equal(normalizeDevicePayload({ ...validDevice, sdkInt: 20 }).ok, false);
  assert.equal(normalizeDevicePayload({ ...validDevice, batteryLevel: 101 }).ok, false);
  assert.equal(normalizeDevicePayload({ ...validDevice, isCharging: "yes" }).ok, false);
});

test("allows null battery fields when the device cannot report them", () => {
  const result = normalizeDevicePayload({ ...validDevice, batteryLevel: null, isCharging: null });
  assert.equal(result.ok, true);
  assert.equal(result.value.batteryLevel, null);
  assert.equal(result.value.isCharging, null);
});

test("device ownership is exact and does not allow cross-account access", () => {
  assert.equal(isDeviceOwnedBy({ ownerUid: "owner-a" }, "owner-a"), true);
  assert.equal(isDeviceOwnedBy({ ownerUid: "owner-a" }, "owner-b"), false);
  assert.equal(isDeviceOwnedBy(null, "owner-a"), false);
});

test("enrollment codes must be pending, unexpired, and owned by the signed-in account", () => {
  const code = { ownerUid: "owner-a", status: "pending", expiresAtMillis: 2000 };
  assert.equal(isEnrollmentCodeUsable(code, "owner-a", 1000), true);
  assert.equal(isEnrollmentCodeUsable(code, "owner-b", 1000), false);
  assert.equal(isEnrollmentCodeUsable({ ...code, status: "used" }, "owner-a", 1000), false);
  assert.equal(isEnrollmentCodeUsable(code, "owner-a", 2000), false);
});

test("only enrolled devices are eligible for active check-ins", () => {
  assert.equal(isDeviceEnrolled({ enrollmentStatus: "enrolled" }), true);
  assert.equal(isDeviceEnrolled({ enrollmentStatus: "unenrolled" }), false);
});
