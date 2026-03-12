async function dbSave(date,type,data,token) {
  if (!token) return;
  const url="/api/entries";
  const body=JSON.stringify({date,type,data});
  const headers={"Content-Type":"application/json","Authorization":`Bearer ${token}`};
  // sendBeacon is fire-and-forget and survives iOS page suspension
  // We encode auth in the body since Beacon can't set custom headers
  try {
    await fetch(url,{method:"POST",headers,body});
  } catch(e) {
    // Fallback: sendBeacon (no custom headers, but works during suspension)
    if (navigator.sendBeacon) {
      const blob = new Blob([body],{type:"application/json"});
      navigator.sendBeacon(url+"?token="+encodeURIComponent(token), blob);
    }
  }
}
export async function dbLoad(date,type,token) {
  if (!token) return null;
  try {
    const r = await fetch(`/api/entries?date=${date}&type=${type}`,{headers:{"Authorization":`Bearer ${token}`}});
    if (!r.ok) return null;
    return (await r.json()).data ?? null;
  } catch { return null; }
}
