// Update to your TestFlight public link once available
const TESTFLIGHT_URL = 'https://testflight.apple.com/join/PLACEHOLDER';

export async function GET() {
  return Response.redirect(TESTFLIGHT_URL, 302);
}
