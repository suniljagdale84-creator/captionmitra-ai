/** Compare provider amounts with PostgreSQL BIGINT values safely. */
export function razorpayAmountMatches(databaseAmount, providerAmount) {
  const stored = typeof databaseAmount === "string" && /^\d+$/.test(databaseAmount)
    ? Number(databaseAmount)
    : databaseAmount;
  return Number.isSafeInteger(stored) &&
    Number.isSafeInteger(providerAmount) &&
    stored === providerAmount;
}
