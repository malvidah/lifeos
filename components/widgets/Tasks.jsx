"use client";
import { useState, useEffect, useContext, useMemo, useRef, useCallback } from "react";
import { useTheme } from "@/lib/theme";
import { mono, F, projectColor } from "@/lib/tokens";
import { useTaskStore } from "@/lib/useTaskStore";
import { NoteContext, ProjectNamesContext, PlaceNamesContext, NavigationContext } from "@/lib/contexts";
import { Shimmer } from "../ui/primitives.jsx";
import { DayLabEditor } from "../Editor.jsx";

// ── Shared task checkbox ─────────────────────────────────────────────────────
export function TaskCheckbox({ done, onToggle }) {
  return (
    <button
      onClick={onToggle}
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

// ── Single task row ──────────────────────────────────────────────────────────
// Extract inner <p> content from a full <li> task HTML wrapper
function extractInnerContent(taskHtml) {
  if (!taskHtml) return '';
  // Extract content inside <div><p>...</p></div> or just <p>...</p>
  const divMatch = taskHtml.match(/<div><p>([\s\S]*?)<\/p><\/div>/);
  if (divMatch) return `<p>${divMatch[1]}</p>`;
  const pMatch = taskHtml.match(/<p>([\s\S]*?)<\/p>/);
  if (pMatch) return `<p>${pMatch[1]}</p>`;
  // Fallback: return the text content
  return taskHtml.replace(/<[^>]+>/g, '');
}

function TaskRow({ task, onToggle, onEdit, onDelete, onEnterDown, editorRef, projectNames, noteNames, placeNames, onProjectClick, onNoteClick }) {
  const innerHtml = useMemo(() => extractInnerContent(task.html), [task.html]);

  const handleCommit = useCallback((html, text) => {
    if (!text?.trim()) {
      if (task._source === 'own') onDelete(task.id);
      return;
    }
    onEdit(task.id, { text, html });
  }, [task.id, task._source, onEdit, onDelete]);

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '3px 0',
      opacity: task.done ? 0.6 : 1,
      transition: 'opacity 0.15s',
    }}>
      <TaskCheckbox done={task.done} onToggle={() => onToggle(task.id)} />
      <div style={{
        flex: 1, minWidth: 0,
        textDecoration: task.done ? 'line-through' : 'none',
      }}>
        <DayLabEditor
          ref={editorRef}
          singleLine
          value={innerHtml}
          editable={task._editable !== false}
          placeholder=""
          projectNames={projectNames}
          noteNames={noteNames}
          placeNames={placeNames}
          textColor={"var(--dl-strong)"}
          mutedColor={"var(--dl-middle)"}
          color={"var(--dl-accent)"}
          style={{ padding: 0 }}
          onBlur={(html, text) => handleCommit(html, text)}
          onEnterCommit={(html, text) => {
            handleCommit(html, text);
            onEnterDown?.();
          }}
          onProjectClick={onProjectClick}
          onNoteClick={onNoteClick}
        />
      </div>
    </div>
  );
}

// ── New task input (always at the bottom) ─────────────────────────────────────
function NewTaskInput({ onAdd, projectNames, noteNames, placeNames, onProjectClick, onNoteClick, inputRef, project }) {
  const handleAdd = useCallback((html, text) => {
    if (!text?.trim()) return;
    onAdd(text, html);
  }, [onAdd]);

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '3px 0' }}>
      <div style={{
        width: 15, height: 15, flexShrink: 0, borderRadius: 4, marginTop: 4,
        border: '1.5px solid var(--dl-border2)', background: 'transparent',
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <DayLabEditor
          ref={inputRef}
          singleLine
          placeholder={project ? `Add a task for ${project.replace(/\b\w/g, c => c.toUpperCase())}...` : 'Add a task...'}
          projectNames={projectNames}
          noteNames={noteNames}
          placeNames={placeNames}
          textColor={"var(--dl-strong)"}
          mutedColor={"var(--dl-middle)"}
          color={"var(--dl-accent)"}
          style={{ padding: 0 }}
          onEnterCommit={(html, text) => handleAdd(html, text)}
          onBlur={(html, text) => handleAdd(html, text)}
          onProjectClick={onProjectClick}
          onNoteClick={onNoteClick}
        />
      </div>
    </div>
  );
}

// ── Main Tasks component ─────────────────────────────────────────────────────
export default function Tasks({ date, token, userId, taskFilter = "all", project }) {
  const { tasks, loaded, addTask, updateTask, toggleTask, deleteTask } = useTaskStore(date, token, userId);
  const projectNames = useContext(ProjectNamesContext);
  const { notes: noteNames } = useContext(NoteContext);
  const placeNames = useContext(PlaceNamesContext);
  const { navigateToProject, navigateToNote } = useContext(NavigationContext);
  const newTaskRef = useRef(null);
  const taskRefs = useRef({});

  // Filter tasks by project (client-side) and by done status
  const filteredTasks = useMemo(() => {
    let filtered = tasks;

    // Project filter
    if (project && project !== '__everything__') {
      filtered = filtered.filter(t =>
        (t.project_tags || []).some(tag => tag.toLowerCase() === project.toLowerCase())
      );
    }

    // Done/open filter
    if (taskFilter === 'open') {
      filtered = filtered.filter(t => !t.done);
    } else if (taskFilter === 'done') {
      filtered = filtered.filter(t => t.done);
    }

    // Sort by position
    return filtered.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }, [tasks, project, taskFilter]);

  // Handle Enter in a task row — focus next task or new task input
  const focusNext = useCallback((currentId) => {
    const idx = filteredTasks.findIndex(t => t.id === currentId);
    const nextTask = filteredTasks[idx + 1];
    if (nextTask && taskRefs.current[nextTask.id]) {
      taskRefs.current[nextTask.id]?.focus?.();
    } else {
      newTaskRef.current?.focus?.();
    }
  }, [filteredTasks]);

  // Handle adding a new task
  const handleAdd = useCallback(async (text, html) => {
    const result = await addTask(text, html, {
      project_tags: project ? [project.toLowerCase()] : [],
    });
    // Clear the input — DayLabEditor's onEnterCommit should handle this
  }, [addTask, project]);

  if (!loaded) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
      <Shimmer width="75%" height={13} /><Shimmer width="55%" height={13} /><Shimmer width="65%" height={13} />
    </div>
  );

  return (
    <div>
      {filteredTasks.map(task => (
        <TaskRow
          key={task.id}
          task={task}
          onToggle={toggleTask}
          onEdit={updateTask}
          onDelete={deleteTask}
          onEnterDown={() => focusNext(task.id)}
          editorRef={el => { taskRefs.current[task.id] = el; }}
          projectNames={projectNames}
          noteNames={noteNames}
          placeNames={placeNames}
          onProjectClick={name => navigateToProject(name)}
          onNoteClick={name => navigateToNote(name)}
        />
      ))}
      <NewTaskInput
        onAdd={handleAdd}
        inputRef={newTaskRef}
        project={project}
        projectNames={projectNames}
        noteNames={noteNames}
        placeNames={placeNames}
        onProjectClick={name => navigateToProject(name)}
        onNoteClick={name => navigateToNote(name)}
      />
    </div>
  );
}

// ── Task filter buttons (unchanged) ──────────────────────────────────────────
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
    { key: 'open', label: null, icon: <OpenIcon/> },
    { key: 'done', label: null, icon: <DoneIcon/> },
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
              padding: b.label ? '3px 8px' : '3px 6px',
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

// Keep old exports for backward compat during migration
export { TaskCheckbox as TaskCheckboxLegacy };
export function injectTaskListStyles() {} // no-op now
