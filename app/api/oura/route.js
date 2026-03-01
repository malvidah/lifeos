export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0];
  const debug = searchParams.get("debug") === "1";
  const token = process.env.OURA_TOKEN;

  if (!token) return Response.json({ error: "OURA_TOKEN not set" }, { status: 401 });

  try {
    const prev2 = new Date(date);
    prev2.setDate(prev2.getDate() - 2);
    const prevDate2 = prev2.toISOString().split("T")[0];

    const [sleepRes, readinessRes, sessionRes] = await Promise.all([
      fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${date}&end_date=${date}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${date}&end_date=${date}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`https://api.ouraring.com/v2/usercollection/sleep?start_date=${prevDate2}&end_date=${date}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

    const sleepData = await sleepRes.json();
    const readinessData = await readinessRes.json();
    const sessionData = await sessionRes.json();

    if (debug) return Response.json({ sleepData, readinessData, sessionData });

    const daily = sleepData.data?.[0];
    const readiness = readinessData.data?.[0];

    // Pick the long_sleep session — this has average_hrv and lowest_heart_rate populated
    // Session `day` = when you went to bed, so the relevant session is 1-2 days before `date`
    const sessions = sessionData.data ?? [];
    const mainSession = sessions
      .filter(s => s.type === "long_sleep")
      .sort((a, b) => (b.total_sleep_duration ?? 0) - (a.total_sleep_duration ?? 0))[0];

    const result = {};

    if (daily) {
      result.sleepScore = daily.score != null ? String(daily.score) : "";
      result.sleepQuality = daily.contributors?.sleep_efficiency != null
        ? String(daily.contributors.sleep_efficiency) : "";
    }

    if (readiness) {
      result.readinessScore = readiness.score != null ? String(readiness.score) : "";
    }

    if (mainSession) {
      if (mainSession.lowest_heart_rate != null)
        result.rhr = String(Math.round(mainSession.lowest_heart_rate));
      if (mainSession.average_hrv != null)
        result.hrv = String(Math.round(mainSession.average_hrv));
      if (mainSession.total_sleep_duration)
        result.sleepHrs = (mainSession.total_sleep_duration / 3600).toFixed(1);
      if (!result.sleepQuality && mainSession.efficiency)
        result.sleepQuality = String(mainSession.efficiency);
    }

    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
