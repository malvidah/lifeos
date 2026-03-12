# Refactor: Dashboard.jsx decomposition

## What changed

### Architecture
- **Dashboard.jsx**: 7,114 lines → 155 lines (thin orchestrator)
- **30+ extracted components** in focused directories:
  - `components/theme/` — CSS custom properties + React context (replaces mutable `let C` global)
  - `components/hooks/` — useDbSave, useIsMobile, useCollapse, useSearch
  - `components/utils/` — dates, tags, formatting, images, AI, Oura cache
  - `components/cards/` — CalendarCard, HealthCard, MapCard, WorkoutsCard, ProjectsCard
  - `components/widgets/` — ChatFloat, Tasks, RowList/Meals, JournalEditor, InsightsCard, SearchResults
  - `components/views/` — ProjectView, HealthProjectView, LoginScreen
  - `components/nav/` — Header, NavBar, UserMenu
  - `components/ui/` — Ring, Card, Widget, InfoTip, ChevronBtn, Shimmer, TagChip, etc.
  - `components/contexts.jsx` — NavigationContext, ProjectNamesContext, NoteContext

### Theme system
- CSS custom properties in `app/theme.css` — `var(--dl-bg)`, `var(--dl-text)`, etc.
- `ThemeProvider` manages `data-theme` attribute on document
- `useTheme()` hook provides hex values for SVG/canvas edge cases
- Dark/light theme switching works via CSS, not React re-renders

### API middleware
- `app/api/_lib/auth.js` — `withAuth()` wrapper eliminates duplicated auth in 30+ routes
- `entries` and `all-tags` routes converted as examples

### Design tokens (shared)
- `components/theme/tokens.js` — font stacks, sizes, projectColor (shared between Dashboard + DayLabEditor)
- Eliminates duplicate definitions across files

## Known issues (to fix before merging)
1. **Template literal parse errors** — The mechanical `C.xxx → var(--dl-xxx)` conversion mangled some backtick strings in extracted components. ~15 files need manual review of template literals.
2. **Opacity hex suffixes** — Patterns like `color + '22'` need hex values from `useTheme().colors`, not CSS vars. Fix script addressed some but not all.
3. **catch without parens** — Some extracted code has `catch { ... }` which modern JS supports but the build may flag.
4. **Import verification** — Cross-component imports need a full verification pass.

## Migration path
1. Fix parse errors in extracted components (template literal quotes)
2. Verify all imports resolve
3. Build passes
4. Test locally
5. Merge to main

## Data migration
No data migration needed — this is a frontend-only refactor. The Supabase schema, API routes, and data model are unchanged.
