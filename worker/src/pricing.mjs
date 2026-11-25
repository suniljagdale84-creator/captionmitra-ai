const RATE_PAISE_PER_SECOND = 5;
const MINIMUM_ORDER_PAISE = 1000;
const MAX_DURATION_SECONDS = 3 * 60 * 60;

/**
 * Price a media file from its verified FFprobe duration.
 * ₹3/minute = 5 paise/second. Fractions of a paise round up;
 * the minimum order amount is ₹10.
 */
export function calculatePricePaise(durationSeconds) {
  if (typeof durationSeconds !== "number" ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      durationSeconds > MAX_DURATION_SECONDS) {
    throw new Error("Invalid media duration");
  }

  const proratedPaise = Math.ceil(durationSeconds * RATE_PAISE_PER_SECOND);
  return Math.max(MINIMUM_ORDER_PAISE, proratedPaise);
}

export function calculatePriceRupees(durationSeconds) {
  return calculatePricePaise(durationSeconds) / 100;
}
