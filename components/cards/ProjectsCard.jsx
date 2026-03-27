"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { mono, F, projectColor, CHIP_TOKENS } from "@/lib/tokens";
import { api } from "@/lib/api";
import { cleanTaskText, displayTaskText } from "@/lib/cleanTaskText";

const GOAL_COLOR = "#5BA89D";
const BACK_STYLE = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--dl-middle)', fontFamily: mono, fontSize: 18, padding: 0, lineHeight: 1, flexShrink: 0 };

/* ────────────────────────────────────────────────────────────────────────────
   Goal Detail View — handles both viewing existing goals and creating new ones.
   Props:
     goal       – goal object (stub for new, full for existing)
     token      – auth token
     isNew      – true = creation mode
     onBack     – return to kanban
     onCreated  – called with new goal after creation
     onUpdated  – called after any mutation
     allProjects – list of project names for the project picker
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

  // Auto-focus name for new goals
  useEffect(() => { if (isNew && nameRef.current) nameRef.current.focus(); }, [isNew]);

  // Escape to cancel in new mode
  useEffect(() => {
    if (!isNew || saved) return;
    const onKey = e => { if (e.key === 'Escape') onBack(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isNew, saved, onBack]);

  // Fetch linked tasks & habits for existing goals
  const fetchLinked = useCallback(async () => {
    if (!goal?.name || isNew) return;
    setLoadingLinks(true);
    try {
      const res = await api.get(`/api/goals/linked?name=${encodeURIComponent(goal.name)}`, token);
      if (res) {
        setLinkedTasks(res.tasks || []);
        setLinkedHabits(res.habits || []);
      }
    } catch { /* linked endpoint may not exist yet */ }
    setLoadingLinks(false);
  }, [goal?.name, isNew, token]);

  useEffect(() => { fetchLinked(); }, [fetchLinked]);

  // Create goal
  const doCreate = async () => {
    if (!editName.trim()) return;
    try {
      const res = await api.post('/api/goals', {
        name: editName.trim(),
        project: editProject || null,
      }, token);
      setSaved(true);
      window.dispatchEvent(new Event('daylab:goals-changed'));
      onCreated?.(res?.goal);
    } catch { /* toast handled by api layer */ }
  };

  // Patch goal field
  const patchGoal = async (updates) => {
    if (!goal?.id) return;
    try {
      await api.patch('/api/goals', { id: goal.id, ...updates }, token);
      window.dispatchEvent(new Event('daylab:goals-changed'));
      onUpdated?.();
    } catch { /* toast handled */ }
  };

  // Debounced name save
  const onNameChange = (val) => {
    setEditName(val);
    if (isNew) return;
    clearTimeout(nameTimer.current);
    nameTimer.current = setTimeout(() => {
      if (val.trim() && val.trim() !== goal.name) patchGoal({ name: val.trim() });
    }, 800);
  };

  // Project pick
  const onProjectPick = (p) => {
    setEditProject(p);
    setShowProjectPicker(false);
    if (!isNew && saved) patchGoal({ project: p || null });
  };

  const projColor = editProject ? projectColor(editProject) : 'var(--dl-middle)';

  return (
    <div>
      {/* Header: back + name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <button onClick={onBack} style={BACK_STYLE}>‹</button>
        <input
          ref={nameRef}
          value={editName}
          onChange={e => onNameChange(e.target.value)}
          placeholder={isNew ? 'Goal name...' : ''}
          onKeyDown={e => { if (e.key === 'Enter' && isNew && !saved) doCreate(); }}
          style={{
            flex: 1, fontFamily: mono, fontSize: 14, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.04em',
            color: GOAL_COLOR, background: 'transparent', border: 'none', outline: 'none', padding: 0,
          }}
        />
        {/* Done toggle for existing goals */}
        {!isNew && (
          <button
            onClick={() => patchGoal({ done: !goal.done })}
            style={{
              fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
              background: goal.done ? GOAL_COLOR : 'transparent',
              color: goal.done ? '#fff' : 'var(--dl-middle)',
              border: `1px solid ${goal.done ? GOAL_COLOR : 'var(--dl-border)'}`,
              borderRadius: 6, padding: '4px 10px', cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {goal.done ? '✓ done' : 'done'}
          </button>
        )}
      </div>

      {/* Chips row: project */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        {showProjectPicker ? (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {allProjects.map(p => (
              <button key={p} onClick={() => onProjectPick(p)} style={{
                ...CHIP_TOKENS.project(projectColor(p)), cursor: 'pointer', border: 'none',
                opacity: p === editProject ? 1 : 0.5,
              }}>⛰️ {p}</button>
            ))}
            <button onClick={() => onProjectPick('')} style={{
              ...CHIP_TOKENS.project('var(--dl-middle)'), cursor: 'pointer', border: 'none', opacity: 0.5,
            }}>none</button>
          </div>
        ) : (
          <button onClick={() => setShowProjectPicker(true)} style={{
            ...CHIP_TOKENS.project(projColor), cursor: 'pointer', border: 'none',
            opacity: editProject ? 1 : 0.5,
          }}>
            {editProject ? `⛰️ ${editProject}` : '+ project'}
          </button>
        )}
      </div>

      {/* New goal: create button */}
      {isNew && !saved && (
        <button
          onClick={doCreate}
          disabled={!editName.trim()}
          style={{
            fontFamily: mono, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
            background: editName.trim() ? GOAL_COLOR : 'var(--dl-surface)',
            color: editName.trim() ? '#fff' : 'var(--dl-middle)',
            border: 'none', borderRadius: 8, padding: '8px 16px', cursor: editName.trim() ? 'pointer' : 'default',
            transition: 'all 0.15s', marginBottom: 8,
          }}
        >
          Create Goal
        </button>
      )}

      {/* Existing goal: linked items */}
      {!isNew && (
        <>
          {/* Linked Habits */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--dl-middle)', marginBottom: 4 }}>
              Habits · {linkedHabits.length}
            </div>
            {linkedHabits.length === 0 && !loadingLinks && (
              <div style={{ fontFamily: mono, fontSize: 11, color: 'var(--dl-border2)', padding: '4px 0' }}>
                Tag a habit with /g {goal.name} to link it
              </div>
            )}
            {linkedHabits.map(h => (
              <div key={h.id} style={{
                fontFamily: mono, fontSize: 12, color: 'var(--dl-strong)',
                padding: '5px 0', borderBottom: '1px solid var(--dl-border)',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{ color: 'var(--dl-accent)', fontSize: 11 }}>🎯</span>
                {displayTaskText(h.text)}
              </div>
            ))}
          </div>

          {/* Linked Tasks */}
          <div>
            <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--dl-middle)', marginBottom: 4 }}>
              Tasks · {linkedTasks.length}
            </div>
            {linkedTasks.length === 0 && !loadingLinks && (
              <div style={{ fontFamily: mono, fontSize: 11, color: 'var(--dl-border2)', padding: '4px 0' }}>
                Tag a task with /g {goal.name} to link it
              </div>
            )}
            {linkedTasks.map(t => (
              <div key={t.id} style={{
                fontFamily: mono, fontSize: 12, color: 'var(--dl-strong)',
                padding: '5px 0', borderBottom: '1px solid var(--dl-border)',
                display: 'flex', alignItems: 'center', gap: 6,
                opacity: t.done ? 0.5 : 1,
                textDecoration: t.done ? 'line-through' : 'none',
              }}>
                <span style={{ fontSize: 11, color: t.done ? 'var(--dl-accent)' : 'var(--dl-border2)' }}>
                  {t.done ? '✓' : '○'}
                </span>
                {displayTaskText(t.text)}
              </div>
            ))}
          </div>

          {/* Delete */}
          <button
            onClick={async () => {
              if (!confirm('Delete this goal? Linked tasks won\'t be deleted.')) return;
              await api.delete(`/api/goals?id=${goal.id}`, token);
              window.dispatchEvent(new Event('daylab:goals-changed'));
              onBack();
            }}
            style={{
              fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--dl-middle)', background: 'none', border: 'none', cursor: 'pointer',
              marginTop: 12, padding: 0, opacity: 0.6,
            }}
          >
            Delete goal
          </button>
        </>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Main card — Kanban list of goals grouped by project
   ──────────────────────────────────────────────────────────────────────────── */
export default function ProjectsCard({ token, date, onSelectDate }) {
  const [view, setView] = useState('kanban');
  const [goals, setGoals] = useState([]);
  const [selectedGoal, setSelectedGoal] = useState(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [loading, setLoading] = useState(false);

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

  const grouped = goals.reduce((acc, g) => {
    const p = g.project || 'unassigned';
    if (!acc[p]) acc[p] = [];
    acc[p].push(g);
    return acc;
  }, {});
  const projectNames = Object.keys(grouped).sort((a, b) => a === 'unassigned' ? 1 : b === 'unassigned' ? -1 : a.localeCompare(b));
  const allProjectOptions = [...new Set(goals.map(g => g.project).filter(Boolean))].sort();

  // ─── New Goal Detail ────────────────────────────────────────────────────────
  if (creatingNew) {
    const stub = { name: '', project: '', done: false };
    return (
      <GoalDetailView
        goal={stub} token={token} isNew
        onBack={() => setCreatingNew(false)}
        onCreated={(newGoal) => { setCreatingNew(false); refresh(); if (newGoal) { setSelectedGoal(newGoal); setView('detail'); } }}
        onUpdated={refresh}
        allProjects={allProjectOptions}
      />
    );
  }

  // ─── Existing Goal Detail ───────────────────────────────────────────────────
  if (view === 'detail' && selectedGoal) {
    const live = goals.find(g => g.id === selectedGoal.id) || selectedGoal;
    return (
      <GoalDetailView
        goal={live} token={token}
        onBack={() => { setView('kanban'); setSelectedGoal(null); }}
        onUpdated={() => { refresh(); }}
        allProjects={allProjectOptions}
      />
    );
  }

  // ─── Kanban ─────────────────────────────────────────────────────────────────
  const activeGoals = goals.filter(g => !g.done);
  const doneGoals = goals.filter(g => g.done);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* + New button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 2 }}>
        <button
          onClick={() => setCreatingNew(true)}
          style={{
            fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: 'var(--dl-middle)', background: 'none', border: 'none', cursor: 'pointer',
            padding: 0, transition: 'color 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.color = GOAL_COLOR}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--dl-middle)'}
        >
          + new
        </button>
      </div>

      {/* Empty state */}
      {goals.length === 0 && !loading && (
        <div style={{ fontFamily: mono, fontSize: 12, color: 'var(--dl-middle)', padding: '12px 0', textAlign: 'center', letterSpacing: '0.04em' }}>
          No goals yet. Tap <span style={{ color: GOAL_COLOR }}>+ new</span> or tag a task with <span style={{ color: GOAL_COLOR }}>/g</span>
        </div>
      )}

      {/* Goal rows grouped by project */}
      {projectNames.map(project => {
        const items = grouped[project];
        const col = project === 'unassigned' ? 'var(--dl-middle)' : projectColor(project);
        return (
          <div key={project} style={{ marginBottom: 6 }}>
            {/* Project header */}
            <div style={{
              fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: col, marginBottom: 3, opacity: 0.7,
            }}>
              {project}
            </div>

            {/* Goals */}
            {items.map(goal => (
              <div
                key={goal.id}
                onClick={() => { setSelectedGoal(goal); setView('detail'); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 0',
                  borderBottom: '1px solid var(--dl-border)',
                  cursor: 'pointer', transition: 'opacity 0.15s',
                  opacity: goal.done ? 0.4 : 1,
                }}
              >
                {/* Check indicator */}
                <span style={{
                  fontFamily: mono, fontSize: 11, color: goal.done ? GOAL_COLOR : 'var(--dl-border2)',
                  flexShrink: 0, width: 14, textAlign: 'center',
                }}>
                  {goal.done ? '✓' : '○'}
                </span>

                {/* Name */}
                <span style={{
                  fontFamily: mono, fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase',
                  color: GOAL_COLOR, flex: 1,
                  textDecoration: goal.done ? 'line-through' : 'none',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {goal.name}
                </span>

                {/* Counts */}
                <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--dl-border2)', flexShrink: 0 }}>
                  {goal.habit_count + goal.task_count > 0 ? `${goal.habit_count}h · ${goal.task_count}t` : ''}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
