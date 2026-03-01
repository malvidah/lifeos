// lib/storage.js
// Uses Vercel KV in production. Falls back to in-memory Map for local dev.

let _kv = null;
const devMap = new Map();

async function getKV() {
  if (_kv) return _kv;
  try {
    const mod = await import("@vercel/kv");
    _kv = mod.kv;
    return _kv;
  } catch {
    return null;
  }
}

export async function storageGet(key) {
  const db = await getKV();
  if (db) {
    try { return await db.get(key); } catch {}
  }
  return devMap.get(key) ?? null;
}

export async function storageSet(key, value) {
  const db = await getKV();
  if (db) {
    try { await db.set(key, value); return true; } catch {}
  }
  devMap.set(key, value);
  return true;
}
