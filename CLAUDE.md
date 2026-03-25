# LifeOS

## Project
- Next.js app (App Router) with Supabase backend
- Auto-deploys to Vercel on push to `main`
- Run `npm run dev` for local dev, `npm run build` to verify

## Structure
- `components/` — React components
- `app/api/` — API routes
- `lib/` — utilities and shared logic
- `components/cards/` — dashboard cards
- `components/views/` — full-page views

## Code conventions
- Use existing patterns — don't introduce new frameworks or libraries without asking
- Keep components in `components/`, API routes in `app/api/`, utilities in `lib/`

## Agent teams
When using agent teams, split work by domain:
- **Core Data**: entries, notes, journal, tasks, projects, tags
- **Health/Fitness**: health, fitness, integrations
- **AI/Chat**: AI, chat, voice
- **Auth/UI**: auth, settings, nav, UI primitives
