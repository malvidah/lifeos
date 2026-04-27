// ─── Image utilities ──────────────────────────────────────────────────────────
import { api } from "@/lib/api";

async function resizeImage(file, maxW = 1200, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    let settled = false;
    const cleanup = () => { try { URL.revokeObjectURL(url); } catch {} };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    };
    // 15s safety timeout — covers HEIC / corrupt files where onload silently
    // never fires. Without this the caller's Promise hangs forever.
    const timer = setTimeout(fail, 15000);
    img.onerror = fail;
    img.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        cleanup();
        canvas.toBlob(blob => resolve(blob || null), 'image/jpeg', quality);
      } catch {
        cleanup();
        resolve(null);
      }
    };
    img.src = url;
  });
}

export async function estimateNutrition(text, token) {
  return api.post('/api/ai', { prompt: `Estimate calories burned for this workout: "${text}".

Use MET values (metabolic equivalents) to ground your estimate. Reference:
walking=3.5, yoga=3, bouldering=5, rock climbing=5.8, hiking=6, cycling=7.5, swimming=8, weight training=5, running=9.8, HIIT=10, rowing=7, jump rope=12, dancing=5.5, martial arts=7, pilates=3.5, elliptical=5, stair climbing=9.

Formula: kcal = MET × body_weight_kg × duration_hours. Assume 70kg body weight.
If no duration is stated, infer a reasonable default for the activity (e.g. 30 min for a run, 60 min for climbing, 45 min for weight training).
If duration IS stated in the text, use that.

Only include dist_mi if a specific distance is stated in the text. Only include pace if a specific pace is stated. Do NOT guess distance or pace.
Return ONLY JSON: {"kcal":203} or {"kcal":343,"dist_mi":3.1} or {"kcal":343,"dist_mi":3.1,"pace":"9:20"}` }, token);
}

export async function uploadImageFile(file, token) {
  const blob = await resizeImage(file);
  // resizeImage returns null when the browser can't decode the file (HEIC,
  // corrupt, unsupported format). Bail before POSTing a null blob.
  if (!blob) return null;
  const form = new FormData();
  form.append('file', blob, file.name || 'image.jpg');
  const res = await fetch('/api/upload-image', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) return null;
  const d = await res.json();
  return d?.url ?? null;
}

export async function deleteImageFile(url, token) {
  const res = await fetch('/api/upload-image', {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
  });
  return res.ok;
}
