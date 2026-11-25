import test from "node:test";
import assert from "node:assert/strict";
import { createCustomerAccessToken, hashCustomerAccessToken, verifyCustomerAccessToken } from "../src/customer-access-token.mjs";

test("creates a random token and stores only its digest", () => {
  const result = createCustomerAccessToken();
  assert.equal(result.token.length, 43);
  assert.match(result.tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(verifyCustomerAccessToken(result.token, result.tokenHash), true);
});

test("rejects wrong and malformed tokens", () => {
  const result = createCustomerAccessToken();
  assert.equal(verifyCustomerAccessToken("A".repeat(43), result.tokenHash), false);
  assert.equal(verifyCustomerAccessToken("invalid", result.tokenHash), false);
  assert.throws(() => hashCustomerAccessToken("invalid"), /Invalid customer access token/);
});

test("independent tokens have different digests", () => {
  assert.notEqual(createCustomerAccessToken().tokenHash, createCustomerAccessToken().tokenHash);
});
