import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createCustomerAccessToken() {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashCustomerAccessToken(token) };
}

export function hashCustomerAccessToken(token) {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
    throw new Error("Invalid customer access token");
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function verifyCustomerAccessToken(token, storedHash) {
  if (typeof storedHash !== "string" || !/^[a-f0-9]{64}$/i.test(storedHash)) return false;
  let candidate;
  try { candidate = Buffer.from(hashCustomerAccessToken(token), "hex"); }
  catch { return false; }
  const expected = Buffer.from(storedHash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
