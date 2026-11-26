import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify Razorpay's HMAC-SHA256 signature over the exact raw request body.
 * Never parse or re-serialize JSON before calling this function.
 */
export function verifyRazorpayWebhookSignature(rawBody, signature, secret) {
  if (!(typeof rawBody === "string" || Buffer.isBuffer(rawBody))) return false;
  if (typeof signature !== "string" || !/^[a-fA-F0-9]{64}$/.test(signature)) return false;
  if (typeof secret !== "string" || secret.length === 0) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(expected, supplied);
}
