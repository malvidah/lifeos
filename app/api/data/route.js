import { storageGet, storageSet } from "../../../lib/storage";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!key) return Response.json({ error: "key required" }, { status: 400 });
  const value = await storageGet(key);
  return Response.json({ key, value: value ?? null });
}

export async function POST(request) {
  const { key, value } = await request.json();
  if (!key) return Response.json({ error: "key required" }, { status: 400 });
  await storageSet(key, value);
  return Response.json({ ok: true, key });
}
