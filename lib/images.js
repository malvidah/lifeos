// ─── Image utilities ──────────────────────────────────────────────────────────
import { api } from "@/lib/api";

async function resizeImage(file, maxW = 1200, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => {
        const reader = new FileReader();
        reader.onload = () => resolve({ base64: reader.result.split(',')[1], mimeType: 'image/jpeg' });
        reader.readAsDataURL(blob);
      }, 'image/jpeg', quality);
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
  const { base64, mimeType } = await resizeImage(file);
  const d = await api.post('/api/upload-image', { image: base64, mimeType, filename: file.name }, token);
  return d?.url ?? null;
}
