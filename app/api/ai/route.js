// Server-side proxy for Anthropic API — keeps ANTHROPIC_API_KEY out of the browser
export async function POST(request) {
  const body = await request.json();

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  const data = await r.json();
  return Response.json(data, { status: r.status });
}
