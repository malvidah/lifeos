const FILE_URL = 'https://github.com/malvidah/lifeos/releases/latest/download/Day.Loop-1.0.0-arm64.zip';

export async function GET() {
  const upstream = await fetch(FILE_URL, { redirect: 'follow' });
  if (!upstream.ok) return new Response('Download unavailable', { status: 502 });
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="Day Loop.zip"',
      'Content-Length': upstream.headers.get('content-length') || '',
      'Cache-Control': 'no-store',
    },
  });
}
