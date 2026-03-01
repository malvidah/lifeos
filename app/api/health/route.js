// app/api/health/route.js
// Receives pushes from Health Auto Export app or Apple Shortcuts
// Payload can be flexible — we normalize what we understand and store the rest raw.

import { storageSet, storageGet } from "../../../lib/storage";

function toKey(dateStr) {
  // Accept "2026-03-01", "2026-03-01T..." etc
  return dateStr ? dateStr.split("T")[0] : new Date().toISOString().split("T")[0];
}

export async function POST(request) {
  try {
    const body = await request.json();

    // Health Auto Export sends an array of metrics
    // Each metric: { name, units, data: [{ date, qty }] }
    const metrics = Array.isArray(body) ? body : body.data ?? [body];

    const updates = {}; // { dateKey: { field: value } }

    for (const metric of metrics) {
      const name = (metric.name || metric.metric || "").toLowerCase();
      const data = metric.data ?? [metric];

      for (const entry of data) {
        const date = toKey(entry.date ?? entry.startDate ?? entry.endDate);
        if (!updates[date]) updates[date] = {};

        const qty = parseFloat(entry.qty ?? entry.value ?? 0);

        // Map Apple Health metric names → our fields
        if (name.includes("sleep") && name.includes("duration")) {
          updates[date].sleepHrs = (qty / 3600).toFixed(1); // seconds → hours
        } else if (name.includes("heart_rate_variability") || name === "hrv") {
          updates[date].hrv = Math.round(qty).toString();
        } else if (name.includes("resting_heart_rate") || name === "resting hr") {
          updates[date].rhr = Math.round(qty).toString();
        } else if (name.includes("sleep") && name.includes("score")) {
          updates[date].sleepScore = (qty / 10).toFixed(1); // 0-100 → 0-10
        } else if (name.includes("active_energy") || name.includes("active calories")) {
          updates[date].activeKcal = Math.round(qty).toString();
        } else if (name.includes("step")) {
          updates[date].steps = Math.round(qty).toString();
        }
        // Store raw too so nothing is lost
        updates[date][`raw_${name.replace(/\s+/g, "_")}`] = qty;
      }
    }

    // Merge with existing stored health data for each date
    for (const [date, fields] of Object.entries(updates)) {
      const key = `los:${date}:health`;
      const existing = storageGet(key) ?? {};
      storageSet(key, { ...existing, ...fields });
    }

    return Response.json({ ok: true, dates: Object.keys(updates) });
  } catch (e) {
    console.error("Health webhook error:", e);
    return Response.json({ error: e.message }, { status: 400 });
  }
}

// Allow GET so you can verify the endpoint is live
export async function GET() {
  return Response.json({ status: "Life OS health endpoint ready", timestamp: new Date().toISOString() });
}
