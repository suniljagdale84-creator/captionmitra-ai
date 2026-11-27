const STAGES = {
  queued: 0,
  downloading: 10,
  extracting_audio: 25,
  transcribing: 45,
  translating: 75,
  saving_result: 92,
  completed: 100,
  failed: 0
};

export async function updateJobProgress(pool, jobId, workerId, stage) {
  if (!Object.hasOwn(STAGES, stage) || stage === "queued" || stage === "completed" || stage === "failed") {
    throw new Error("Invalid worker progress stage");
  }
  const result = await pool.query(
    `UPDATE caption_jobs
     SET progress_stage = $3, progress_percent = $4,
         progress_updated_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'processing' AND locked_by = $2
     RETURNING id`,
    [jobId, workerId, stage, STAGES[stage]]
  );
  return Boolean(result.rows[0]);
}

export function getPublicProgress(status, stage, percent) {
  const safeStatus = ["awaiting_upload","uploaded","awaiting_payment","payment_failed","queued","processing","completed","processing_failed","expired","cancelled"].includes(status)
    ? status : "unknown";
  const validStage = Object.hasOwn(STAGES, stage);
  const safeStage = validStage ? stage : "queued";
  const numeric = Number(percent);
  const safePercent = !validStage || safeStatus === "unknown"
    ? STAGES[safeStage]
    : Number.isInteger(numeric) ? Math.max(0, Math.min(100, numeric)) : STAGES[safeStage];
  return { status: safeStatus, stage: safeStage, percent: safePercent };
}
