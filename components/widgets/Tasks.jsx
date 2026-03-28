"use client";
import { useEffect, useContext, useMemo, useRef, useCallback, useState } from "react";
import { useTheme } from "@/lib/theme";
import { mono, F, projectColor } from "@/lib/tokens";
import { api } from "@/lib/api";
import { NoteContext, ProjectNamesContext, PlaceNamesContext, NavigationContext } from "@/lib/contexts";
import { Shimmer } from "../ui/primitives.jsx";
import { DayLabEditor } from "../Editor.jsx";
import { parseTaskBlocks, tasksToHtml } from "@/lib/parseBlocks";
import { diffTasks, applyDiff, isHabitOrRecurring } from "@/lib/taskDiff";
import { markLocalSave } from "@/lib/useRealtimeSync";
import { showToast } from "../ui/Toast.jsx";
import { useTip } from "@/lib/useTip";
import Tip from "../ui/Tip.jsx";

// Detect which tasks changed done state between two parsed task arrays.
// Returns array of { task_id, done, serverTask } for habits whose done state flipped.
function detectHabitToggles(editorTasks, serverById) {
  const toggles = [];
  for (const et of editorTasks) {
    if (!et.task_id) continue;
    const st = serverById.get(et.task_id);
    if (!st || !isHabitOrRecurring(st) || et.done === st.done) continue;
    toggles.push({ task_id: et.task_id, done: et.done, serverTask: st });
  }
  return toggles;
}

// ── Shared task checkbox — used in project view ──────────────────────────────
export function TaskCheckbox({ done, onToggle }) {
  return (
    <button
      onMouseDown={e => { e.preventDefault(); onToggle(); }}
      style={{
        width: 15, height: 15, flexShrink: 0, borderRadius: 4, padding: 0,
        cursor: 'pointer', marginTop: 4,
        border: `1.5px solid ${done ? "var(--dl-accent)" : "var(--dl-border2)"}`,
        background: done ? "var(--dl-accent)" : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s',
      }}
    >
      {done && (
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1.5,5 4,7.5 8.5,2"/>
        </svg>
      )}
    </button>
  );
}

// Inject checkbox styles for the TipTap task list
export function injectTaskListStyles(accentHex, date) {
  if (typeof document === 'undefined') return;
  let s = document.getElementById('dl-tasklist-styles');
  if (!s) { s = document.createElement('style'); s.id = 'dl-tasklist-styles'; document.head.appendChild(s); }
  const enc = encodeURIComponent(accentHex);
  s.textContent = `
    .dl-editor ul[data-type="taskList"] { list-style:none; padding:0; margin:0; }
    .dl-editor ul[data-type="taskList"] > li { display:flex; align-items:flex-start; gap:10px; padding:3px 0; }
    .dl-editor ul[data-type="taskList"] > li > label { display:flex; align-items:center; margin-top:4px; flex-shrink:0; cursor:pointer; }
    .dl-editor ul[data-type="taskList"] > li > label > input[type="checkbox"] {
      -webkit-appearance:none; appearance:none;
      width:15px; height:15px; min-width:15px; border-radius:4px; margin:0;
      border:1.5px solid var(--task-border,var(--dl-border2)); background:transparent;
      cursor:pointer; transition:all 0.15s;
    }
    .dl-editor ul[data-type="taskList"] > li > label > input[type="checkbox"]:checked {
      background-color:var(--task-fill); border-color:var(--task-color);
      background-image:url("data:image/svg+xml,%3Csvg width='9' height='9' viewBox='0 0 10 10' fill='none' stroke='${enc}' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='1.5%2C5 4%2C7.5 8.5%2C2'/%3E%3C/svg%3E");
      background-repeat:no-repeat; background-position:center;
    }
    .dl-editor ul[data-type="taskList"] > li > div { flex:1; min-width:0; }
    .dl-editor ul[data-type="taskList"] > li[data-checked="true"] > div { color:var(--dl-middle); text-decoration:line-through; }
    .dl-editor ul[data-type="taskList"] > li[data-checked="true"] > div span { text-decoration:none; }
    [data-filter="open"] .dl-editor ul[data-type="taskList"] > li[data-checked="true"] { display:none; }
    [data-filter="done"] .dl-editor ul[data-type="taskList"] > li[data-checked="false"] { display:none; }
    ${date ? `[data-filter="done"] .dl-editor ul[data-type="taskList"] > li[data-checked="true"][data-completed-date]:not([data-completed-date="${date}"]) { display:none; }` : ''}
  `;
}

