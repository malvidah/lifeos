# LifeOS — Worker 1: Core Data & Projects

## Your Domain
You own entries, notes, journal, tasks, projects, and tags. Do NOT touch files owned by other workers.

### Files you own
- `app/api/entries/`, `app/api/journal/`, `app/api/notes/`
- `app/api/tasks/`, `app/api/projects/`, `app/api/projects/rename/`
- `app/api/project-entries/`, `app/api/tag-connections/`, `app/api/all-tags/`
- `components/Dashboard.jsx`, `components/Editor.jsx`
- `components/views/ProjectView.jsx`, `components/views/ProjectSettingsPanel.jsx`
- `lib/db.js`, `lib/store.js`, `lib/useProjects.js`, `lib/parseBlocks.js`

### Files you must NOT touch (other workers own these)
- Health/fitness/integrations (Worker 2)
- AI/chat/voice (Worker 3)
- Auth/settings/nav/UI primitives (Worker 4)

## Project
- Next.js app (App Router) with Supabase backend
- Auto-deploys to Vercel on push to `main`
- Run `npm run dev` for local dev, `npm run build` to verify

## Workflow
1. **PLAN FIRST** — enter plan mode, read files, share plan before coding
2. Work on branch `agent/worker-1` only
3. Commit often with clear messages
4. Run `npm run build` after significant changes
5. Use `/safe-merge` to merge to main
6. After another agent merges, run `git fetch origin main && git rebase origin/main`

## Code conventions
- Use existing patterns — don't introduce new frameworks or libraries without asking
- Keep components in `components/`, API routes in `app/api/`, utilities in `lib/`
