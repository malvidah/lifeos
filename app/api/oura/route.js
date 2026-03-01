// Fetches Oura Ring data for a given date.
// Uses OURA_TOKEN env var (server-side, never exposed to browser).
// - Scores (sleep, readiness) stay 0-100 as Oura shows them
// - RHR comes from daily_sleep.lowest_heart_rate (actual BPM)
// - HRV comes from daily_sleep.average_hrv (actual ms)

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0];
  const token = process.env.OURA_TOKEN;

  if (!token) return Response.json({ error: "OURA_TOKEN not set" }, { status: 401 });

  try {
    const [sleepRes, readinessRes] = await Promise.all([
      fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${date}&end_date=${date}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${date}&end_date=${date}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

    const sleepData = await sleepRes.json();
    const readinessData = await readinessRes.json();

    const sleep = sleepData.data?.[0];
    const readiness = readinessData.data?.[0];

    const result = {};

    if (sleep) {
      // Sleep score 0-100 as Oura shows it
      result.sleepScore = sleep.score != null ? String(sleep.score) : "";
      // Total sleep in hours
      const totalSec = sleep.contributors?.total_sleep_duration;
      result.sleepHrs = totalSec ? (totalSec / 3600).toFixed(1) : "";
      // Sleep efficiency as a percentage (0-100)
      result.sleepQuality = sleep.contributors?.sleep_efficiency != null
        ? String(sleep.contributors.sleep_efficiency) : "";
      // Actual RHR in BPM — lowest_heart_rate is the real physiological value
      result.rhr = sleep.lowest_heart_rate != null
        ? String(Math.round(sleep.lowest_heart_rate)) : "";
      // Actual HRV in ms — average_hrv is the real physiological value
      result.hrv = sleep.average_hrv != null
        ? String(Math.round(sleep.average_hrv)) : "";
    }

    if (readiness) {
      // Readiness score 0-100 as Oura shows it
      result.readinessScore = readiness.score != null ? String(readiness.score) : "";
    }

    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
