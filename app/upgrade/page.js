export const metadata = { title: "Upgrade — Day Loop" };

export default function UpgradePage() {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0A0A0A", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Georgia, serif" }}>
        <div style={{ textAlign: "center", padding: "40px 24px", maxWidth: 480 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.2em", color: "#666", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 16 }}>Day Loop</div>
          <h1 style={{ fontSize: 32, color: "#f0ece4", margin: "0 0 12px", letterSpacing: "-0.02em", fontWeight: 400 }}>Upgrade to Premium</h1>
          <p style={{ fontSize: 14, color: "#888", lineHeight: 1.7, fontFamily: "monospace", margin: "0 0 40px" }}>
            AI insights, unlimited chat, and everything that makes Day Loop yours.
          </p>
          <p style={{ fontSize: 12, color: "#555", fontFamily: "monospace", lineHeight: 1.6 }}>
            Premium is in early access.<br/>
            Reach out at <a href="mailto:hello@dayloop.me" style={{ color: "#c4a882", textDecoration: "none" }}>hello@dayloop.me</a> to get on the list.
          </p>
          <div style={{ marginTop: 40 }}>
            <a href="/" style={{ fontFamily: "monospace", fontSize: 9, letterSpacing: "0.15em", textTransform: "uppercase", color: "#555", textDecoration: "none" }}>← back to dashboard</a>
          </div>
        </div>
      </body>
    </html>
  );
}
