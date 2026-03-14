// ─── Shared score persistence ─────────────────────────────────────────────────
// Single source of truth for mapping batchComputeScores output → health_scores rows.
// Used by /api/scores-backfill, /api/oura-backfill, /api/cron/oura-sync.

const BATCH = 200;

/**
 * Map an array of batchComputeScores results to health_scores rows and upsert.
 * @param {object} supabase  – authenticated Supabase client
 * @param {string} userId
 * @param {Array}  scored    – output of batchComputeScores()
 * @param {object} bestByDate – { [date]: health_metrics row } for winning_source lookup
 * @param {Array}  [datesToScore] – optional filter; only upsert these dates
 */
export async function persistScores(supabase, userId, scored, bestByDate, datesToScore) {
  const filtered = datesToScore
    ? scored.filter(s => datesToScore.includes(s.date))
    : scored;

  for (let i = 0; i < filtered.length; i += BATCH) {
    const chunk = filtered.slice(i, i + BATCH).map(s => ({
      user_id:         userId,
      date:            s.date,
      winning_source:  bestByDate[s.date]?.source ?? null,
      sleep_score:     s.sleepScore,
      readiness_score: s.readinessScore,
      activity_score:  s.activityScore,
      recovery_score:  s.recoveryScore,
      calibrated:      s.calibrated,
      contributors:    s.contributors,
      computed_at:     s.computedAt,
    }));
    const { error } = await supabase
      .from('health_scores')
      .upsert(chunk, { onConflict: 'user_id,date' });
    if (error) throw error;
  }

  return filtered.length;
}
