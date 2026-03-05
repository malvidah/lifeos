const TESTFLIGHT_URL = 'https://testflight.apple.com/join/8EaKTz9r';

export async function GET() {
  return Response.redirect(TESTFLIGHT_URL, 302);
}
