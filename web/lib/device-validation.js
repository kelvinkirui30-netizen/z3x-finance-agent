export const MANAGEMENT_MODES = new Set([
  "device_owner",
  "profile_owner",
  "device_admin",
  "standard_access"
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/;
const CAPABILITY_KEYS = [
  "deviceOwner",
  "profileOwner",
  "legacyDeviceAdmin",
  "canApplyOwnerPolicies",
  "lockTaskPermitted",
  "batteryTelemetryAvailable"
];

export function isValidInstallId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isValidEnrollmentCode(value) {
  return typeof value === "string" && CODE_PATTERN.test(value);
}

export function normalizeDevicePayload(input = {}) {
  const fields = ["manufacturer", "model", "androidVersion", "appVersion", "managementMode"];
  const device = {};
  for (const key of fields) {
    const value = input[key];
    if (typeof value !== "string" || !value.trim() || value.length > 120) {
      return { ok: false, error: "Device information is incomplete or invalid." };
    }
    device[key] = value.trim();
  }
  if (!MANAGEMENT_MODES.has(device.managementMode)) {
    return { ok: false, error: "Unsupported device management mode." };
  }
  const sdkInt = Number(input.sdkInt);
  if (!Number.isInteger(sdkInt) || sdkInt < 21 || sdkInt > 100) {
    return { ok: false, error: "Invalid Android API level." };
  }
  const batteryLevel = input.batteryLevel == null ? null : Number(input.batteryLevel);
  if (batteryLevel !== null && (!Number.isInteger(batteryLevel) || batteryLevel < 0 || batteryLevel > 100)) {
    return { ok: false, error: "Invalid battery level." };
  }
  const isCharging = input.isCharging == null ? null : input.isCharging;
  if (isCharging !== null && typeof isCharging !== "boolean") {
    return { ok: false, error: "Invalid charging state." };
  }
  const suppliedCapabilities = input.managementCapabilities ?? {};
  if (!suppliedCapabilities || typeof suppliedCapabilities !== "object" ||
      Array.isArray(suppliedCapabilities) ||
      Object.keys(suppliedCapabilities).some((key) => !CAPABILITY_KEYS.includes(key)) ||
      Object.values(suppliedCapabilities).some((value) => typeof value !== "boolean")) {
    return { ok: false, error: "Invalid management capability report." };
  }
  const managementCapabilities = Object.fromEntries(
    CAPABILITY_KEYS.filter((key) => key in suppliedCapabilities)
      .map((key) => [key, suppliedCapabilities[key]])
  );
  if (Object.keys(managementCapabilities).length > 0) {
    const modeMatches =
      (device.managementMode !== "device_owner" || managementCapabilities.deviceOwner === true) &&
      (device.managementMode !== "profile_owner" || managementCapabilities.profileOwner === true) &&
      (device.managementMode !== "device_admin" || managementCapabilities.legacyDeviceAdmin === true) &&
      (device.managementMode !== "standard_access" ||
        (managementCapabilities.deviceOwner !== true &&
         managementCapabilities.profileOwner !== true &&
         managementCapabilities.legacyDeviceAdmin !== true));
    if (!modeMatches) return { ok: false, error: "Management mode does not match the reported Android capabilities." };
  }
  return {
    ok: true,
    value: { ...device, sdkInt, batteryLevel, isCharging, managementCapabilities }
  };
}

export function isDeviceOwnedBy(device, uid) {
  return Boolean(device && typeof uid === "string" && uid && device.ownerUid === uid);
}

export function isEnrollmentCodeUsable(code, uid, nowMillis = Date.now()) {
  return Boolean(
    code &&
    code.ownerUid === uid &&
    code.status === "pending" &&
    Number.isFinite(code.expiresAtMillis) &&
    code.expiresAtMillis > nowMillis
  );
}

export function isDeviceEnrolled(device) {
  return device?.enrollmentStatus === "enrolled";
}
