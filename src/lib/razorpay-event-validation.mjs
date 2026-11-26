export function isValidCapturedPayment(payment) {
  return Boolean(
    payment &&
    typeof payment.id === "string" && payment.id.length > 0 &&
    typeof payment.order_id === "string" && payment.order_id.length > 0 &&
    Number.isSafeInteger(payment.amount) && payment.amount > 0 &&
    payment.currency === "INR" &&
    payment.status === "captured"
  );
}

export function isValidFailedPayment(payment) {
  return Boolean(
    payment &&
    typeof payment.id === "string" && payment.id.length > 0 &&
    typeof payment.order_id === "string" && payment.order_id.length > 0 &&
    payment.status === "failed"
  );
}

export function isValidRefund(refund, expectedStatus) {
  return Boolean(
    refund &&
    typeof refund.id === "string" && refund.id.length > 0 &&
    typeof refund.payment_id === "string" && refund.payment_id.length > 0 &&
    Number.isSafeInteger(refund.amount) && refund.amount > 0 &&
    refund.currency === "INR" &&
    (expectedStatus === "processed" || expectedStatus === "failed") &&
    refund.status === expectedStatus
  );
}
