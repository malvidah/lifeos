"use client";
import { useEffect, useContext, useMemo, useRef } from "react";
import { useTheme } from "@/lib/theme";
import { mono, F, projectColor } from "@/lib/tokens";
import { useDbSave } from "@/lib/db";
import { NoteContext, ProjectNamesContext, NavigationContext } from "@/lib/contexts";
import { Shimmer } from "../ui/primitives.jsx";
import { DayLabEditor } from "../Editor.jsx";

export function NewProjectTask({ project, onAdd }) {
  const col = projectColor(project);
  const ctxProjects = useContext(ProjectNamesContext);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
      <div style={{ width: 14, height: 14, flexShrink: 0, borderRadius: 3, border: "1.5px solid var(--dl-border2)", background: 'transparent' }}/>
      <DayLabEditor
        singleLine
        placeholder=""
        projectNames={ctxProjects}
        textColor={"var(--dl-strong)"}
        mutedColor={"var(--dl-middle)"}
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
function migrateTasksToHtml(raw) {
  if (!raw || typeof raw === 'string') return raw || '';
  if (!Array.isArray(raw)) return '';
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const items = raw.filter(r => r.text).map(r =>
    `<li data-type="taskItem" data-checked="${r.done?'true':'false'}"><p>${esc(r.text)}</p></li>`
  ).join('');
  return items ? `<ul data-type="taskList">${items}</ul>` : '';
}

// Client-side parseTasks — exported for use in ProjectView.
export function clientParseTasks(data) {
  if (Array.isArray(data)) {
    return data.filter(t => t?.text).map((t, i) => ({ id: t.id ?? `old_${i}`, text: t.text, done: !!t.done }));
  }
  if (typeof data === 'string' && data.includes('data-type="taskItem"')) {
    const tasks = []; let idx = 0;
    const re = /<li\b([^>]*)>([\s\S]*?)<\/li>/g;
    let m;
    while ((m = re.exec(data)) !== null) {
      const attrs = m[1];
      if (!attrs.includes('data-type="taskItem"')) continue;
      const doneMatch = attrs.match(/data-checked="(true|false)"/);
      const inner = m[2]
        .replace(/<span\b[^>]*\bdata-project-tag="([^"]*)"[^>]*>[^<]*<\/span>/g, '{$1}')
        .replace(/<span\b[^>]*\bdata-note-link="([^"]*)"[^>]*>[^<]*<\/span>/g, '[$1]')
        .replace(/<span\b[^>]*\bdata-date-tag="([^"]*)"[^>]*>[^<]*<\/span>/g, '@$1');
      const text = inner.replace(/<[^>]+>/g, '').trim();
      if (text) tasks.push({ id: `html_${idx++}`, text, done: doneMatch?.[1] === 'true' });
    }
    return tasks;
  }
  return [];
}

// Serialise [{id,text,done}] back to TipTap HTML — exported for ProjectView.
// {name} and [note] tokens in plain text are converted to TipTap chip spans so
// DayLabEditor renders them as clickable chip nodes rather than literal text.
export function tasksToHtml(tasks) {
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  function inlineToHtml(text) {
    const re = /\{([^}]+)\}|\[([^\]]+)\]|@(\d{4}-\d{2}-\d{2})/g;
    let last = 0, out = '', m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out += esc(text.slice(last, m.index));
      if (m[1] != null) {
        const n = m[1];
        out += `<span data-project-tag="${esc(n)}">${esc(n.toUpperCase())}</span>`;
      } else if (m[2] != null) {
        const n = m[2];
        out += `<span data-note-link="${esc(n)}">${esc(n)}</span>`;
      } else {
        const d = m[3];
        const dt = new Date(d + 'T12:00:00');
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const label = months[dt.getMonth()] + ' ' + dt.getDate();
        out += `<span data-date-tag="${esc(d)}">${esc(label)}</span>`;
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) out += esc(text.slice(last));
    return out;
  }
  const items = tasks.filter(t => t.text).map(t =>
    `<li data-type="taskItem" data-checked="${t.done?'true':'false'}"><p>${inlineToHtml(t.text)}</p></li>`
  ).join('');
  return items ? `<ul data-type="taskList">${items}</ul>` : '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>';
}

