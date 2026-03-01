// lib/storage.js — server-side only, used by /api/data route
// Notes/meals/tasks use localStorage on the client (see Dashboard.jsx)
const devMap = new Map();
export async function storageGet(key) { return devMap.get(key) ?? null; }
export async function storageSet(key, value) { devMap.set(key, value); return true; }
