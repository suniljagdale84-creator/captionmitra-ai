import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

const webhookUrl = "/api/payments/razorpay-webhook";
const secret = "ci-webhook-secret-only";

function signedHeaders(rawBody: string, eventId = "evt_route_test") {
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
  return {
    "content-type": "application/json",
    "x-razorpay-signature": signature,
    "x-razorpay-event-id": eventId,
  };
}

test("rejects an invalid Razorpay signature before processing", async ({ request }) => {
  const response = await request.post(webhookUrl, {
    data: JSON.stringify({ event: "payment.captured" }),
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": "0".repeat(64),
      "x-razorpay-event-id": "evt_invalid_signature",
    },
  });

  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ error: "Invalid webhook signature." });
});

test("rejects malformed event identifiers even with a valid signature", async ({ request }) => {
  const raw = JSON.stringify({ event: "payment.captured" });
  const response = await request.post(webhookUrl, {
    data: raw,
    headers: signedHeaders(raw, "invalid event id"),
  });

  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ error: "Invalid webhook signature." });
});

test("rejects malformed JSON after validating the raw-body signature", async ({ request }) => {
  const raw = '{"event":';
  const response = await request.post(webhookUrl, {
    data: raw,
    headers: signedHeaders(raw),
  });

  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ error: "Invalid webhook payload." });
});

test("acknowledges a signed event type that this application does not process", async ({ request }) => {
  const raw = JSON.stringify({ event: "payment.authorized" });
  const response = await request.post(webhookUrl, {
    data: raw,
    headers: signedHeaders(raw),
  });

  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ received: true });
});

test("rejects webhook bodies larger than one mebibyte", async ({ request }) => {
  const raw = "x".repeat(1024 * 1024 + 1);
  const response = await request.post(webhookUrl, {
    data: raw,
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": "0".repeat(64),
      "x-razorpay-event-id": "evt_oversized",
    },
  });

  expect(response.status()).toBe(413);
});
