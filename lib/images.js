// ─── Image utilities ──────────────────────────────────────────────────────────

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
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ prompt: `Estimate for: "${text}". Return JSON: {"kcal":420,"protein":30}` }),
  });
  return res.json();
}

export async function uploadImageFile(file, token) {
  const { base64, mimeType } = await resizeImage(file);
  const res = await fetch('/api/upload-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ image: base64, mimeType, filename: file.name }),
  });
  const d = await res.json();
  return d.url || null;
}
