"use client";
import { useState, useEffect, useRef, useCallback, useContext, useMemo, Fragment } from "react";
import { useTheme } from "@/lib/theme";
import { serif, mono, F, R, projectColor } from "@/lib/tokens";
import { useDbSave } from "@/lib/db";
import { NoteContext, ProjectNamesContext, NavigationContext } from "@/lib/contexts";
import { RichLine, Shimmer } from "../ui/primitives.jsx";
import { DayLabEditor } from "../DayLabEditor.jsx";

function NewProjectTask({ project, onAdd }) {
  const { C } = useTheme();
  const col = projectColor(project);
  const ctxProjects = useContext(ProjectNamesContext);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
      <div style={{ width: 14, height: 14, flexShrink: 0, borderRadius: 3, border: `1.5px solid ${C.border2}`, background: 'transparent' }}/>
      <DayLabEditor
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
function clientParseTasks(data) {
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
function tasksToHtml(tasks) {
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const items = tasks.filter(t => t.text).map(t =>
    `<li data-type="taskItem" data-checked="${t.done?'true':'false'}"><p>${esc(t.text)}</p></li>`
  ).join('');
  return items ? `<ul data-type="taskList">${items}</ul>` : '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>';
}

// ── Shared task checkbox button — used in both day view and project view ──────
function TaskCheckbox({ done, onToggle }) {
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

export default function Tasks({date, token, userId, taskFilter="all"}) {
  const { C } = useTheme();
  const {value, setValue, loaded} = useDbSave(date, 'tasks', '', token, userId);
  const taskProjectNames = useContext(ProjectNamesContext);
  const {navigateToProject, navigateToNote} = useContext(NavigationContext);
  const {notes: ctxNotes} = useContext(NoteContext);
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');

  // Parse tasks from either storage format
  const tasks = useMemo(() => {
    if (Array.isArray(value)) return migrateTasksToHtml(value) ? clientParseTasks(migrateTasksToHtml(value)) : [];
    return clientParseTasks(value || '');
  }, [value]);

  const saveTasks = (updated) => setValue(tasksToHtml(updated));

  const toggle = (id) => saveTasks(tasks.map(t => t.id === id ? {...t, done: !t.done} : t));

  const saveEdit = (id, text) => {
    if (!text.trim()) { saveTasks(tasks.filter(t => t.id !== id)); }
    else { saveTasks(tasks.map(t => t.id === id ? {...t, text: text.trim()} : t)); }
    setEditingId(null);
  };

  const addTask = (text) => {
    if (!text.trim()) return;
    saveTasks([...tasks, {id: crypto.randomUUID(), text: text.trim(), done: false}]);
  };

  const filtered = tasks.filter(t =>
    taskFilter === 'open' ? !t.done :
    taskFilter === 'done' ? t.done : true
  );

  if (!loaded) return (
    <div style={{display:'flex',flexDirection:'column',gap:8,padding:'4px 0'}}>
      <Shimmer width="75%" height={13}/><Shimmer width="55%" height={13}/><Shimmer width="65%" height={13}/>
    </div>
  );

  return (
    <div style={{display:'flex', flexDirection:'column', gap:0}}>
      {/* Add new task row — hidden when filter is done-only */}
      {taskFilter !== 'done' && (
        <div style={{display:'flex', alignItems:'flex-start', gap:10, padding:'3px 0', marginBottom:4}}>
          <TaskCheckbox done={false} onToggle={() => {}} />
          <DayLabEditor
            singleLine
            placeholder="Add a task…"
            projectNames={taskProjectNames}
            noteNames={ctxNotes}
            textColor={C.text}
            mutedColor={C.dim}
            color={C.blue}
            style={{flex:1, padding:0, minHeight:'1.7em'}}
            onProjectClick={name => navigateToProject(name)}
            onNoteClick={name => navigateToNote(name)}
            onEnterCommit={addTask}
            onBlur={text => { if (text.trim()) addTask(text.trim()); }}
          />
        </div>
      )}
      {filtered.length === 0 && taskFilter !== 'all' && (
        <div style={{fontFamily:mono, fontSize:F.sm, color:C.dim, padding:'4px 0'}}>
          {taskFilter === 'open' ? 'No open tasks.' : 'No completed tasks.'}
        </div>
      )}
      {filtered.map(task => (
        <div key={task.id} style={{
          display:'flex', alignItems:'flex-start', gap:10, padding:'3px 0',
        }}>
          <TaskCheckbox done={task.done} onToggle={() => toggle(task.id)} />
          {editingId === task.id ? (
            <DayLabEditor
              autoFocus singleLine
              value={editingText}
              textColor={task.done ? C.muted : C.text}
              mutedColor={C.dim}
              color={C.blue}
              style={{flex:1, padding:0, minHeight:'1.7em',
                textDecoration: task.done ? 'line-through' : 'none'}}
              projectNames={taskProjectNames}
              noteNames={ctxNotes}
              onProjectClick={name => navigateToProject(name)}
              onNoteClick={name => navigateToNote(name)}
              onBlur={text => saveEdit(task.id, text)}
              onEnterCommit={text => saveEdit(task.id, text)}
            />
          ) : (
            <div
              onClick={() => { setEditingId(task.id); setEditingText(task.text); }}
              style={{flex:1, fontFamily:serif, fontSize:F.md, lineHeight:'1.7',
                color: task.done ? C.muted : C.text, cursor:'text',
                textDecoration: task.done ? 'line-through' : 'none',
                opacity: task.done ? 0.45 : 1,
                whiteSpace:'pre-wrap', wordBreak:'break-word'}}
            >
              <RichLine text={task.text} />
            </div>
          )}
        </div>
      ))}
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

// ─── Tasks ────────────────────────────────────────────────────────────────────
// Stores as HTML string (like journal). Old format [{id,text,done}] auto-migrates.
// Old [{id,text,done}] JSON is converted to HTML on read; the HTML stores checked state.
