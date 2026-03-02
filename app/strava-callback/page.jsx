"use client";
import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase.js";

export default function StravaCallback() {
  const [status, setStatus] = useState("Connecting to Strava…");
  const [done, setDone]     = useState(false);
  const [err, setErr]       = useState(false);

  useEffect(() => {
    const code  = new URLSearchParams(window.location.search).get("code");
    const error = new URLSearchParams(window.location.search).get("error");

    if (error) { setStatus("Authorization denied by Strava."); setErr(true); return; }
    if (!code)  { setStatus("No authorization code received."); setErr(true); return; }

    (async () => {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setStatus("Not logged in — please sign in first."); setErr(true); return; }

        // Load client credentials from settings
        const settingsRes = await fetch("/api/entries?date=global&type=settings", {
          headers: { Authorization: `Bearer ${session.access_token}` }
        });
        const settingsData = await settingsRes.json();
        const clientId     = settingsData?.data?.stravaClientId;
        const clientSecret = settingsData?.data?.stravaClientSecret;

        if (!clientId || !clientSecret) {
          setStatus("Strava Client ID and Secret not found in settings. Please save them first.");
          setErr(true); return;
        }

        setStatus("Exchanging authorization code…");

        // Exchange code for tokens
        const tokenRes = await fetch("https://www.strava.com/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: "authorization_code",
          }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) {
          setStatus("Token exchange failed: " + (tokenData.message || JSON.stringify(tokenData)));
          setErr(true); return;
        }

        // Store tokens in DB
        await fetch("/api/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            date: "0000-00-00",
            type: "strava_token",
            data: {
              access_token:  tokenData.access_token,
              refresh_token: tokenData.refresh_token,
              expires_at:    tokenData.expires_at,
              athlete:       tokenData.athlete?.firstname + " " + tokenData.athlete?.lastname,
            },
          }),
        });

        setStatus("✓ Strava connected! You can close this tab.");
        setDone(true);
        setTimeout(() => window.close(), 2000);
      } catch (e) {
        setStatus("Error: " + e.message);
        setErr(true);
      }
    })();
  }, []);

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#0D0D0F", color: "#E8E4DC", fontFamily: "system-ui, sans-serif",
    }}>
      <div style={{ textAlign: "center", maxWidth: 360, padding: 32 }}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>{done ? "🎉" : err ? "⚠️" : "⏳"}</div>
        <div style={{ fontSize: 16, lineHeight: 1.6, color: err ? "#A05050" : done ? "#4E9268" : "#857F78" }}>
          {status}
        </div>
        {(done || err) && (
          <button onClick={() => window.location.href = "/"} style={{
            marginTop: 24, padding: "10px 24px", background: "transparent",
            border: "1px solid #2E2F35", borderRadius: 8, color: "#E8E4DC",
            cursor: "pointer", fontFamily: "monospace", fontSize: 11,
          }}>
            ← Back to Life OS
          </button>
        )}
      </div>
    </div>
  );
}
