const ARM_URL   = 'https://github.com/malvidah/lifeos/releases/download/v1.0.2/Day.Lab-1.0.2-arm64.dmg';
const INTEL_URL = 'https://github.com/malvidah/lifeos/releases/download/v1.0.2/Day.Lab-1.0.2.dmg';

export async function GET() {
  // Serve a tiny HTML page that detects architecture via JS then auto-redirects.
  // navigator.userAgentData.getHighEntropyValues works in Chrome/Edge.
  // Safari doesn't support it — defaults to arm64 (correct for all Macs since late 2020).
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Downloading Day Lab…</title>
  <style>
    body { background: #0D0C10; color: #ccc; font-family: ui-monospace, monospace;
           display: flex; align-items: center; justify-content: center;
           min-height: 100vh; margin: 0; flex-direction: column; gap: 16px; }
    p { font-size: 13px; color: #666; margin: 0; }
    a { color: #888; font-size: 11px; }
  </style>
</head>
<body>
  <p id="msg">Detecting your Mac…</p>
  <p><a id="fallback" href="${ARM_URL}">Click here if your download doesn't start</a></p>
  <p style="margin-top:8px"><a href="${INTEL_URL}">Intel Mac? Download here instead</a></p>
  <script>
    async function detect() {
      if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
        try {
          const data = await navigator.userAgentData.getHighEntropyValues(['architecture']);
          return data.architecture === 'arm' ? 'arm64' : 'x64';
        } catch(e) {}
      }
      return 'arm64'; // Safe default — all modern Macs are Apple Silicon
    }
    detect().then(function(arch) {
      const url = arch === 'arm64' ? '${ARM_URL}' : '${INTEL_URL}';
      document.getElementById('msg').textContent =
        arch === 'arm64' ? 'Downloading for Apple Silicon (M1/M2/M3/M4)…' : 'Downloading for Intel Mac…';
      document.getElementById('fallback').href = url;
      window.location.href = url;
    });
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}