// ── Shared task checkbox — used in project view ──────────────────────────────
export function TaskCheckbox({ done, onToggle }) {
  return (
    <button
      onClick={onToggle}
      style={{
        width: 15, height: 15, flexShrink: 0, borderRadius: 4, padding: 0,
        cursor: 'pointer', marginTop: 4,
        border: `1.5px solid ${done ? "var(--dl-strong)" : "var(--dl-border2)"}`,
        background: done ? "var(--dl-strong)" : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s',
      }}
    >
      {done && (
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke={"var(--dl-accent)"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1.5,5 4,7.5 8.5,2"/>
        </svg>
      )}
    </button>
  );
}

// Called on every theme change — always updates the existing style element so the
// checkmark SVG (data URI) can't use CSS vars and must be baked in with the accent hex.
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
    .dl-editor ul[data-type="taskList"] > li[data-checked="true"] > div { color:var(--dl-strong); text-decoration:line-through; }
    [data-filter="open"] .dl-editor ul[data-type="taskList"] > li[data-checked="true"] { display:none; }
    [data-filter="done"] .dl-editor ul[data-type="taskList"] > li[data-checked="false"] { display:none; }
    ${date ? `[data-filter="done"] .dl-editor ul[data-type="taskList"] > li[data-checked="true"][data-completed-date]:not([data-completed-date="${date}"]) { display:none; }` : ''}
  `;
}

export default function Tasks({date, token, userId, taskFilter="all", project}) {
  const { theme } = useTheme();
  const {value, setValue, loaded} = useDbSave(date, 'tasks', '', token, userId);
  const taskProjectNames = useContext(ProjectNamesContext);
  const {navigateToProject, navigateToNote} = useContext(NavigationContext);
  const {notes: ctxNotes} = useContext(NoteContext);

  const accentHex = theme === 'light' ? '#B87018' : '#D08828';
  useEffect(() => injectTaskListStyles(accentHex, date), [accentHex, date]);

  const htmlValue = useMemo(() => migrateTasksToHtml(value) || '', [value]);
  const isEmpty = useMemo(() => clientParseTasks(htmlValue).length === 0, [htmlValue]);

  if (!loaded) return (
    <div style={{display:'flex',flexDirection:'column',gap:8,padding:'4px 0'}}>
      <Shimmer width="75%" height={13}/><Shimmer width="55%" height={13}/><Shimmer width="65%" height={13}/>
    </div>
  );

  // When filtering by project, inject CSS to hide non-matching tasks.
  // Each task <li> contains <span data-project-tag="name"> if tagged.
  const filterId = useRef(`tasks-${Math.random().toString(36).slice(2,8)}`).current;
  useEffect(() => {
    if (!project || project === '__everything__') return;
    const style = document.createElement('style');
    style.textContent = `
      [data-tasks-id="${filterId}"] .dl-editor ul[data-type="taskList"] > li:not(:has(span[data-project-tag="${CSS.escape(project)}"])) { display: none; }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, [project, filterId]);

  return (
    <div data-filter={taskFilter} data-tasks-id={filterId} style={{
      '--task-border': "var(--dl-border2)",
      '--task-color':  "var(--dl-accent)",
      '--task-fill':   theme === 'light' ? "var(--dl-bg)" : "var(--dl-middle)",
    }}>
      <div style={{ position: 'relative' }}>
        <DayLabEditor
          key={date}
          taskList
          value={htmlValue}
          onUpdate={html => setValue(html)}
          placeholder=""
          projectNames={taskProjectNames}
          noteNames={ctxNotes}
          textColor={"var(--dl-strong)"}
          mutedColor={"var(--dl-middle)"}
          color={"var(--dl-accent)"}
          onProjectClick={name => navigateToProject(name)}
          onNoteClick={name => navigateToNote(name)}
          style={{padding:0}}
        />
        {isEmpty && !project && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', alignItems: 'flex-start',
            paddingTop: 3, paddingLeft: 25,
            color: 'var(--dl-middle)', pointerEvents: 'none',
            fontFamily: 'inherit', fontSize: 'inherit', lineHeight: '1.7',
          }}>
            Add a task. Use / for commands.
          </div>
        )}
      </div>
    </div>
  );
}


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
    { key: 'open', label: null,  icon: <OpenIcon/> },
    { key: 'done', label: null,  icon: <DoneIcon/> },
    { key: 'all',  label: 'ALL', icon: null },
  ];
  return (
    <div style={{ display:'flex', gap:2, background:'var(--dl-border-15, rgba(128,120,100,0.1))', borderRadius:100, padding:2 }}>
      {btns.map(b => {
        const active = filter === b.key;
        return (
          <button key={b.key} onClick={e => { e.stopPropagation(); setFilter(b.key); }}
            style={{
              fontFamily: mono, fontSize: '10px', letterSpacing: '0.06em',
              padding: b.label ? '4px 10px' : '4px 7px',
              borderRadius: 100, cursor: 'pointer', border: 'none',
              background: active ? "var(--dl-glass-active, var(--dl-accent-13))" : 'transparent',
              color: active ? "var(--dl-strong)" : "var(--dl-middle)",
              display: 'flex', alignItems: 'center', gap: 3,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!active) { e.currentTarget.style.color="var(--dl-strong)"; e.currentTarget.style.background="var(--dl-glass-active, var(--dl-accent-13))"; }}}
            onMouseLeave={e => { if (!active) { e.currentTarget.style.color="var(--dl-middle)"; e.currentTarget.style.background="transparent"; }}}
          >
            {b.label || b.icon}
          </button>
        );
      })}
    </div>
  );
}
