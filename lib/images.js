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
  return api.post('/api/ai', { prompt: `Estimate calories, distance in miles, and pace (min:sec per mile) for this workout: "${text}". If distance or pace don't apply (e.g. weight training, yoga), omit them. Return ONLY JSON: {"kcal":350,"dist_mi":3.1,"pace":"9:20"}` }, token);
}

export async function uploadImageFile(file, token) {
  const { base64, mimeType } = await resizeImage(file);
  const d = await api.post('/api/upload-image', { image: base64, mimeType, filename: file.name }, token);
  return d?.url ?? null;
}
