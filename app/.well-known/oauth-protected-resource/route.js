// RFC9728 — OAuth 2.0 Protected Resource Metadata
// Claude fetches this first to discover the authorization server
export async function GET() {
  const base = 'https://dayloop.me';
  return Response.json({
    resource: `${base}/mcp`,
    authorization_servers: [`${base}`],
    bearer_methods_supported: ['header'],
    scopes_supported: ['dayloop'],
  }, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    }
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' }
  });
}
