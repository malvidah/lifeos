// Fetches Oura Ring data for a given date range.
// Uses OURA_TOKEN env var (server-side, never exposed to browser).

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
      result.sleepScore = sleep.score != null ? (sleep.score / 10).toFixed(1) : "";
      const totalSec = sleep.contributors?.total_sleep_duration;
      result.sleepHrs = totalSec ? (totalSec / 3600).toFixed(1) : "";
      result.sleepQuality = sleep.contributors?.sleep_efficiency != null
        ? (sleep.contributors.sleep_efficiency / 10).toFixed(1) : "";
    }

    if (readiness) {
      result.recoveryScore = readiness.score != null ? (readiness.score / 10).toFixed(1) : "";
      result.hrv = readiness.contributors?.hrv_balance != null
        ? String(Math.round(readiness.contributors.hrv_balance)) : "";
      result.rhr = readiness.contributors?.resting_heart_rate != null
        ? String(Math.round(readiness.contributors.resting_heart_rate)) : "";
    }

    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
