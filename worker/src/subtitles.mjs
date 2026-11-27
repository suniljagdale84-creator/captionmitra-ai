function timestamp(seconds) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function segmentsToSrt(segments) {
  if (!Array.isArray(segments)) throw new Error("Transcript segments are required");
  const blocks = [];
  let previousEnd = 0;
  for (const segment of segments) {
    const start = Number(segment.start);
    const end = Number(segment.end);
    const text = typeof segment.text === "string" ? segment.text.trim() : "";
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || !text) {
      throw new Error("Invalid subtitle segment");
    }
    const safeText = text.replace(/\r?\n/g, " ").replace(/\u0000/g, "").trim();
    if (!safeText) continue;
    const adjustedStart = Math.max(start, previousEnd);
    const adjustedEnd = Math.max(end, adjustedStart + 0.05);
    blocks.push(`${blocks.length + 1}\n${timestamp(adjustedStart)} --> ${timestamp(adjustedEnd)}\n${safeText}`);
    previousEnd = adjustedEnd;
  }
  return blocks.length ? blocks.join("\n\n") + "\n" : "";
}
