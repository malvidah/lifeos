"use client";
import React, { useState, useEffect, useRef, useCallback, useContext } from "react";
import { mono, F, projectColor, CHIP_TOKENS } from "@/lib/tokens";
import { api } from "@/lib/api";
import { displayTaskText } from "@/lib/cleanTaskText";
import { ProjectNamesContext } from "@/lib/contexts";

const GOAL_COLOR = "#5BA89D";
const BACK_STYLE = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--dl-middle)', fontFamily: mono, fontSize: 18, padding: 0, lineHeight: 1, flexShrink: 0 };

const STATUS_COLS = [
  { key: 'active', label: 'Active', color: '#5BA89D' },
  { key: 'planned', label: 'Planned', color: '#6BAED6' },
  { key: 'completed', label: 'Completed', color: '#8DB86B' },
  { key: 'archived', label: 'Archived', color: 'var(--dl-middle)' },
];

/* ────────────────────────────────────────────────────────────────────────────
   View mode toggle — exported for Card headerRight
   ──────────────────────────────────────────────────────────────────────────── */
// Grid: 4 even columns, manual sort
const GridIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
    <rect x="1" y="1" width="6" height="6" rx="1.5"/><rect x="9" y="1" width="6" height="6" rx="1.5"/>
    <rect x="1" y="9" width="6" height="6" rx="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5"/>
  </svg>
);
// Kanban: uneven columns = grouped by project
const KanbanIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
    <rect x="1" y="1" width="4" height="14" rx="1.2"/><rect x="6" y="1" width="4" height="9" rx="1.2"/><rect x="11" y="1" width="4" height="11" rx="1.2"/>
  </svg>
);
// Status: columns with checkmark = progress stages
const StatusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <rect x="1" y="2" width="3.5" height="12" rx="1" fill="currentColor"/><rect x="6.25" y="2" width="3.5" height="12" rx="1" fill="currentColor" opacity="0.6"/><rect x="11.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" opacity="0.3"/>
  </svg>
);

