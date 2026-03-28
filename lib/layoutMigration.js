// Migrate existing collapse-state localStorage keys into dashboard_layouts format.
// Called once for users who don't yet have dashboard_layouts in their settings.

const ALL_CARDS = [
  { id: 'project-graph', key: 'project-graph', defaultCollapsed: false },
  { id: 'cal',           key: 'cal',           defaultCollapsed: true },
  { id: 'world-map',     key: 'world-map',     defaultCollapsed: true },
  { id: 'goals',         key: 'goals',         defaultCollapsed: true },
  { id: 'health',        key: 'health',        defaultCollapsed: true },
  { id: 'habits',        key: 'habits',        defaultCollapsed: true },
  { id: 'notes',         key: 'notes',         defaultCollapsed: true },
  { id: 'tasks',         key: 'tasks',         defaultCollapsed: false },
  { id: 'journal',       key: 'journal',       defaultCollapsed: false },
  { id: 'meals',         key: 'meals',         defaultCollapsed: true },
  { id: 'workouts',      key: 'workouts',      defaultCollapsed: true },
];

const FALLBACK_CARDS = ['project-graph', 'journal', 'tasks'];

export function migrateFromCollapseState() {
  const visible = ALL_CARDS.filter(({ key, defaultCollapsed }) => {
    const saved = localStorage.getItem(`collapse:${key}`);
    const collapsed = saved !== null ? saved === 'true' : defaultCollapsed;
    return !collapsed;
  }).map(c => c.id);

  const cards = visible.length > 0 ? visible : FALLBACK_CARDS;

  return {
    desktop: [{ name: 'Dashboard', cards }],
    mobile: [{ name: 'Dashboard', cards }],
  };
}
