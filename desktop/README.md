# Day Lab — Mac Desktop App

Electron wrapper that loads the live Day Lab web app in a native Mac window.
Vibrancy, hidden title bar, native traffic lights. Always up to date — no re-downloads needed for web changes.

## Local development

```bash
cd desktop
npm install
# Update APP_URL in src/main.js to your local dev server or Vercel preview
npm start
```

## Build a .dmg locally

```bash
cd desktop
npm install
npm run build          # universal (arm64 + x64)
npm run build:arm      # Apple Silicon only
npm run build:intel    # Intel only
# Output: desktop/dist/Day Lab-1.0.0-arm64.dmg etc
```

## Release a new version

1. Update `version` in `desktop/package.json`
2. Tag the commit and push:
   ```bash
   git tag desktop-v1.0.0
   git push --tags
   ```
3. GitHub Actions builds the .dmg and attaches it to the release automatically
4. Download link in Settings auto-points to `releases/latest` so users always get the newest

## OAuth / deep linking

The app registers the `daylab://` URL scheme. When Supabase redirects after Google sign-in,
it sends the user to `daylab://auth/callback?code=...` which the app intercepts and translates
back into a page load inside the window. No extra Supabase config needed beyond adding
`daylab://` as an allowed redirect URL in your project.

## Code signing (optional)

The app works unsigned — users right-click → Open to bypass Gatekeeper the first time.
To fully sign and notarize, add these secrets to your GitHub repo and uncomment the env vars in the workflow:
- `CSC_LINK` — base64-encoded .p12 certificate
- `CSC_KEY_PASSWORD` — certificate password
- `APPLE_ID` — your Apple ID email
- `APPLE_APP_SPECIFIC_PASSWORD` — app-specific password from appleid.apple.com
- `APPLE_TEAM_ID` — 10-char team ID from developer.apple.com

## Updating the app URL

Edit `APP_URL` in `desktop/src/main.js`:
```js
const APP_URL = 'https://your-domain.com';
```
