const FILE_URL = 'https://github.com/malvidah/lifeos/releases/download/v1.0.1/Day-Lab-1.0.1-arm64.dmg';

export async function GET() {
  return Response.redirect(FILE_URL, 302);
}
