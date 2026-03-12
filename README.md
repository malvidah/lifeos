# Day Lab

Day Lab is an everything app that's less about over-optimizing your life and more about keeping track of things for you so you can do more living. It's for people who love to ponder, like taking on multiple projects, and need somewhere to put their great ideas.

---

## Views

Views determine the layout, card arrangement, and data scope displayed in the scrollable area.

**Day View** — the default view on the Home page. A calendar at the top lets you select any day; all cards show data connected to that selected day.

**Project View** — activated when you click into any project. Cards show data scoped to that specific project, grouped by date.

---

## Elements

Persistent UI elements that appear on every page.

**Header** — the top bar on every page. Contains the DAY LAB wordmark in the center (tap to go home) and the user settings menu on the far right. A fade vignette sits directly below the Header at a z-layer above all scrollable content.

**Nav** — the first element in the scrollable area, below the Header vignette, above Cards. In Day View it contains a button for All Projects, Health, and recent project chips. In Project View it contains a back chevron and the current project name. In all views it also contains a right-aligned Search icon.

**Cards** — modular content blocks that each hold a specific function. Card layout (size, column arrangement) adapts to window size and the active page.

**Search** — global full-text search across all data connected to your account. Activated via the search icon in the Nav.

**Ask AI** — query your data using AI. Get insights, summaries, and make new entries via text input or voice dictation.

---

## Pages

Pages define what exists in the scrollable area. There are four main pages.

### Home
Uses **Day View**. Loads on login and displays data for today (or the selected day). Cards shown:
- Calendar
- Health
- Journal
- Tasks
- Meals
- Workouts

### All Projects
Uses **Project View** with scope set to all projects. Cards shown:
- Map
- Notes
- Tasks
- Journal

### Selected Project
Uses **Project View** scoped to the selected project. Cards shown:
- Notes
- Tasks
- Journal

### Health Project
Uses **Project View** scoped to the Health project. Like other project pages but also includes health-specific cards:
- Notes
- Tasks
- Journal
- Health
- Meals
- Workouts

---

## Cards

### Calendar
Toggles between **Day focus** `[D]` and **Month focus** `[M]`. In Day focus, shows calendar events synced from Google Calendar or entered manually. In Month focus, shows significant events and a short AI summary of journal entries for each day. Both modes show achievement dots for health scores above 85.

### Health
Displays health scores calculated from synced Apple Health, Oura Ring, or Garmin data. Scores include **Sleep**, **Readiness**, **Activity**, and **Recovery**. Can be toggled to hide trends, or show trends for the last **30 days** or **12 months**.

### Journal
Rich text daily entries. In Day View shows today's entries. In Project View shows entries tagged with the project, grouped by date.

### Tasks
Checklist items. In Day View shows today's tasks. In Project View shows tasks tagged with the project, grouped by date. Supports filtering by open/completed.

### Meals
Food log with **PROT** and **ENERGY** values — either AI-estimated or synced from connected sources. In Day View shows today's meals. In Project View shows meals grouped by date.

### Workouts
Activity log synced from Apple Health, Oura, Strava, or entered manually. Includes **DIST**, **PACE**, and **ENERGY** values. Totals shown at the bottom. In Day View shows today's workouts. In Project View shows workouts grouped by date.

### Map
A 2D node graph of all your projects. Distance between nodes reflects the strength of tagging relationships — projects that frequently appear together in notes and tasks appear closer together.

### Notes
Named, tabbed rich-text documents scoped to a project. Each note has a name tab on the right (⅓ width) and a full editor on the left (⅔ width). Use notes for project overviews, important links, reference material, or anything you don't want tied to a specific date.

Type `{Note Name}` in any editor to link to a note by name. A dropdown autocomplete appears as you type `{`.

---

## Data & Storage

All data is stored in Supabase (Postgres + RLS). Key DB entry types:

| type | scope | contents |
|---|---|---|
| `notes` | per date | daily journal entries (plain text / Day Lab format) |
| `tasks` | per date | task lists |
| `meals` | per date | meal rows |
| `activity` | per date | workout rows |
| `projects` | global | project metadata |
| `project-notes` | per project | named notes store `{notes:[{id,name,content}], activeId}` |

> **Note:** The DB type `notes` stores daily *journal* entries. The *Notes card* uses `project-notes`. This naming mismatch is legacy and will be resolved in a future migration.

---

## Integrations

| Service | Data synced |
|---|---|
| Apple Health | Sleep, HRV, resting HR, activity, workouts |
| Oura Ring | Sleep, readiness, activity, workouts |
| Garmin Connect | Sleep, HRV, activity, workouts |
| Strava | Workouts, activity |
| Google Calendar | Events |

---

## Tech Stack

- **Frontend:** Next.js 14 (App Router), React, deployed on Vercel
- **Database:** Supabase (Postgres, Row Level Security)
- **Editor:** TipTap (ProseMirror)
- **Desktop:** Electron wrapper (notarized macOS DMG)
- **iOS:** WKWebView wrapper (xcodegen)
- **Repo:** `github.com/malvidah/lifeos`
- **Live:** `daylab.me`

---

## Deploy

```bash
# Push to GitHub
git add . && git commit -m "..." && git push origin main

# Vercel auto-deploys on push. Manual:
npx vercel --prod
```

### Environment variables (Vercel dashboard)

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Recommended | Proper Storage URL generation |
| `ANTHROPIC_API_KEY` | ✅ | AI insights + Ask AI |
| `STRAVA_CLIENT_ID` | Optional | Strava OAuth |
| `STRAVA_CLIENT_SECRET` | Optional | Strava OAuth |
| `GARMIN_CLIENT_ID` | Optional | Garmin OAuth |
| `GARMIN_CLIENT_SECRET` | Optional | Garmin OAuth |

---

## Roadmap

- [ ] Data migration: rename `type:'notes'` → `type:'journal'` in DB
- [ ] Data migration: rename `type:'activity'` → `type:'workouts'` in DB
- [ ] `{Note Name}` chip rendering in read-only views (Journal, Tasks entries)
- [ ] Notes card: inline rename (currently double-click → window.prompt)
- [ ] Google OAuth app verification (Production publish)
- [ ] TestFlight public soft-launch
- [ ] Rate limiting + response caching for AI endpoints
