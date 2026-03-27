"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { mono, F, projectColor, CHIP_TOKENS } from "@/lib/tokens";
import { api } from "@/lib/api";
import { displayTaskText } from "@/lib/cleanTaskText";

const GOAL_COLOR = "#5BA89D";
const BACK_STYLE = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--dl-middle)', fontFamily: mono, fontSize: 18, padding: 0, lineHeight: 1, flexShrink: 0 };

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
    } catch {}
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
    } catch {}
  };

  const patchGoal = async (updates) => {
    if (!goal?.id) return;
    try {
      await api.patch('/api/goals', { id: goal.id, ...updates }, token);
      window.dispatchEvent(new Event('daylab:goals-changed'));
      onUpdated?.();
    } catch {}
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
   Kanban — project columns with draggable goal cards
   ──────────────────────────────────────────────────────────────────────────── */
const COL_MIN_W = 180;
const CARD_RADIUS = 10;

export default function ProjectsCard({ token, date, onSelectDate }) {
  const [view, setView] = useState('kanban');
  const [goals, setGoals] = useState([]);
  const [selectedGoal, setSelectedGoal] = useState(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [creatingInProject, setCreatingInProject] = useState(null);
  const [newGoalText, setNewGoalText] = useState('');
  const [loading, setLoading] = useState(false);

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

  // Group goals by project
  const grouped = goals.reduce((acc, g) => {
    const p = g.project || 'unassigned';
    if (!acc[p]) acc[p] = [];
    acc[p].push(g);
    return acc;
  }, {});
  const projectNames = Object.keys(grouped).sort((a, b) => a === 'unassigned' ? 1 : b === 'unassigned' ? -1 : a.localeCompare(b));
  const allProjectOptions = [...new Set(goals.map(g => g.project).filter(Boolean))].sort();

  // Quick-create goal in a project column
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
    setDragId(goalId);
    e.dataTransfer.effectAllowed = 'move';
    // Make the drag image slightly transparent
    if (e.target) e.target.style.opacity = '0.5';
  };
  const onDragEnd = (e) => {
    if (e.target) e.target.style.opacity = '1';
    // If we dropped on a column, move the goal
    if (dragId && dragOverCol !== null) {
      const goal = goals.find(g => g.id === dragId);
      if (goal) {
        const newProject = dragOverCol === 'unassigned' ? null : dragOverCol;
        if ((goal.project || null) !== newProject) {
          api.patch('/api/goals', { id: dragId, project: newProject }, token).then(() => {
            refresh();
            window.dispatchEvent(new Event('daylab:goals-changed'));
          });
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
    // Only clear if leaving the column entirely
    if (!e.currentTarget.contains(e.relatedTarget)) {
      if (dragOverCol === colName) setDragOverCol(null);
    }
  };
  const onColDrop = (e, colName) => {
    e.preventDefault();
    // onDragEnd handles the actual move
  };

  // ─── Detail views ──────────────────────────────────────────────────────────
  if (creatingNew) {
    const stub = { name: '', project: '', done: false };
    return (
      <GoalDetailView goal={stub} token={token} isNew
        onBack={() => setCreatingNew(false)}
        onCreated={(newGoal) => { setCreatingNew(false); refresh(); if (newGoal) { setSelectedGoal(newGoal); setView('detail'); } }}
        onUpdated={refresh} allProjects={allProjectOptions} />
    );
  }

  if (view === 'detail' && selectedGoal) {
    const live = goals.find(g => g.id === selectedGoal.id) || selectedGoal;
    return (
      <GoalDetailView goal={live} token={token}
        onBack={() => { setView('kanban'); setSelectedGoal(null); }}
        onUpdated={refresh} allProjects={allProjectOptions} />
    );
  }

  // ─── Kanban ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Empty state */}
      {goals.length === 0 && !loading && (
        <div style={{ fontFamily: mono, fontSize: 12, color: 'var(--dl-middle)', padding: '16px 0', textAlign: 'center', letterSpacing: '0.04em' }}>
          No goals yet. Tap <span onClick={() => setCreatingNew(true)} style={{ color: GOAL_COLOR, cursor: 'pointer' }}>+ new</span> or tag a task with <span style={{ color: GOAL_COLOR }}>/g</span>
        </div>
      )}

      {/* Kanban columns */}
      {goals.length > 0 && (
        <div style={{
          display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6,
          /* Snap for mobile swiping */
          scrollSnapType: 'x proximity', WebkitOverflowScrolling: 'touch',
        }}>
          {projectNames.map(project => {
            const col = project === 'unassigned' ? 'var(--dl-middle)' : projectColor(project);
            const items = grouped[project];
            const isDropTarget = dragId && dragOverCol === project;

            return (
              <div
                key={project}
                onDragOver={e => onColDragOver(e, project)}
                onDragLeave={e => onColDragLeave(e, project)}
                onDrop={e => onColDrop(e, project)}
                style={{
                  minWidth: COL_MIN_W, maxWidth: 260, flex: '0 0 auto',
                  display: 'flex', flexDirection: 'column', gap: 6,
                  scrollSnapAlign: 'start',
                  // Drop target highlight
                  background: isDropTarget ? `${typeof col === 'string' && col.startsWith('#') ? col : GOAL_COLOR}08` : 'transparent',
                  borderRadius: CARD_RADIUS, padding: isDropTarget ? 4 : 0,
                  transition: 'background 0.15s, padding 0.15s',
                }}
              >
                {/* Column header */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  paddingBottom: 4, borderBottom: `2px solid ${typeof col === 'string' && col.startsWith('#') ? col + '44' : 'var(--dl-border)'}`,
                }}>
                  <span style={{
                    fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
                    color: col, fontWeight: 600,
                  }}>
                    {project} <span style={{ fontWeight: 400, opacity: 0.6 }}>({items.length})</span>
                  </span>
                  <button
                    onClick={() => { setCreatingInProject(project); setNewGoalText(''); }}
                    style={{
                      fontFamily: mono, fontSize: 12, color: 'var(--dl-middle)', background: 'none',
                      border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1,
                    }}
                  >+</button>
                </div>

                {/* Goal cards */}
                {items.map(goal => (
                  <div
                    key={goal.id}
                    draggable
                    onDragStart={e => onDragStart(e, goal.id)}
                    onDragEnd={onDragEnd}
                    onClick={() => { setSelectedGoal(goal); setView('detail'); }}
                    style={{
                      background: 'var(--dl-card)',
                      border: `1px solid ${goal.done ? 'var(--dl-border)' : (typeof col === 'string' && col.startsWith('#') ? col + '33' : 'var(--dl-border)')}`,
                      borderRadius: CARD_RADIUS,
                      padding: '10px 12px',
                      cursor: dragId ? 'grabbing' : 'pointer',
                      transition: 'opacity 0.15s, box-shadow 0.15s, transform 0.1s',
                      opacity: goal.done ? 0.45 : (dragId === goal.id ? 0.5 : 1),
                      boxShadow: dragId === goal.id ? '0 4px 12px rgba(0,0,0,0.12)' : 'none',
                    }}
                  >
                    {/* Goal name */}
                    <div style={{
                      fontFamily: mono, fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase',
                      color: GOAL_COLOR, fontWeight: 500,
                      textDecoration: goal.done ? 'line-through' : 'none',
                      marginBottom: (goal.habit_count + goal.task_count > 0) ? 6 : 0,
                    }}>
                      {goal.name}
                    </div>

                    {/* Linked counts */}
                    {(goal.habit_count + goal.task_count > 0) && (
                      <div style={{ display: 'flex', gap: 8 }}>
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
                  </div>
                ))}

                {/* Inline new-goal input for this column */}
                {creatingInProject === project ? (
                  <div style={{
                    border: `1px dashed ${typeof col === 'string' && col.startsWith('#') ? col + '55' : 'var(--dl-border)'}`,
                    borderRadius: CARD_RADIUS, padding: '8px 10px',
                  }}>
                    <input
                      autoFocus
                      placeholder="Goal name..."
                      value={newGoalText}
                      onChange={e => setNewGoalText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newGoalText.trim()) createGoalInProject(newGoalText, project);
                        if (e.key === 'Escape') { setCreatingInProject(null); setNewGoalText(''); }
                      }}
                      onBlur={() => {
                        if (newGoalText.trim()) createGoalInProject(newGoalText, project);
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
          })}

          {/* + New column button (opens full detail view for new goal) */}
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
    </div>
  );
}
