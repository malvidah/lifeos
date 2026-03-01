// Fetches Oura Ring data for a given date.
// daily_sleep → score + efficiency + total duration
// sleep (sessions) → lowest_heart_rate (RHR bpm) + average_hrv (ms)
// daily_readiness → readiness score

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0];
  const token = process.env.OURA_TOKEN;

  if (!token) return Response.json({ error: "OURA_TOKEN not set" }, { status: 401 });

  try {
    const [sleepRes, readinessRes, sessionRes] = await Promise.all([
      fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${date}&end_date=${date}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${date}&end_date=${date}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      // sleep sessions have the actual physiological RHR + HRV values
      fetch(`https://api.ouraring.com/v2/usercollection/sleep?start_date=${date}&end_date=${date}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

    const sleepData = await sleepRes.json();
    const readinessData = await readinessRes.json();
    const sessionData = await sessionRes.json();

    const daily = sleepData.data?.[0];
    const readiness = readinessData.data?.[0];
    // Use the longest sleep session (main sleep, not naps)
    const sessions = sessionData.data ?? [];
    const mainSession = sessions.sort((a, b) =>
      (b.total_sleep_duration ?? 0) - (a.total_sleep_duration ?? 0)
    )[0];

    const result = {};

    if (daily) {
      result.sleepScore = daily.score != null ? String(daily.score) : "";
      const totalSec = daily.contributors?.total_sleep_duration;
      result.sleepHrs = totalSec ? (totalSec / 3600).toFixed(1) : "";
      result.sleepQuality = daily.contributors?.sleep_efficiency != null
        ? String(daily.contributors.sleep_efficiency) : "";
    }

    if (readiness) {
      result.readinessScore = readiness.score != null ? String(readiness.score) : "";
    }

    if (mainSession) {
      // These are actual physiological values, not scores
      if (mainSession.lowest_heart_rate != null)
        result.rhr = String(Math.round(mainSession.lowest_heart_rate));
      if (mainSession.average_hrv != null)
        result.hrv = String(Math.round(mainSession.average_hrv));
      // Fallback sleep hours from session if daily didn't have it
      if (!result.sleepHrs && mainSession.total_sleep_duration)
        result.sleepHrs = (mainSession.total_sleep_duration / 3600).toFixed(1);
    }

    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