export function GoalsViewToggle({ mode, setMode }) {
  const modes = [
    { key: 'list', icon: <GridIcon />, label: 'Grid view' },
    { key: 'kanban', icon: <KanbanIcon />, label: 'Kanban by project' },
    { key: 'status', icon: <StatusIcon />, label: 'Kanban by status' },
  ];
  return (
    <div style={{ display: 'flex', gap: 2, background: 'var(--dl-border-15, rgba(128,120,100,0.1))', borderRadius: 100, padding: 2 }}>
      {modes.map(m => {
        const active = mode === m.key;
        return (
          <button key={m.key} onClick={e => { e.stopPropagation(); setMode(m.key); }} aria-label={m.label} aria-pressed={active} style={{
            fontFamily: mono, fontSize: '10px', padding: '3px 6px',
            borderRadius: 100, cursor: 'pointer', border: 'none',
            background: active ? 'var(--dl-glass-active, var(--dl-accent-13))' : 'transparent',
            color: active ? 'var(--dl-strong)' : 'var(--dl-middle)',
            display: 'flex', alignItems: 'center', gap: 3, transition: 'all 0.15s',
          }}>
            {m.icon}
          </button>
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Hoverable goal card wrapper
   ──────────────────────────────────────────────────────────────────────────── */
function GoalCardWrap({ children, onClick, draggable, onDragStart, onDragEnd, style }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...style,
        transform: hovered ? 'translateY(-1px)' : 'none',
        boxShadow: hovered
          ? '0 4px 14px rgba(0,0,0,0.10)'
          : (style?.boxShadow || 'none'),
      }}
    >
      {children}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Project pill — small colored chip
   ──────────────────────────────────────────────────────────────────────────── */
function ProjectPill({ project }) {
  if (!project) return null;
  const col = projectColor(project);
  return (
    <span style={{
      fontFamily: mono, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase',
      color: col, background: col + '22', borderRadius: 999, padding: '1px 7px',
      whiteSpace: 'nowrap', lineHeight: '1.65',
    }}>
      {project}
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Goal Detail View — viewing existing goals + creating new ones
   ──────────────────────────────────────────────────────────────────────────── */
function GoalDetailView({ goal, token, isNew, onBack, onCreated, onUpdated, allProjects }) {
  const [editName, setEditName] = useState(goal?.name || '');
  const [editProject, setEditProject] = useState(goal?.project || '');
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [saved, setSaved] = useState(!isNew);
  const [linkedTasks, setLinkedTasks] = useState([]);
  const [linkedHabits, setLinkedHabits] = useState([]);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const nameRef = useRef(null);
  const nameTimer = useRef(null);

  useEffect(() => { if (isNew && nameRef.current) nameRef.current.focus(); }, [isNew]);

  useEffect(() => {
    if (!isNew || saved) return;
    const onKey = e => { if (e.key === 'Escape') onBack(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isNew, saved, onBack]);

  const fetchLinked = useCallback(async () => {
    if (!goal?.name || isNew) return;
    setLoadingLinks(true);
    try {
      const res = await api.get(`/api/goals/linked?name=${encodeURIComponent(goal.name)}`, token);
      if (res) { setLinkedTasks(res.tasks || []); setLinkedHabits(res.habits || []); }
    } catch (e) { console.error('[goals] fetch linked failed:', e); }
    setLoadingLinks(false);
  }, [goal?.name, isNew, token]);

  useEffect(() => { fetchLinked(); }, [fetchLinked]);

  const doCreate = async () => {
    if (!editName.trim()) return;
    try {
      const res = await api.post('/api/goals', { name: editName.trim(), project: editProject || null }, token);
      setSaved(true);
      window.dispatchEvent(new Event('daylab:goals-changed'));
      onCreated?.(res?.goal);
    } catch (e) { console.error('[goals] create failed:', e); }
  };

  const patchGoal = async (updates) => {
    if (!goal?.id) return;
    try {
      await api.patch('/api/goals', { id: goal.id, ...updates }, token);
      window.dispatchEvent(new Event('daylab:goals-changed'));
      onUpdated?.();
    } catch (e) { console.error('[goals] patch failed:', e); }
  };

  const onNameChange = (val) => {
    setEditName(val);
    if (isNew) return;
    clearTimeout(nameTimer.current);
    nameTimer.current = setTimeout(() => {
      if (val.trim() && val.trim() !== goal.name) patchGoal({ name: val.trim() });
    }, 800);
  };

  const onProjectPick = (p) => {
    setEditProject(p);
    setShowProjectPicker(false);
    if (!isNew && saved) patchGoal({ project: p || null });
  };

  const projColor = editProject ? projectColor(editProject) : 'var(--dl-middle)';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <button onClick={onBack} style={BACK_STYLE}>‹</button>
        <input ref={nameRef} value={editName} onChange={e => onNameChange(e.target.value)}
          placeholder={isNew ? 'Goal name...' : ''}
          onKeyDown={e => { if (e.key === 'Enter' && isNew && !saved) doCreate(); }}
          style={{ flex: 1, fontFamily: mono, fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: GOAL_COLOR, background: 'transparent', border: 'none', outline: 'none', padding: 0 }} />
        {!isNew && (
          <button onClick={() => patchGoal({ done: !goal.done })} style={{
            fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
            background: goal.done ? GOAL_COLOR : 'transparent', color: goal.done ? '#fff' : 'var(--dl-middle)',
            border: `1px solid ${goal.done ? GOAL_COLOR : 'var(--dl-border)'}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', transition: 'all 0.15s',
          }}>{goal.done ? '✓ done' : 'done'}</button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        {showProjectPicker ? (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {allProjects.map(p => (
              <button key={p} onClick={() => onProjectPick(p)} style={{ ...CHIP_TOKENS.project(projectColor(p)), cursor: 'pointer', border: 'none', opacity: p === editProject ? 1 : 0.5 }}>⛰️ {p}</button>
            ))}
            <button onClick={() => onProjectPick('')} style={{ ...CHIP_TOKENS.project('var(--dl-middle)'), cursor: 'pointer', border: 'none', opacity: 0.5 }}>none</button>
          </div>
        ) : (
          <button onClick={() => setShowProjectPicker(true)} style={{ ...CHIP_TOKENS.project(projColor), cursor: 'pointer', border: 'none', opacity: editProject ? 1 : 0.5 }}>
            {editProject ? `⛰️ ${editProject}` : '+ project'}
          </button>
        )}
      </div>

      {isNew && !saved && (
        <button onClick={doCreate} disabled={!editName.trim()} style={{
          fontFamily: mono, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
          background: editName.trim() ? GOAL_COLOR : 'var(--dl-surface)', color: editName.trim() ? '#fff' : 'var(--dl-middle)',
          border: 'none', borderRadius: 8, padding: '8px 16px', cursor: editName.trim() ? 'pointer' : 'default', transition: 'all 0.15s', marginBottom: 8,
        }}>Create Goal</button>
      )}

      {!isNew && (
        <>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--dl-middle)', marginBottom: 4 }}>
              Habits · {linkedHabits.length}
            </div>
            {linkedHabits.length === 0 && !loadingLinks && (
              <div style={{ fontFamily: mono, fontSize: 11, color: 'var(--dl-border2)', padding: '4px 0' }}>Tag a habit with /g {goal.name} to link it</div>
            )}
            {linkedHabits.map(h => (
              <div key={h.id} style={{ fontFamily: mono, fontSize: 12, color: 'var(--dl-strong)', padding: '5px 0', borderBottom: '1px solid var(--dl-border)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--dl-accent)', fontSize: 11 }}>🎯</span>
                {displayTaskText(h.text)}
              </div>
            ))}
          </div>

          <div>
            <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--dl-middle)', marginBottom: 4 }}>
              Tasks · {linkedTasks.length}
            </div>
            {linkedTasks.length === 0 && !loadingLinks && (
              <div style={{ fontFamily: mono, fontSize: 11, color: 'var(--dl-border2)', padding: '4px 0' }}>Tag a task with /g {goal.name} to link it</div>
            )}
            {linkedTasks.map(t => (
              <div key={t.id} style={{ fontFamily: mono, fontSize: 12, color: 'var(--dl-strong)', padding: '5px 0', borderBottom: '1px solid var(--dl-border)', display: 'flex', alignItems: 'center', gap: 6, opacity: t.done ? 0.5 : 1, textDecoration: t.done ? 'line-through' : 'none' }}>
                <span style={{ fontSize: 11, color: t.done ? 'var(--dl-accent)' : 'var(--dl-border2)' }}>{t.done ? '✓' : '○'}</span>
                {displayTaskText(t.text)}
              </div>
            ))}
          </div>

          <button onClick={async () => {
            if (!confirm("Delete this goal? Linked tasks won't be deleted.")) return;
            await api.delete(`/api/goals?id=${goal.id}`, token);
            window.dispatchEvent(new Event('daylab:goals-changed'));
            onBack();
          }} style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--dl-middle)', background: 'none', border: 'none', cursor: 'pointer', marginTop: 12, padding: 0, opacity: 0.6 }}>
            Delete goal
          </button>
        </>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Main GoalsCard
   ──────────────────────────────────────────────────────────────────────────── */
const COL_MIN_W = 180;
const CARD_RADIUS = 10;

export default function ProjectsCard({ token, date, onSelectDate, viewMode }) {
  // 'detail' is internal-only; all other modes come from viewMode prop
  const [internalView, setInternalView] = useState(null); // 'detail' | null
  const [prevMode, setPrevMode] = useState('kanban');
  const [goals, setGoals] = useState([]);
  const [selectedGoal, setSelectedGoal] = useState(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [creatingInProject, setCreatingInProject] = useState(null);
  const [newGoalText, setNewGoalText] = useState('');
  const [loading, setLoading] = useState(false);

  // Fallback viewMode for standalone pages that don't pass it
  const mode = viewMode || 'kanban';

  // Drag state
  const [dragId, setDragId] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const res = await api.get('/api/goals', token);
    if (res?.goals) setGoals(res.goals);
    setLoading(false);
  }, [token]);

  useEffect(() => { refresh(); }, [token, refresh]);

  useEffect(() => {
    const h = () => refresh();
    window.addEventListener('daylab:goals-changed', h);
    window.addEventListener('daylab:tasks-saved', h);
    return () => { window.removeEventListener('daylab:goals-changed', h); window.removeEventListener('daylab:tasks-saved', h); };
  }, [refresh]);

  const ctxProjectNames = useContext(ProjectNamesContext);

  // Group goals by project
  const grouped = goals.reduce((acc, g) => {
    const p = g.project || 'unassigned';
    if (!acc[p]) acc[p] = [];
    acc[p].push(g);
    return acc;
  }, {});
  const projectNames = Object.keys(grouped).sort((a, b) => a === 'unassigned' ? 1 : b === 'unassigned' ? -1 : a.localeCompare(b));
  const allProjectOptions = [...new Set([
    ...goals.map(g => g.project).filter(Boolean),
    ...ctxProjectNames,
  ])].sort();

  // Group goals by status
  const groupedByStatus = STATUS_COLS.reduce((acc, col) => {
    acc[col.key] = goals.filter(g => (g.status || 'active') === col.key);
    return acc;
  }, {});

  // Quick-create goal in a column
  const createGoalInProject = async (name, project) => {
    if (!name.trim()) return;
    await api.post('/api/goals', { name: name.trim(), project: project === 'unassigned' ? null : project }, token);
    setNewGoalText('');
    setCreatingInProject(null);
    refresh();
    window.dispatchEvent(new Event('daylab:goals-changed'));
  };

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const onDragStart = (e, goalId) => {
    if (mode === 'list') return; // no drag in list mode
    setDragId(goalId);
    e.dataTransfer.effectAllowed = 'move';
    if (e.target) e.target.style.opacity = '0.5';
  };
  const onDragEnd = (e) => {
    if (e.target) e.target.style.opacity = '1';
    if (dragId && dragOverCol !== null) {
      const goal = goals.find(g => g.id === dragId);
      if (goal) {
        if (mode === 'status') {
          const currentStatus = goal.status || 'active';
          if (currentStatus !== dragOverCol) {
            api.patch('/api/goals', { id: dragId, status: dragOverCol }, token).then(() => {
              refresh();
              window.dispatchEvent(new Event('daylab:goals-changed'));
            });
          }
        } else if (mode === 'kanban') {
          const newProject = dragOverCol === 'unassigned' ? null : dragOverCol;
          if ((goal.project || null) !== newProject) {
            api.patch('/api/goals', { id: dragId, project: newProject }, token).then(() => {
              refresh();
              window.dispatchEvent(new Event('daylab:goals-changed'));
            });
          }
        }
      }
    }
    setDragId(null);
    setDragOverCol(null);
    setDragOverIdx(null);
  };
  const onColDragOver = (e, colName) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCol(colName);
  };
  const onColDragLeave = (e, colName) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      if (dragOverCol === colName) setDragOverCol(null);
    }
  };
  const onColDrop = (e) => {
    e.preventDefault();
  };

  const openDetail = (goal) => {
    setPrevMode(mode);
    setSelectedGoal(goal);
    setInternalView('detail');
  };

  // ─── Detail views ──────────────────────────────────────────────────────────
  if (creatingNew) {
    const stub = { name: '', project: '', done: false };
    return (
      <GoalDetailView goal={stub} token={token} isNew
        onBack={() => setCreatingNew(false)}
        onCreated={(newGoal) => { setCreatingNew(false); refresh(); if (newGoal) { openDetail(newGoal); } }}
        onUpdated={refresh} allProjects={allProjectOptions} />
    );
  }

  if (internalView === 'detail' && selectedGoal) {
    const live = goals.find(g => g.id === selectedGoal.id) || selectedGoal;
    return (
      <GoalDetailView goal={live} token={token}
        onBack={() => { setInternalView(null); setSelectedGoal(null); }}
        onUpdated={refresh} allProjects={allProjectOptions} />
    );
  }

  // ─── Shared goal card renderer ─────────────────────────────────────────────
  const renderGoalCard = (goal, showProject) => {
    const cardBorderCol = showProject ? GOAL_COLOR : (goal.project ? projectColor(goal.project) : GOAL_COLOR);
    return (
      <GoalCardWrap
        key={goal.id}
        draggable={mode !== 'list'}
        onDragStart={e => onDragStart(e, goal.id)}
        onDragEnd={onDragEnd}
        onClick={() => openDetail(goal)}
        style={{
          background: 'var(--dl-card)',
          border: `1px solid ${goal.done ? 'var(--dl-border)' : (typeof cardBorderCol === 'string' && cardBorderCol.startsWith('#') ? cardBorderCol + '33' : 'var(--dl-border)')}`,
          borderRadius: CARD_RADIUS,
          padding: '10px 12px',
          cursor: dragId ? 'grabbing' : 'pointer',
          transition: 'opacity 0.15s, box-shadow 0.15s, transform 0.1s',
          opacity: goal.done ? 0.45 : (dragId === goal.id ? 0.5 : 1),
          boxShadow: dragId === goal.id ? '0 4px 12px rgba(0,0,0,0.12)' : 'none',
        }}
      >
        <div style={{
          fontFamily: mono, fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase',
          color: GOAL_COLOR, fontWeight: 500,
          textDecoration: goal.done ? 'line-through' : 'none',
          marginBottom: showProject && goal.project ? 5 : 0,
        }}>
          {goal.name}
        </div>
        {showProject && goal.project && <ProjectPill project={goal.project} />}
        {false && ((goal.habit_count || 0) + (goal.task_count || 0) > 0) && (
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {goal.habit_count > 0 && (
              <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)' }}>
                🎯 {goal.habit_count}
              </span>
            )}
            {goal.task_count > 0 && (
              <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)' }}>
                ☑️ {goal.task_count}
              </span>
            )}
          </div>
        )}
      </GoalCardWrap>
    );
  };

  // ─── Shared column renderer ────────────────────────────────────────────────
  const renderColumn = (colKey, colLabel, colColor, items, showProject, allowCreate) => {
    const isDropTarget = dragId && dragOverCol === colKey;
    return (
      <div
        key={colKey}
        onDragOver={e => onColDragOver(e, colKey)}
        onDragLeave={e => onColDragLeave(e, colKey)}
        onDrop={onColDrop}
        style={{
          minWidth: COL_MIN_W, maxWidth: mode === 'list' ? 'none' : 260, flex: mode === 'list' ? '1 1 auto' : '0 0 auto',
          display: 'flex', flexDirection: 'column', gap: 6,
          scrollSnapAlign: 'start',
          background: isDropTarget ? `${typeof colColor === 'string' && colColor.startsWith('#') ? colColor : GOAL_COLOR}08` : 'transparent',
          borderRadius: CARD_RADIUS, padding: isDropTarget ? 4 : 0,
          transition: 'background 0.15s, padding 0.15s',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          paddingBottom: 4, borderBottom: `2px solid ${typeof colColor === 'string' && colColor.startsWith('#') ? colColor + '44' : 'var(--dl-border)'}`,
        }}>
          <span style={{
            fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: colColor, fontWeight: 600,
          }}>
            {colLabel} <span style={{ fontWeight: 400, opacity: 0.6 }}>({items.length})</span>
          </span>
          {allowCreate && (
            <button
              onClick={() => { setCreatingInProject(colKey); setNewGoalText(''); }}
              style={{
                fontFamily: mono, fontSize: 12, color: 'var(--dl-middle)', background: 'none',
                border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1,
              }}
            >+</button>
          )}
        </div>

        {items.map(goal => renderGoalCard(goal, showProject))}

        {allowCreate && creatingInProject === colKey ? (
          <div style={{
            border: `1px dashed ${typeof colColor === 'string' && colColor.startsWith('#') ? colColor + '55' : 'var(--dl-border)'}`,
            borderRadius: CARD_RADIUS, padding: '8px 10px',
          }}>
            <input
              autoFocus
              placeholder="Goal name..."
              value={newGoalText}
              onChange={e => setNewGoalText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newGoalText.trim()) createGoalInProject(newGoalText, colKey);
                if (e.key === 'Escape') { setCreatingInProject(null); setNewGoalText(''); }
              }}
              onBlur={() => {
                if (newGoalText.trim()) createGoalInProject(newGoalText, colKey);
                else { setCreatingInProject(null); setNewGoalText(''); }
              }}
              style={{
                width: '100%', background: 'transparent', border: 'none', outline: 'none',
                fontFamily: mono, fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase',
                color: GOAL_COLOR, padding: 0,
              }}
            />
          </div>
        ) : null}
      </div>
    );
  };

  // ─── Main render ───────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Empty state */}
      {goals.length === 0 && !loading && (
        <div style={{ fontFamily: mono, fontSize: 12, color: 'var(--dl-middle)', padding: '16px 0', textAlign: 'center', letterSpacing: '0.04em' }}>
          No goals yet. Tap <span onClick={() => setCreatingNew(true)} style={{ color: GOAL_COLOR, cursor: 'pointer' }}>+ new</span> or tag a task with <span style={{ color: GOAL_COLOR }}>/g</span>
        </div>
      )}

      {/* ── Grid view — 4 columns, no headers, manual sort ────────────── */}
      {mode === 'list' && goals.length > 0 && (
        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {goals.map(goal => renderGoalCard(goal, true))}
          </div>
        </div>
      )}

      {/* ── Kanban by project ──────────────────────────────────────────── */}
      {mode === 'kanban' && goals.length > 0 && (
        <div style={{
          display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6,
          scrollSnapType: 'x proximity', WebkitOverflowScrolling: 'touch',
        }}>
          {projectNames.map(project => {
            const col = project === 'unassigned' ? 'var(--dl-middle)' : projectColor(project);
            return renderColumn(project, project, col, grouped[project], false, true);
          })}
          <div
            onClick={() => setCreatingNew(true)}
            style={{
              minWidth: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
              paddingTop: 2, cursor: 'pointer', flexShrink: 0,
            }}
          >
            <span style={{
              fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--dl-middle)', transition: 'color 0.15s',
            }}
              onMouseEnter={e => e.currentTarget.style.color = GOAL_COLOR}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--dl-middle)'}
            >+ new</span>
          </div>
        </div>
      )}

      {/* ── Kanban by status ───────────────────────────────────────────── */}
      {mode === 'status' && goals.length > 0 && (
        <div style={{
          display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6,
          scrollSnapType: 'x proximity', WebkitOverflowScrolling: 'touch',
        }}>
          {STATUS_COLS.map(sc => renderColumn(sc.key, sc.label, sc.color, groupedByStatus[sc.key], true, false))}
        </div>
      )}
    </div>
  );
}
