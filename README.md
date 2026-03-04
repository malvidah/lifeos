# Day Lab

Personal dashboard — calendar, health, meals, tasks, notes.

## Deploy to Vercel

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Life OS initial"
gh repo create lifeos --private --push
```

### 2. Deploy
```bash
npx vercel --prod
```

### 3. Environment variables (set in Vercel dashboard)
None required for basic operation.

Optional:
- `OURA_TOKEN` — Oura personal access token for server-side health sync

## Apple Health sync

Once deployed, your health endpoint is live at:
```
https://your-app.vercel.app/api/health
```

### Option A — Health Auto Export app ($4)
1. Install "Health Auto Export - XML/CSV" from App Store
2. Open app → Automation → Add Export
3. Set URL: `https://your-app.vercel.app/api/health`
4. Select metrics: Sleep Analysis, Heart Rate Variability, Resting Heart Rate
5. Set schedule: Daily at 7am

### Option B — Apple Shortcuts (free)
Use the "Get Health Sample" action → "Get Contents of URL" to POST to the health endpoint.

## Data
Data is stored server-side in memory (resets on redeploy).
For permanent persistence, add Vercel KV (free tier) and swap `lib/storage.js`.