// ── Main Tasks component — single TipTap editor with diff-based save ─────────
export default function Tasks({ date, token, userId, taskFilter = "all", project }) {
  const { theme } = useTheme();
  const projectNames = useContext(ProjectNamesContext);
  const { notes: noteNames } = useContext(NoteContext);
  const placeNames = useContext(PlaceNamesContext);
  const { navigateToProject, navigateToNote } = useContext(NavigationContext);

  // Contextual tips
  const slashTip = useTip('tip-slash-commands');
  const projectTagTip = useTip('tip-project-tag');
  const editorWrapRef = useRef(null);
  const firstUpdateRef = useRef(true); // track first handleUpdate call

  // State
  const [loaded, setLoaded] = useState(false);
  const [htmlValue, setHtmlValue] = useState('');
  const [editorKey, setEditorKey] = useState(0); // increment to force editor remount
  const serverTasksRef = useRef([]); // Last-known server state for diffing
  const saveTimerRef = useRef(null);
  const savingRef = useRef(false);

  // Inject checkbox styles
  const accentHex = theme === 'light' ? '#C07818' : '#D08828';
  useEffect(() => injectTaskListStyles(accentHex, date), [accentHex, date]);

  // Load tasks from server
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!token || !userId || !date) return;
    let cancelled = false;

    api.get(`/api/tasks?date=${date}`, token).then(d => {
      if (cancelled) return;
      const tasks = d?.tasks ?? [];
      serverTasksRef.current = tasks;

      // Convert structured tasks to HTML for the editor
      const html = d?.data || tasksToHtml(tasks);
      setHtmlValue(html);
      lastHtmlRef.current = html;
      setLoaded(true);
    }).catch(() => {
      if (!cancelled) { setLoaded(true); showToast('Failed to load tasks', 'error'); }
    });

    return () => { cancelled = true; };
  }, [date, token, userId, reloadKey]);

  // Reload when habits card toggles a completion or external device saves tasks
  useEffect(() => {
    const handler = () => {
      // Don't reload if we're in the middle of a save — would cause conflicts
      if (savingRef.current) return;
      setReloadKey(k => k + 1);
    };
    window.addEventListener('daylab:habits-changed', handler);
    return () => {
      window.removeEventListener('daylab:habits-changed', handler);
    };
  }, []);

  // Fire habit toggle API calls and update local server state (no re-fetch needed).
  // Returns true if any habits were toggled.
  const fireHabitToggles = useCallback(async (toggles) => {
    if (!toggles.length) return false;
    markLocalSave("tasks", date);
    const promises = toggles.map(({ task_id, done, serverTask }) => {
      if (done) {
        return api.post('/api/tasks/complete-recurring', { template_id: serverTask.id, date }, token);
      } else {
        return api.delete(`/api/tasks/complete-recurring?habit_id=${serverTask.id}&date=${date}`, token);
      }
    });
    await Promise.all(promises);

    // Update local server state to reflect the toggles — avoids a full re-fetch
    for (const { task_id, done } of toggles) {
      const idx = serverTasksRef.current.findIndex(t => t.id === task_id);
      if (idx >= 0) {
        serverTasksRef.current[idx] = { ...serverTasksRef.current[idx], done, completed_at: done ? date : null };
      }
    }
    return true;
  }, [date, token]);

  // Fast path: detect habit checkbox toggles immediately (no debounce).
  // The HTML is compared against server state to find done-state flips on habits.
  const lastHtmlRef = useRef('');
  const habitToggleInFlightRef = useRef(false);

  const handleUpdate = useCallback((newHtml) => {
    setHtmlValue(newHtml);
    const prevHtml = lastHtmlRef.current;
    lastHtmlRef.current = newHtml;

    // Tip: show slash-command hint on first real edit
    if (firstUpdateRef.current && prevHtml) {
      firstUpdateRef.current = false;
      slashTip.show();
    }

    // Tip: detect first project tag creation (show() is a no-op if already shown)
    if (newHtml.includes('data-project-tag') && (!prevHtml || !prevHtml.includes('data-project-tag'))) {
      projectTagTip.show();
    }

    // Fast path: immediately fire habit toggles without waiting for debounce.
    // Parse both old and new to detect checkbox-only changes.
    if (!habitToggleInFlightRef.current && prevHtml) {
      const editorTasks = parseTaskBlocks(newHtml);
      const serverById = new Map(serverTasksRef.current.filter(t => t.id).map(t => [t.id, t]));
      const toggles = detectHabitToggles(editorTasks, serverById);
      if (toggles.length > 0) {
        habitToggleInFlightRef.current = true;
        fireHabitToggles(toggles).then(changed => {
          if (changed) window.dispatchEvent(new CustomEvent('daylab:tasks-saved'));
        }).catch(err => {
          console.warn('[habit-toggle] fast path failed:', err);
          showToast('Failed to save habit', 'error');
        }).finally(() => {
          habitToggleInFlightRef.current = false;
        });
      }
    }

    // Debounced path: handle text edits, creates, deletes, regular task done toggles
    clearTimeout(saveTimerRef.current);
    window.dispatchEvent(new CustomEvent('daylab:tasks-saving'));
    saveTimerRef.current = setTimeout(async () => {
      if (savingRef.current) return;
      savingRef.current = true;

      try {
        const editorTasks = parseTaskBlocks(newHtml);
        const serverById = new Map(serverTasksRef.current.filter(t => t.id).map(t => [t.id, t]));

        // Check for habit toggles that the fast path may have missed
        // (e.g. if fast path was in-flight when another toggle happened)
        const toggles = detectHabitToggles(editorTasks, serverById);
        let habitChanged = false;
        if (toggles.length > 0 && !habitToggleInFlightRef.current) {
          try {
            habitChanged = await fireHabitToggles(toggles);
          } catch (err) {
            console.warn('[habit-toggle] debounced path failed:', err);
            showToast('Failed to save habit', 'error');
          }
        }

        // Diff everything else (text edits, regular tasks, creates, deletes)
        const diff = diffTasks(serverTasksRef.current, editorTasks);
        const hasChanges = diff.toCreate.length || diff.toUpdate.length || diff.toDelete.length;

        if (hasChanges) {
          markLocalSave("tasks", date);
          await applyDiff(date, diff, token);
          // Reflect updates locally so subsequent diffs see the new state
          for (const u of diff.toUpdate) {
            const idx = serverTasksRef.current.findIndex(t => t.id === u.id);
            if (idx >= 0) {
              serverTasksRef.current[idx] = { ...serverTasksRef.current[idx], text: u.text, html: u.html, done: u.done, position: u.position };
            }
          }
        }

        // Only re-fetch from server when structure changed (creates/deletes need new IDs).
        // After re-fetch, the editor reloads with correct data-task-id attrs injected by GET.
        if (diff.toCreate.length || diff.toDelete.length) {
          const fresh = await api.get(`/api/tasks?date=${date}`, token);
          if (fresh?.tasks) {
            serverTasksRef.current = fresh.tasks;
            // Reload editor so new tasks get their data-task-id from the fresh GET response
            const freshHtml = fresh.data || tasksToHtml(fresh.tasks);
            setHtmlValue(freshHtml);
            lastHtmlRef.current = freshHtml;
            setEditorKey(k => k + 1);
          }
        }

        window.dispatchEvent(new CustomEvent('daylab:tasks-saved'));
      } catch (err) {
        console.warn('[tasks] diff save failed:', err);
        showToast('Failed to save tasks', 'error');
        // Clear indicator on error too
        window.dispatchEvent(new CustomEvent('daylab:tasks-saved'));
      } finally {
        savingRef.current = false;
      }
    }, 1000);
  }, [date, token, fireHabitToggles]);

  // Flush on unmount / date change
  useEffect(() => {
    return () => clearTimeout(saveTimerRef.current);
  }, [date]);

  // Stable ID for CSS selectors (used by project filter + AI highlight)
  const filterId = useRef(`tasks-${Math.random().toString(36).slice(2, 8)}`).current;

  // AI highlight — pulse new/changed tasks while accept/reject is pending
  const aiStyleRef = useRef(null);
  useEffect(() => {
    const onPending = (e) => {
      const types = e.detail?.types || [];
      if (!types.includes('tasks')) return;
      if (aiStyleRef.current) aiStyleRef.current.remove();
      const s = document.createElement('style');
      s.textContent = `
        @keyframes dl-ai-pulse {
          0%, 100% { border-left-color: var(--dl-accent); }
          50% { border-left-color: transparent; }
        }
        [data-tasks-id="${filterId}"] .dl-editor ul[data-type="taskList"] > li {
          border-left: 2.5px solid var(--dl-accent);
          padding-left: 8px;
          animation: dl-ai-pulse 2s ease-in-out infinite;
          transition: border-left-color 0.3s, padding-left 0.3s;
        }
      `;
      document.head.appendChild(s);
      aiStyleRef.current = s;
    };
    const onResolved = () => {
      if (aiStyleRef.current) { aiStyleRef.current.remove(); aiStyleRef.current = null; }
    };
    window.addEventListener('daylab:ai-pending', onPending);
    window.addEventListener('daylab:ai-resolved', onResolved);
    return () => {
      window.removeEventListener('daylab:ai-pending', onPending);
      window.removeEventListener('daylab:ai-resolved', onResolved);
      if (aiStyleRef.current) aiStyleRef.current.remove();
    };
  }, [filterId]);
  useEffect(() => {
    if (!project || project === '__everything__') return;
    const style = document.createElement('style');
    style.textContent = `
      [data-tasks-id="${filterId}"] .dl-editor ul[data-type="taskList"] > li:not(:has(span[data-project-tag="${CSS.escape(project)}"])) { display: none; }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, [project, filterId]);

  if (!loaded) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
      <Shimmer width="75%" height={13} /><Shimmer width="55%" height={13} /><Shimmer width="65%" height={13} />
    </div>
  );

  return (
    <div ref={editorWrapRef} data-filter={taskFilter} data-tasks-id={filterId} style={{
      '--task-border': "var(--dl-border2)",
      '--task-color': "var(--dl-accent)",
      '--task-fill': theme === 'light' ? "var(--dl-bg)" : "var(--dl-middle)",
    }}>
      <DayLabEditor
        key={`${date}-${editorKey}`}
        taskList
        value={htmlValue}
        onUpdate={handleUpdate}
        placeholder="Type a task, use / for commands"
        projectNames={projectNames}
        noteNames={noteNames}
        placeNames={placeNames}
        textColor={"var(--dl-strong)"}
        mutedColor={"var(--dl-middle)"}
        color={"var(--dl-accent)"}
        onProjectClick={name => navigateToProject(name)}
        onNoteClick={name => navigateToNote(name)}
        style={{ padding: 0 }}
      />
      <Tip visible={slashTip.visible} message="Tip: type / to see all commands — habits, projects, dates, and more" anchorRef={editorWrapRef} position="below" onDismiss={slashTip.dismiss} />
      <Tip visible={projectTagTip.visible} message="This project now appears on your mountain range!" anchorRef={editorWrapRef} position="below" onDismiss={projectTagTip.dismiss} />
    </div>
  );
}

// ── Save indicator ───────────────────────────────────────────────────────────
export function TaskSaveIndicator() {
  const [status, setStatus] = useState(null); // 'saving' | 'saved' | null
  const timerRef = useRef(null);

  useEffect(() => {
    // Show "saving..." when tasks start debounced save (content changes)
    const onUpdate = () => {
      clearTimeout(timerRef.current);
      setStatus('saving');
      // Safety: auto-clear after 5s in case saved event is never fired
      timerRef.current = setTimeout(() => setStatus(null), 5000);
    };
    // Show "saved" when save completes
    const onSaved = () => {
      setStatus('saved');
      timerRef.current = setTimeout(() => setStatus(null), 2000);
    };
    window.addEventListener('daylab:tasks-saving', onUpdate);
    window.addEventListener('daylab:tasks-saved', onSaved);
    return () => {
      window.removeEventListener('daylab:tasks-saving', onUpdate);
      window.removeEventListener('daylab:tasks-saved', onSaved);
      clearTimeout(timerRef.current);
    };
  }, []);

  if (!status) return null;
  return (
    <span style={{
      fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)',
      letterSpacing: '0.04em', opacity: status === 'saved' ? 0.6 : 0.8,
      transition: 'opacity 0.3s',
    }}>
      {status === 'saving' ? 'saving...' : 'saved'}
    </span>
  );
}

// ── Task filter buttons ──────────────────────────────────────────────────────
export function TaskFilterBtns({ filter, setFilter }) {
  const OpenIcon = () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="2.5"/>
    </svg>
  );
  const DoneIcon = () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="2.5"/>
      <polyline points="5,8.5 7,10.5 11,6"/>
    </svg>
  );
  const btns = [
    { key: 'open', label: null, icon: <OpenIcon />, ariaLabel: 'Show open tasks' },
    { key: 'done', label: null, icon: <DoneIcon />, ariaLabel: 'Show done tasks' },
    { key: 'all', label: null, icon: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="12" height="12" rx="2.5"/>
        <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none"/>
      </svg>
    ), ariaLabel: 'Show all tasks' },
  ];
  return (
    <div style={{ display: 'flex', gap: 2, background: 'var(--dl-border-15, rgba(128,120,100,0.1))', borderRadius: 100, padding: 2 }}>
      {btns.map(b => {
        const active = filter === b.key;
        return (
          <button key={b.key} onClick={e => { e.stopPropagation(); setFilter(b.key); }}
            aria-label={b.ariaLabel} aria-pressed={active}
            style={{
              fontFamily: mono, fontSize: '10px', letterSpacing: '0.06em',
              padding: '3px 6px',
              borderRadius: 100, cursor: 'pointer', border: 'none',
              background: active ? "var(--dl-glass-active, var(--dl-accent-13))" : 'transparent',
              color: active ? "var(--dl-strong)" : "var(--dl-middle)",
              display: 'flex', alignItems: 'center', gap: 3,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!active) { e.currentTarget.style.color = "var(--dl-strong)"; e.currentTarget.style.background = "var(--dl-glass-active, var(--dl-accent-13))"; }}}
            onMouseLeave={e => { if (!active) { e.currentTarget.style.color = "var(--dl-middle)"; e.currentTarget.style.background = "transparent"; }}}
          >
            {b.label || b.icon}
          </button>
        );
      })}
    </div>
  );
}
