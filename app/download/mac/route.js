const FILE_URL = 'https://github.com/malvidah/lifeos/releases/download/v1.0.0/Day.Loop.1.0.0.zip';

export async function GET() {
  return Response.redirect(FILE_URL, 302);
}
