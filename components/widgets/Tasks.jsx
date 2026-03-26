"use client";
import { useEffect, useContext, useMemo, useRef, useCallback, useState } from "react";
import { useTheme } from "@/lib/theme";
import { mono, F, projectColor } from "@/lib/tokens";
import { api } from "@/lib/api";
import { NoteContext, ProjectNamesContext, PlaceNamesContext, NavigationContext } from "@/lib/contexts";
import { Shimmer } from "../ui/primitives.jsx";
import { DayLabEditor } from "../Editor.jsx";
import { parseTaskBlocks, tasksToHtml } from "@/lib/parseBlocks";
import { diffTasks, applyDiff } from "@/lib/taskDiff";

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
      setLoaded(true);
    }).catch(() => {
      if (!cancelled) setLoaded(true);
    });

    return () => { cancelled = true; };
  }, [date, token, userId, reloadKey]);

  // Reload when habits card toggles a completion
  useEffect(() => {
    const handler = () => setReloadKey(k => k + 1);
    window.addEventListener('daylab:habits-changed', handler);
    return () => window.removeEventListener('daylab:habits-changed', handler);
  }, []);

  // Diff-based save — debounced 1 second after editor change
  const handleUpdate = useCallback((newHtml) => {
    setHtmlValue(newHtml);

    // Clear previous timer
    clearTimeout(saveTimerRef.current);

    // Debounce 1 second
    saveTimerRef.current = setTimeout(async () => {
      if (savingRef.current) return;
      savingRef.current = true;

      try {
        // Parse current editor HTML into task objects
        const editorTasks = parseTaskBlocks(newHtml);

        // Compute diff against last-known server state
        const diff = diffTasks(serverTasksRef.current, editorTasks);

        // Only save if there are actual changes
        if (diff.toCreate.length || diff.toUpdate.length || diff.toDelete.length) {
          const { hadRecurringDone } = await applyDiff(date, diff, token);

          // Reload from server to get fresh state with IDs
          const fresh = await api.get(`/api/tasks?date=${date}`, token);
          if (fresh?.tasks) {
            serverTasksRef.current = fresh.tasks;
          }

          // If a recurring checkbox was toggled, the editor HTML is now stale
          // (TipTap toggled the checkbox locally, but the server created a
          // separate completion row with different text). Force full reload.
          if (hadRecurringDone && fresh?.tasks) {
            const freshHtml = fresh.data || tasksToHtml(fresh.tasks);
            setHtmlValue(freshHtml);
            setEditorKey(k => k + 1);
          }

          // Notify other components (e.g. HabitsCard) that tasks changed
          window.dispatchEvent(new CustomEvent('daylab:tasks-saved'));
        }
      } catch (err) {
        console.warn('[tasks] diff save failed:', err);
      } finally {
        savingRef.current = false;
      }
    }, 1000);
  }, [date, token]);

  // Flush on unmount / date change
  useEffect(() => {
    return () => clearTimeout(saveTimerRef.current);
  }, [date]);

  // Project filter — CSS injection to hide non-matching tasks
  const filterId = useRef(`tasks-${Math.random().toString(36).slice(2, 8)}`).current;
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
    <div data-filter={taskFilter} data-tasks-id={filterId} style={{
      '--task-border': "var(--dl-border2)",
      '--task-color': "var(--dl-accent)",
      '--task-fill': theme === 'light' ? "var(--dl-bg)" : "var(--dl-middle)",
    }}>
      <DayLabEditor
        key={`${date}-${editorKey}`}
        taskList
        value={htmlValue}
        onUpdate={handleUpdate}
        placeholder=""
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
    </div>
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
    { key: 'open', label: null, icon: <OpenIcon /> },
    { key: 'done', label: null, icon: <DoneIcon /> },
    { key: 'all', label: null, icon: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="12" height="12" rx="2.5"/>
        <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none"/>
      </svg>
    )},
  ];
  return (
    <div style={{ display: 'flex', gap: 2, background: 'var(--dl-border-15, rgba(128,120,100,0.1))', borderRadius: 100, padding: 2 }}>
      {btns.map(b => {
        const active = filter === b.key;
        return (
          <button key={b.key} onClick={e => { e.stopPropagation(); setFilter(b.key); }}
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
