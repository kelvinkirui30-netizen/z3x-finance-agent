import { createHash, createPublicKey } from "node:crypto";

export function normalizeDevicePublicKey(value) {
  if (typeof value !== "string" || value.length > 4096) {
    return { ok: false, error: "A valid device public key is required." };
  }
  try {
    const key = createPublicKey(value);
    const details = key.asymmetricKeyDetails || {};
    if (key.asymmetricKeyType !== "ec" || details.namedCurve !== "prime256v1") {
      return { ok: false, error: "Device key must use ECDSA P-256." };
    }
    const pem = key.export({ type: "spki", format: "pem" }).toString();
    const fingerprint = createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
    return { ok: true, pem, fingerprint };
  } catch {
    return { ok: false, error: "The device public key could not be parsed." };
  }
}

export function canonicalDevicePayload(device) {
  const sort = (value) => {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort(value[key])]));
    }
    return value;
  };
  return JSON.stringify(sort(device));
}
