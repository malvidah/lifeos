const FILE_URL = 'https://github.com/malvidah/lifeos/releases/download/v1.0.2/Day-Lab-1.0.2-arm64-mac.zip';

export async function GET() {
  return Response.redirect(FILE_URL, 302);
}
