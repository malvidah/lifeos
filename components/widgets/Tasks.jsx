"use client";
import { useEffect, useContext, useMemo } from "react";
import { useTheme } from "@/lib/theme";
import { mono, F, projectColor } from "@/lib/tokens";
import { useDbSave } from "@/lib/db";
import { NoteContext, ProjectNamesContext, NavigationContext } from "@/lib/contexts";
import { Shimmer } from "../ui/primitives.jsx";
import { Editor } from "../Editor.jsx";

export function NewProjectTask({ project, onAdd }) {
  const { C } = useTheme();
  const col = projectColor(project);
  const ctxProjects = useContext(ProjectNamesContext);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
      <div style={{ width: 14, height: 14, flexShrink: 0, borderRadius: 3, border: `1.5px solid ${C.border2}`, background: 'transparent' }}/>
      <Editor
        singleLine
        placeholder="Add a task…"
        projectNames={ctxProjects}
        textColor={C.text}
        mutedColor={C.dim}
        color={col}
        style={{ flex: 1, padding: 0 }}
        onEnterCommit={text => { if (text.trim()) onAdd(text); }}
        onBlur={text => { if (text.trim()) onAdd(text); }}
      />
    </div>
  );
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
// Stores as HTML string (like journal). Old format [{id,text,done}] auto-migrates.
// Old [{id,text,done}] JSON is converted to HTML on read; the HTML stores checked state.
function migrateTasksToHtml(raw) {
  if (!raw || typeof raw === 'string') return raw || '';
  if (!Array.isArray(raw)) return '';
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const items = raw.filter(r => r.text).map(r =>
    `<li data-type="taskItem" data-checked="${r.done?'true':'false'}"><p>${esc(r.text)}</p></li>`
  ).join('');
  return items ? `<ul data-type="taskList">${items}</ul>` : '';
}

// Client-side parseTasks — mirrors the API-side version in app/api/_lib/parseTasks.js.
// Handles both storage formats so project-view can toggle/edit tasks regardless of format.
export function clientParseTasks(data) {
  if (Array.isArray(data)) {
    return data.filter(t => t?.text).map((t, i) => ({ id: t.id ?? `old_${i}`, text: t.text, done: !!t.done }));
  }
  if (typeof data === 'string' && data.includes('data-type="taskItem"')) {
    const tasks = []; let idx = 0;
    const re = /<li[^>]*data-type="taskItem"[^>]*data-checked="(true|false)"[^>]*>([\s\S]*?)<\/li>/g;
    let m;
    while ((m = re.exec(data)) !== null) {
      const text = m[2].replace(/<[^>]+>/g, '').trim();
      if (text) tasks.push({ id: `html_${idx++}`, text, done: m[1] === 'true' });
    }
    return tasks;
  }
  return [];
}

// Serialise [{id,text,done}] back to TipTap HTML.
// Used by project-view toggleTask/saveTaskEdit to write back in a consistent format.
export function tasksToHtml(tasks) {
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const items = tasks.filter(t => t.text).map(t =>
    `<li data-type="taskItem" data-checked="${t.done?'true':'false'}"><p>${esc(t.text)}</p></li>`
  ).join('');
  return items ? `<ul data-type="taskList">${items}</ul>` : '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>';
}

// ── Shared task checkbox button — used in both day view and project view ──────
export function TaskCheckbox({ done, onToggle }) {
  const { C } = useTheme();
  return (
    <button
      onClick={onToggle}
      style={{
        width: 15, height: 15, flexShrink: 0, borderRadius: 4, padding: 0,
        cursor: 'pointer', marginTop: 4,
        border: `1.5px solid ${done ? C.blue : C.border2}`,
        background: done ? C.blue : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s',
      }}
    >
      {done && (
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke={C.bg} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1.5,5 4,7.5 8.5,2"/>
        </svg>
      )}
    </button>
  );
}

function injectTaskListStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dl-tasklist-styles')) return;
  const s = document.createElement('style');
  s.id = 'dl-tasklist-styles';
  s.textContent = `
    .dl-editor ul[data-type="taskList"] { list-style:none; padding:0; margin:0; }
    .dl-editor ul[data-type="taskList"] > li { display:flex; align-items:flex-start; gap:10px; padding:3px 0; }
    .dl-editor ul[data-type="taskList"] > li > label { display:flex; align-items:center; margin-top:4px; flex-shrink:0; cursor:pointer; }
    .dl-editor ul[data-type="taskList"] > li > label > input[type="checkbox"] {
      -webkit-appearance:none; appearance:none;
      width:15px; height:15px; min-width:15px; border-radius:4px; margin:0;
      border:1.5px solid var(--task-border,#4A4A52); background:transparent;
      cursor:pointer; transition:all 0.15s;
    }
    .dl-editor ul[data-type="taskList"] > li > label > input[type="checkbox"]:checked {
      background-color:var(--task-color,#4A90D9); border-color:var(--task-color,#4A90D9);
      background-image:url("data:image/svg+xml,%3Csvg width='9' height='9' viewBox='0 0 10 10' fill='none' stroke='%23111' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='1.5,5 4,7.5 8.5,2'/%3E%3C/svg%3E");
      background-repeat:no-repeat; background-position:center;
    }
    .dl-editor ul[data-type="taskList"] > li > div { flex:1; min-width:0; }
    .dl-editor ul[data-type="taskList"] > li[data-checked="true"] > div { opacity:0.45; text-decoration:line-through; }
    [data-filter="open"] .dl-editor ul[data-type="taskList"] > li[data-checked="true"] { display:none; }
    [data-filter="done"] .dl-editor ul[data-type="taskList"] > li[data-checked="false"] { display:none; }
  `;
  document.head.appendChild(s);
}

export default function Tasks({date, token, userId, taskFilter="all"}) {
  const { C } = useTheme();
  const {value, setValue, loaded} = useDbSave(date, 'tasks', '', token, userId);
  const taskProjectNames = useContext(ProjectNamesContext);
  const {navigateToProject, navigateToNote} = useContext(NavigationContext);
  const {notes: ctxNotes} = useContext(NoteContext);

  useEffect(injectTaskListStyles, []);

  const htmlValue = useMemo(() => migrateTasksToHtml(value) || '', [value]);

  if (!loaded) return (
    <div style={{display:'flex',flexDirection:'column',gap:8,padding:'4px 0'}}>
      <Shimmer width="75%" height={13}/><Shimmer width="55%" height={13}/><Shimmer width="65%" height={13}/>
    </div>
  );

  return (
    <div data-filter={taskFilter} style={{'--task-border':C.border2,'--task-color':C.blue}}>
      <Editor
        taskList
        value={htmlValue}
        onUpdate={html => setValue(html)}
        placeholder="Add a task…"
        projectNames={taskProjectNames}
        noteNames={ctxNotes}
        textColor={C.text}
        mutedColor={C.dim}
        color={C.blue}
        onProjectClick={name => navigateToProject(name)}
        onNoteClick={name => navigateToNote(name)}
        style={{padding:0}}
      />
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────
export function TaskFilterBtns({ filter, setFilter }) {
  const { C } = useTheme();
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
    { key: 'open', label: null,  icon: <OpenIcon/> },
    { key: 'done', label: null,  icon: <DoneIcon/> },
    { key: 'all',  label: 'ALL', icon: null },
  ];
  return (
    <div style={{ display:'flex', gap:4 }}>
      {btns.map(b => {
        const active = filter === b.key;
        return (
          <button key={b.key} onClick={e => { e.stopPropagation(); setFilter(b.key); }}
            style={{
              fontFamily: mono, fontSize: '10px', letterSpacing: '0.06em',
              padding: b.label ? '3px 8px' : '3px 6px',
              borderRadius: 4, cursor: 'pointer',
              minHeight: 22,
              background: active ? C.accent+'22' : 'none',
              border: `1px solid ${active ? C.accent : C.border2}`,
              color: active ? C.accent : C.muted,
              display: 'flex', alignItems: 'center', gap: 3,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!active) { e.currentTarget.style.borderColor=C.accent+'66'; e.currentTarget.style.color=C.text; }}}
            onMouseLeave={e => { if (!active) { e.currentTarget.style.borderColor=C.border2; e.currentTarget.style.color=C.muted; }}}
          >
            {b.label || b.icon}
          </button>
        );
      })}
    </div>
  );
}

