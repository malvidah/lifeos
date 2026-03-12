async function estimateNutrition(prompt, token) {
  if (!token) return null;
  try {
    const r = await fetch("/api/ai",{method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
      body:JSON.stringify({model:"claude-haiku-4-5-20251001",max_tokens:80,
        system:"Return ONLY a valid JSON object with the requested integer fields. No explanation, no markdown, no backticks.",
        messages:[{role:"user",content:prompt}]})});
    const d = await r.json();
    if (d.error) return null;
    const text = d.content?.find(b=>b.type==="text")?.text||"{}";
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
    if (!parsed.kcal) return null;
    return parsed; // {kcal, protein} for meals, {kcal} for activities
  } catch { return null; }
}
