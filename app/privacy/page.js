export const metadata = {
  title: 'Privacy Policy — Day Lab',
  description: 'How Day Lab handles your data.',
};

const STYLES = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #0D0C10; color: #E8E2D9; font-family: 'DM Mono', monospace;
    font-weight: 300; line-height: 1.7; -webkit-font-smoothing: antialiased; }
  a { color: #C4A852; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .wrap { max-width: 680px; margin: 0 auto; padding: 80px 32px 120px; }
  .back { display: inline-flex; align-items: center; gap: 6px; font-size: 11px;
    letter-spacing: 0.14em; text-transform: uppercase; color: #6B6460;
    margin-bottom: 64px; transition: color 0.15s; }
  .back:hover { color: #C4A852; text-decoration: none; }
  .eyebrow { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;
    color: #C4A852; margin-bottom: 16px; }
  h1 { font-family: 'DM Serif Display', serif; font-size: clamp(36px, 6vw, 52px);
    font-weight: 400; line-height: 1.1; letter-spacing: -0.02em;
    color: #F0EBE3; margin-bottom: 12px; }
  .updated { font-size: 12px; color: #4A4540; letter-spacing: 0.08em; margin-bottom: 56px; }
  .divider { width: 40px; height: 1px; background: #2A2520; margin-bottom: 56px; }
  h2 { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;
    color: #8A8480; margin-top: 48px; margin-bottom: 14px; }
  p { font-size: 15px; color: #C8C0B4; margin-bottom: 16px; }
  ul { list-style: none; margin-bottom: 16px; }
  ul li { font-size: 15px; color: #C8C0B4; padding-left: 20px;
    position: relative; margin-bottom: 8px; }
  ul li::before { content: '-'; position: absolute; left: 0; color: #4A4540; }
  .contact-block { margin-top: 64px; padding: 28px 32px;
    border: 1px solid #1E1C22; border-radius: 8px; background: #110F14; }
  .contact-block p { margin: 0; font-size: 14px; }
  footer { margin-top: 80px; padding-top: 32px; border-top: 1px solid #1A1820;
    font-size: 12px; color: #3A3540; letter-spacing: 0.06em; }
  strong { color: #E8E2D9; font-weight: 400; }
`;

export default function PrivacyPage() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Mono:wght@300;400&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      </head>
      <body>
        <div className="wrap">
          <a href="/" className="back">back to Day Lab</a>
          <div className="eyebrow">Legal</div>
          <h1>Privacy Policy</h1>
          <p className="updated">Last updated March 10, 2026</p>
          <div className="divider" />
          <p>Day Lab is a personal health and productivity dashboard. This policy explains what data we collect, how we use it, and your rights.</p>

          <h2>What we collect</h2>
          <ul>
            <li><strong>Account information</strong> — your name and email via Google Sign-In.</li>
            <li><strong>Health data</strong> — sleep, HRV, resting heart rate, and activity metrics from Oura Ring, Garmin Connect, or Apple Health, depending on which you connect.</li>
            <li><strong>Activity data</strong> — workouts and runs from Strava via OAuth, or from your connected health device.</li>
            <li><strong>Journal entries</strong> — notes, meals, tasks, and any other content you log in the app.</li>
            <li><strong>Calendar data</strong> — events from Google Calendar, with read and write access so you can view and create events from the app.</li>
          </ul>

          <h2>How we use it</h2>
          <ul>
            <li>To display your personal dashboard and compute health scores from your raw biometric data.</li>
            <li>To generate AI-powered daily insights when you request them.</li>
            <li>To sync your data across devices (web, Mac app, iOS app).</li>
            <li>We do not sell your data to any third party.</li>
            <li>We do not use your data to train AI models.</li>
            <li>AI insights are generated via the Anthropic API. Prompts and responses are not retained by Anthropic or used for model training.</li>
          </ul>

          <h2>Data storage</h2>
          <p>Your data is stored in Supabase (PostgreSQL) with row-level security so only you can access your own records. The app is hosted on Vercel. Health snapshots are cached in your database so scores are available for historical dates.</p>

          <h2>Third-party services</h2>
          <ul>
            <li><strong>Google</strong> — authentication and optional Google Calendar access.</li>
            <li><strong>Oura</strong> — health and sleep data via your personal access token, which you manage and can revoke from app settings.</li>
            <li><strong>Garmin</strong> — health and activity data via your Garmin Connect credentials, stored as OAuth tokens. Your password is never stored.</li>
            <li><strong>Apple Health</strong> — health data synced from the Day Lab iOS app via HealthKit. Requires explicit on-device permission.</li>
            <li><strong>Strava</strong> — activity data via OAuth. Revoke access anytime from Strava settings or from the app.</li>
            <li><strong>Anthropic</strong> — AI insights only. Data is not stored by Anthropic or used for training.</li>
            <li><strong>Stripe</strong> — payment processing for premium plans. We never see or store your card details.</li>
          </ul>

          <h2>Your rights</h2>
          <ul>
            <li>Request deletion of your account and all associated data by emailing us.</li>
            <li>Revoke Google Calendar access anytime from your Google account settings.</li>
            <li>Disconnect Oura, Garmin, or Strava from the app settings menu at any time.</li>
            <li>Revoke Apple Health access via iOS Settings &rarr; Privacy &amp; Security &rarr; Health &rarr; Day Lab.</li>
          </ul>

          <h2>Cookies</h2>
          <p>One session cookie to keep you signed in. No advertising or tracking cookies.</p>

          <h2>Children</h2>
          <p>Day Lab is not intended for users under 13.</p>

          <div className="contact-block">
            <h2 style={{marginTop:0}}>Contact</h2>
            <p>Questions? <a href="mailto:marvin.liyanage@gmail.com">marvin.liyanage@gmail.com</a></p>
          </div>
          <footer>2026 Day Lab. All rights reserved.</footer>
        </div>
      </body>
    </html>
  );
}
