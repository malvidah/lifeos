"use client";
import { useState, useEffect, useRef, useCallback, useMemo, Fragment, useContext } from "react";
import { useTheme } from "@/lib/theme";
import { serif, mono, F, R, projectColor, CHIP_TOKENS } from "@/lib/tokens";
import { toKey, todayKey, shift, fmtDate, MONTHS_SHORT, DAYS_SHORT } from "@/lib/dates";
import { extractTags, tagDisplayName } from "@/lib/tags";
import { useDbSave, dbLoad, dbSave, MEM } from "@/lib/db";
import { useCollapse } from "@/lib/hooks";
import { createClient } from "@/lib/supabase";
import { useNavigation, useProjectNames, NoteContext, ProjectNamesContext, NavigationContext } from "@/lib/contexts";
import { Card, Widget, Ring, ChevronBtn, TagChip, RichLine, Shimmer } from "../ui/primitives.jsx";
import { Editor } from "../Editor.jsx";
import { TaskFilterBtns, NewProjectTask, TaskCheckbox, clientParseTasks, tasksToHtml } from "../widgets/Tasks.jsx";

// ─── Nav ────────────────────────────────────────────────────────────────────
// Unified nav bar — lives in scroll flow, inside each scroll container.
// Both modes share identical outer shell (height:48, no padding) so the search
// button lands at exactly the same pixel on every page.
// Home:    [all-projects icon | project chips ···] [search icon]
export function AddJournalLine({ project, onAdd, placeholder }) {
  const { C } = useTheme();
  const col = project && project !== '__everything__' ? projectColor(project) : C.accent;
  const ctxProjects = useContext(ProjectNamesContext);
  const ctxNotes    = useContext(NoteContext);
  const { navigateToProject, navigateToNote } = useContext(NavigationContext);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '2px 0' }}>
      <Editor
        singleLine
        placeholder={placeholder || 'Add an entry…'}
        projectNames={ctxProjects}
        noteNames={ctxNotes.notes}
        textColor={C.text}
        mutedColor={C.dim}
        color={col}
        style={{ flex: 1, padding: 0 }}
        onProjectClick={name => navigateToProject(name)}
        onNoteClick={name => navigateToNote(name)}
        onEnterCommit={text => { if (text.trim()) onAdd(text.trim()); }}
        onBlur={text => { if (text.trim()) onAdd(text.trim()); }}
      />
    </div>
  );
}

// ─── HealthAllMeals ───────────────────────────────────────────────────────────
function EntryLine({ entry, date, editing, onStartEdit, onSave, dimTag }) {
  const { C } = useTheme();
  const baseStyle = { fontFamily: serif, fontSize: F.md, lineHeight: '1.7', padding: '2px 0', wordBreak: 'break-word' };
  const ctxProjects = useContext(ProjectNamesContext);
  const ctxNotes    = useContext(NoteContext);
  const { navigateToProject, navigateToNote } = useContext(NavigationContext);

  if (editing) {
    return (
      <Editor
        value={entry.text}
        onBlur={text => onSave(text)}
        placeholder=""
        singleLine
        projectNames={ctxProjects}
        noteNames={ctxNotes.notes}
        onCreateNote={ctxNotes.onCreateNote}
        onProjectClick={name => navigateToProject(name)}
        onNoteClick={name => navigateToNote(name)}
        textColor={C.text}
        mutedColor={C.dim}
        color={C.accent}
        style={{ width: '100%', minHeight: '1.7em' }}
      />
    );
  }
  return (
    <div style={{ ...baseStyle, color:C.text, cursor:'text', whiteSpace:'pre-wrap' }} onClick={onStartEdit}>
      <RichLine text={entry.text} dimTag={dimTag}/>
    </div>
  );
}

// ─── ProjectView ──────────────────────────────────────────────────────────────
export default function ProjectView({ project, token, userId, onBack, onSelectDate, taskFilter, setTaskFilter }) {
  const { C } = useTheme();
  const pvProjectNames = useContext(ProjectNamesContext);
  const { navigateToProject, navigateToNote } = useContext(NavigationContext);
  const { value: projectsMeta, setValue: setProjectsMeta } =
    useDbSave('global', 'projects', {}, token, userId);

  const [entries, setEntries] = useState(null); // null=loading, obj=loaded
  const pvTaskFilter = taskFilter;
  const setPvTaskFilter = setTaskFilter;
  const [editingEntry, setEditingEntry] = useState(null); // {date,lineIndex,text}
  const [editingTask, setEditingTask]   = useState(null); // {date,id,text}

  // Notes card — multi-note store per project (type:'project-notes', keyed by project name)
  // Shape: { notes: [{id, content, updatedAt}], activeId }
  // Note NAME is always the first line of content — no separate name field.
  const NOTES_EMPTY = { notes: [], activeId: null };
  const { value: notesStore, setValue: setNotesStore } =
    useDbSave(project || '__none__', 'project-notes', NOTES_EMPTY, token, userId);
  const notesList   = Array.isArray(notesStore?.notes) ? notesStore.notes : [];
  const activeNoteId = notesStore?.activeId ?? notesList[0]?.id ?? null;
  const activeNote  = notesList.find(n => n.id === activeNoteId) ?? notesList[0] ?? null;
  // Derive note name from first line of content
  const noteName = (note) => (note?.content || '').split('\n')[0].trim() || 'Untitled';
  // Sorted by most recent first for the left panel
  const sortedNotes = [...notesList].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  // All current note names (for {note} autocomplete)
  const allNoteNames = notesList.map(noteName).filter(Boolean);

  const addNote = (initialName = '', { silent = false } = {}) => {
    const id = `note_${Date.now()}`;
    const content = initialName || '';
    // silent=true: register note without switching to it (used when /n creates a chip)
    const updated = silent
      ? { ...notesStore, notes: [...notesList, { id, content, updatedAt: Date.now() }] }
      : { notes: [...notesList, { id, content, updatedAt: Date.now() }], activeId: id };
    setNotesStore(updated, { skipHistory: true });
  };
  const selectNote = (id) => {
    setNotesStore({ ...notesStore, activeId: id }, { skipHistory: true });
  };

  // Navigate-to-note from journal chip clicks
  useEffect(() => {
    const goHandler = (e) => {
      const targetName = e.detail?.name || '';
      const match = notesList.find(n => noteName(n).toLowerCase() === targetName.toLowerCase());
      if (match) selectNote(match.id);
      else addNote(targetName);
    };
    const createHandler = (e) => {
      addNote(e.detail?.name || '');
    };
    window.addEventListener('lifeos:go-to-note', goHandler);
    window.addEventListener('lifeos:create-note', createHandler);
    return () => {
      window.removeEventListener('lifeos:go-to-note', goHandler);
      window.removeEventListener('lifeos:create-note', createHandler);
    };
  }, [notesList]); // eslint-disable-line
  const updateNoteContent = (id, newContent) => {
    const oldNote = notesList.find(n => n.id === id);
    const oldName = noteName(oldNote);
    const newName = (newContent || '').split('\n')[0].trim() || 'Untitled';
    // Update [oldName] note links in all other notes in this project
    let updatedNotes = notesList.map(n => {
      if (n.id === id) return { ...n, content: newContent, updatedAt: Date.now() };
      if (oldName !== newName && n.content) {
        const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const updated = n.content.replace(new RegExp('\\[' + escaped + '\\]', 'g'), '[' + newName + ']');
        return updated !== n.content ? { ...n, content: updated } : n;
      }
      return n;
    });
    setNotesStore({ ...notesStore, notes: updatedNotes }, { skipHistory: true });

    // Propagate rename to all DB entries that reference [oldName]
    // Journal entries store links as plain text [name], tasks store as TipTap HTML data-note-link="name"
    if (oldName !== newName && token) {
      const esc2 = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const sb = createClient();

      // ── Journal blocks: replace [oldName] → [newName] in content ──
      sb.from('journal_blocks').select('date, content').ilike('content', '%[' + oldName + ']%')
        .then(({ data: rows }) => {
          if (!rows) return;
          let anyChanged = false;
          rows.forEach(row => {
            const text = typeof row.content === 'string' ? row.content : null;
            if (!text || !text.includes('[' + oldName + ']')) return;
            const updated = text.replace(new RegExp('\\[' + esc2 + '\\]', 'g'), '[' + newName + ']');
            dbSave(row.date, 'journal', updated, token);
            const cacheKey = userId + ':' + row.date + ':journal';
            if (MEM[cacheKey] !== undefined) MEM[cacheKey] = updated;
            window.dispatchEvent(new CustomEvent('lifeos:mem-update', { detail: { key: cacheKey, value: updated } }));
            anyChanged = true;
          });
          if (anyChanged) window.dispatchEvent(new CustomEvent('lifeos:refresh', { detail: { types: ['journal'] } }));
        });

      // ── Tasks: replace data-note-link attribute + inner text in TipTap HTML ──
      // Stored HTML: <span data-note-link="NAME" style="...">NAME</span>
      const escHtml = oldName.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const newHtml = newName.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      // Matches the full span element with exact attribute value
      const noteSpanRe = new RegExp(
        'data-note-link="' + escHtml.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"([^>]*)>' +
        escHtml.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '<\\/span>',
        'g'
      );
      const replaceNoteSpan = s => s.replace(noteSpanRe, 'data-note-link="' + newHtml + '"$1>' + newHtml + '</span>');

      sb.from('tasks').select('date, html').ilike('html', '%data-note-link="' + escHtml + '"%')
        .then(({ data: rows }) => {
          if (!rows) return;
          rows.forEach(row => {
            const html = typeof row.html === 'string' ? row.html : null;
            if (!html || !html.includes('data-note-link="' + escHtml + '"')) return;
            const updated = replaceNoteSpan(html);
            dbSave(row.date, 'tasks', updated, token);
            const cacheKey = userId + ':' + row.date + ':tasks';
            if (MEM[cacheKey] !== undefined) MEM[cacheKey] = updated;
            window.dispatchEvent(new CustomEvent('lifeos:mem-update', { detail: { key: cacheKey, value: updated } }));
          });
        });

      // ── Patch local project entries state immediately (no reload needed) ──
      const patchJournal = t => t.includes('[' + oldName + ']')
        ? t.replace(new RegExp('\\[' + esc2 + '\\]', 'g'), '[' + newName + ']') : t;
      const patchTask = t => t.includes('[' + oldName + ']')
        ? t.replace(new RegExp('\\[' + esc2 + '\\]', 'g'), '[' + newName + ']') : t;
      setEntries(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          journalEntries: prev.journalEntries.map(e => ({ ...e, text: patchJournal(e.text) })),
          taskEntries:    prev.taskEntries.map(t    => ({ ...t, text: patchTask(t.text)    })),
        };
      });
    }
  };
  const deleteNote = (id) => {
    const remaining = notesList.filter(n => n.id !== id);
    const newActive = remaining[0]?.id ?? null;
    setNotesStore({ notes: remaining, activeId: newActive }, { skipHistory: true });
  };

  // Workouts + meals for this project
  const [workoutItems, setWorkoutItems] = useState(null);
  const [mealItems, setMealItems] = useState(null);
  const [workoutsCollapsed, toggleWorkouts] = useCollapse(`pv:${project}:workouts`, false);
  const [mealsCollapsed, toggleMeals] = useCollapse(`pv:${project}:meals`, false);

  useEffect(() => {
    if (!token || !project || project === '__everything__') return;
    fetch(`/api/workouts?project=${encodeURIComponent(project)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setWorkoutItems(d?.workouts ?? [])).catch(() => setWorkoutItems([]));
    fetch(`/api/meals?project=${encodeURIComponent(project)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setMealItems(d?.items ?? [])).catch(() => setMealItems([]));
  }, [project, token]); // eslint-disable-line

  // Per-project collapse state (persisted)
  const [notesCollapsed,   toggleNotes]   = useCollapse(`pv:${project}:journal`,   false);
  const [tasksCollapsed,   toggleTasks]   = useCollapse(`pv:${project}:tasks`,   false);
  const [entriesCollapsed, toggleEntries] = useCollapse(`pv:${project}:entries`, false);

  const meta = useMemo(() => ((projectsMeta || {})[project] || {}), [projectsMeta, project]);

  // Load entries when project changes
  useEffect(() => {
    if (!token || !project) return;
    setEntries(null);
    fetch(`/api/project-entries?project=${encodeURIComponent(project)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setEntries({ journalEntries: [], taskEntries: [] }); return; }
        // Auto-delete project if it has no entries AND was previously registered in
        // projectsMeta (meaning it's orphaned). Skip for new projects (/p just created
        // them — they have no entries yet but are real) and skip for __everything__.
        const wasRegistered = !!(projectsMeta || {})[project];
        if (!d.isEverything && wasRegistered && !d.journalEntries?.length && !d.taskEntries?.length) {
          const updated = { ...(projectsMeta || {}) };
          delete updated[project];
          setProjectsMeta(updated, { skipHistory: true });
          onBack();
          return;
        }
        setEntries(d);
      })
      .catch(() => setEntries({ journalEntries: [], taskEntries: [] }));
  }, [project, token]); // eslint-disable-line

  // Group journal entries by date (oldest first)
  const journalByDate = useMemo(() => {
    if (!entries?.journalEntries?.length) return [];
    const map = {};
    entries.journalEntries.forEach(e => {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);

  const taskEntries = entries?.taskEntries || [];
  const openTasks = taskEntries.filter(t => !t.done);
  const doneTasks = taskEntries.filter(t => t.done);

  // Group tasks by date (oldest first)
  const tasksByDate = useMemo(() => {
    if (!taskEntries.length) return [];
    const map = {};
    // Preserve DB order — do NOT split into open/done (that causes reorder on toggle)
    taskEntries.forEach(t => {
      if (!map[t.date]) map[t.date] = { all: [], open: [], done: [] };
      map[t.date].all.push(t);
      if (t.done) map[t.date].done.push(t);
      else map[t.date].open.push(t);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [taskEntries]);

  // Register any new tags found in edited text into projectsMeta
  function registerNewTags(text) {
    const tags = extractTags(text);
    if (!tags.length) return;
    const meta = projectsMeta || {};
    const newTags = tags.filter(t => !meta[t]);
    if (!newTags.length) return;
    const updated = { ...meta };
    newTags.forEach(t => { updated[t] = { description: '', createdAt: new Date().toISOString() }; });
    setProjectsMeta(updated, { skipHistory: true });
  }

  async function saveJournalEdit(date, lineIndex, newText) {
    const current = await dbLoad(date, 'journal', token);
    if (current === null) return;
    const lines = (current || '').split('\n');
    lines[lineIndex] = newText;
    const updated = lines.join('\n');
    await dbSave(date, 'journal', updated, token);
    // Update module-level cache so daily view reflects immediately
    MEM[`${userId}:${date}:journal`] = updated;
    window.dispatchEvent(new CustomEvent('lifeos:refresh', { detail: { types: ['journal'] } }));
    registerNewTags(newText);
    setEntries(prev => prev ? {
      ...prev,
      journalEntries: prev.journalEntries.map(e =>
        (e.date === date && e.lineIndex === lineIndex) ? { ...e, text: newText } : e
      ),
    } : prev);
  }

  async function toggleTask(date, taskId, currentDone) {
    const raw = await dbLoad(date, 'tasks', token);
    if (raw === null) return;
    // Parse handles both old array format and new TipTap HTML — save back as HTML
    const tasks = clientParseTasks(raw);
    // Match by id (new format) or by position (old format ids may differ from API ids)
    let matched = false;
    const updated = tasks.map((t, i) => {
      if (t.id === taskId || (!matched && `html_${i}` === taskId)) {
        matched = true;
        return { ...t, done: !currentDone };
      }
      return t;
    });
    const html = tasksToHtml(updated);
    await dbSave(date, 'tasks', html, token);
    MEM[`${userId}:${date}:tasks`] = html;
    window.dispatchEvent(new CustomEvent('lifeos:refresh', { detail: { types: ['tasks'] } }));
    setEntries(prev => prev ? {
      ...prev,
      taskEntries: prev.taskEntries.map(t =>
        (t.date === date && t.id === taskId) ? { ...t, done: !currentDone } : t
      ),
    } : prev);
  }

  async function saveTaskEdit(date, taskId, newText) {
    const raw = await dbLoad(date, 'tasks', token);
    if (raw === null) return;
    const tasks = clientParseTasks(raw);
    let matched = false;
    const updated = tasks.map((t, i) => {
      if (t.id === taskId || (!matched && `html_${i}` === taskId)) {
        matched = true;
        return { ...t, text: newText };
      }
      return t;
    });
    const html = tasksToHtml(updated);
    await dbSave(date, 'tasks', html, token);
    MEM[`${userId}:${date}:tasks`] = html;
    window.dispatchEvent(new CustomEvent('lifeos:refresh', { detail: { types: ['tasks'] } }));
    registerNewTags(newText);
    setEntries(prev => prev ? {
      ...prev,
      taskEntries: prev.taskEntries.map(t =>
        (t.date === date && t.id === taskId) ? { ...t, text: newText } : t
      ),
    } : prev);
  }

  // Add a brand-new task to today's date with the project tag appended
  async function addNewTask(text) {
    if (!text.trim() || project === '__everything__') return;
    const today = todayKey(); // local date — avoids UTC midnight mismatch with day view
    const taskText = text.trim().endsWith(`#${project}`)
      ? text.trim()
      : `${text.trim()} {${project.toLowerCase()}}`;
    const current = await dbLoad(today, 'tasks', token);
    const existing = clientParseTasks(current);
    const newTask = { id: crypto.randomUUID(), text: taskText, done: false };
    const html = tasksToHtml([...existing, newTask]);
    await dbSave(today, 'tasks', html, token);
    const cacheKey = `${userId}:${today}:tasks`;
    MEM[cacheKey] = html;
    // Notify day-view Tasks hook directly so it shows without re-fetching
    window.dispatchEvent(new CustomEvent('lifeos:mem-update', { detail: { key: cacheKey, value: html } }));
    registerNewTags(taskText);
    // Append to local project-view entries so it appears immediately here too
    setEntries(prev => prev ? {
      ...prev,
      taskEntries: [...(prev.taskEntries || []), { date: today, id: newTask.id, text: taskText, done: false }],
    } : prev);
  }

  async function addNewJournal(text) {
    if (!text.trim() || project === '__everything__') return;
    const today = todayKey();
    const entryText = text.trim().endsWith(`#${project}`)
      ? text.trim()
      : `${text.trim()} {${project.toLowerCase()}}`;
    const current = await dbLoad(today, 'journal', token);
    const existing = (typeof current === 'string' ? current : '') || '';
    const updated = existing ? existing.trimEnd() + '\n' + entryText : entryText;
    const newLineIndex = updated.split('\n').lastIndexOf(entryText);
    await dbSave(today, 'journal', updated, token);
    MEM[`${userId}:${today}:journal`] = updated;
    window.dispatchEvent(new CustomEvent('lifeos:refresh', { detail: { types: ['journal'] } }));
    registerNewTags(entryText);
    setEntries(prev => prev ? {
      ...prev,
      journalEntries: [...(prev.journalEntries || []), { date: today, lineIndex: newLineIndex, text: entryText }],
    } : prev);
  }

  const loadingCards = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Shimmer width="80%" height={13}/><Shimmer width="65%" height={13}/><Shimmer width="72%" height={13}/>
    </div>
  );

  const _pcol = project === '__everything__' ? C.accent : projectColor(project);
  const noteNamesForContext = allNoteNames;

  return (
    <NoteContext.Provider value={{ notes: noteNamesForContext, onCreateNote: (name, opts) => addNote(name, opts) }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 200 }}>

      {/* Notes card — left 1/3: note list sorted by recency; right 2/3: editor */}
      {true && (
        <Widget
          label="Notes"
          color={C.muted}
          collapsed={notesCollapsed}
          onToggle={toggleNotes}
          headerRight={
            <button onClick={() => addNote()} style={{ background:'none', border:'none', cursor:'pointer', padding:'4px 8px', fontFamily:mono, fontSize:F.sm, color:C.dim, letterSpacing:'0.06em', display:'flex', alignItems:'center', gap:4 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              note
            </button>
          }
        >
          <div style={{ display: 'flex', gap: 0, minHeight: 200 }}>
            {/* Left: note list — 1/3 width, sorted by most recent */}
            <div style={{ width: '33%', flexShrink: 0, borderRight: `1px solid ${C.border}`, paddingRight: 10, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', maxHeight: 400 }}>
              {sortedNotes.length === 0 ? (
                <div style={{ fontFamily: serif, fontSize: F.sm, color: C.dim, padding: '4px 0' }}>No notes yet.<br/>Use the + button or type <span style={{ fontFamily: mono }}>{'{Note Name}'}</span> in any editor.</div>
              ) : sortedNotes.map(note => (
                <div key={note.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <button
                    onClick={() => selectNote(note.id)}
                    style={{
                      flex: 1, minWidth: 0, background: note.id === activeNoteId ? C.well : 'none',
                      border: note.id === activeNoteId ? `1px solid ${C.border}` : '1px solid transparent',
                      borderRadius: 6, padding: '5px 8px', textAlign: 'left', cursor: 'pointer',
                      fontFamily: mono, fontSize: F.sm, letterSpacing: '0.04em',
                      color: note.id === activeNoteId ? C.text : C.muted,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      transition: 'all 0.12s',
                    }}
                  >{noteName(note)}</button>
                  <button
                    onClick={() => { if (window.confirm(`Delete "${noteName(note)}"?`)) deleteNote(note.id); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: C.dim, fontSize: 10, lineHeight: 1, flexShrink: 0, opacity: 0.5 }}
                    title="Delete note"
                    onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}
                  >×</button>
                </div>
              ))}
            </div>
            {/* Right: editor — 2/3 width. First line = note name. */}
            <div style={{ flex: 1, minWidth: 0, paddingLeft: 12 }}>
              {notesList.length === 0 ? (
                <div style={{ fontFamily: serif, fontSize: F.md, color: C.dim, padding: '4px 0' }}>Select or create a note.</div>
              ) : activeNote ? (
                <Editor
                  key={activeNote.id}
                  value={activeNote.content || ''}
                  onBlur={text => updateNoteContent(activeNote.id, text)}
                  placeholder='Note name (first line)…'
                  noteNames={allNoteNames.filter(n => n !== noteName(activeNote))}
                  projectNames={pvProjectNames}
                  onCreateNote={addNote}
                  onProjectClick={name => navigateToProject(name)}
                  onNoteClick={name => {
                    const match = notesList.find(n => noteName(n).toLowerCase() === name.toLowerCase());
                    if (match) selectNote(match.id);
                    else addNote(name);
                  }}
                  textColor={C.text}
                  mutedColor={C.dim}
                  color={C.muted}
                  style={{ minHeight: 180, width: '100%' }}
                />
              ) : null}
            </div>
          </div>
        </Widget>
      )}

      {/* Tasks — all projects and specific projects */}
      <Widget
        label={taskEntries.length ? `Tasks · ${openTasks.length} open` : 'Tasks'}
        color={C.blue} autoHeight
        collapsed={tasksCollapsed} onToggle={toggleTasks}
        headerRight={<TaskFilterBtns filter={pvTaskFilter} setFilter={setPvTaskFilter}/>}
      >
        {entries === null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Shimmer width="70%" height={13}/><Shimmer width="55%" height={13}/>
          </div>
        ) : taskEntries.length === 0 ? (
          project === '__everything__' ? (
            <div style={{ fontFamily: mono, fontSize: F.sm, color: C.dim }}>No tasks yet.</div>
          ) : (
            <NewProjectTask project={project} onAdd={addNewTask} />
          )
        ) : (() => {
          const todayStr = todayKey();
          const otherDates = tasksByDate.filter(([d]) => d !== todayStr).sort(([a],[b]) => b.localeCompare(a));
          const todayEntry = tasksByDate.find(([d]) => d === todayStr);
          const allDates = todayEntry
            ? [[todayStr, todayEntry[1]], ...otherDates]
            : [[todayStr, { all:[], open:[], done:[] }], ...otherDates];

          function renderTaskRow(task) {
            return (
              <div key={task.id} style={{
                display:'flex', alignItems:'flex-start', gap:10, padding:'3px 0',
              }}>
                <TaskCheckbox done={task.done} onToggle={() => toggleTask(task.date, task.id, task.done)} />
                {editingTask?.date === task.date && editingTask?.id === task.id ? (
                  <Editor
                    autoFocus singleLine
                    value={editingTask.text}
                    textColor={task.done ? C.muted : C.text}
                    mutedColor={C.dim}
                    color={C.blue}
                    style={{ flex: 1, padding: 0, minHeight: '1.7em',
                      textDecoration: task.done ? 'line-through' : 'none',
                      opacity: task.done ? 0.6 : 1 }}
                    onBlur={async text => { await saveTaskEdit(task.date, task.id, text); setEditingTask(null); }}
                    onEnterCommit={async text => { await saveTaskEdit(task.date, task.id, text); setEditingTask(null); }}
                  />
                ) : (
                  <div onClick={() => setEditingTask({ date:task.date, id:task.id, text:task.text })}
                    style={{ flex:1, fontFamily:serif, fontSize:F.md, lineHeight:'1.7',
                      color: task.done ? C.muted : C.text, cursor:'text',
                      textDecoration: task.done ? 'line-through' : 'none',
                      opacity: task.done ? 0.45 : 1,
                      whiteSpace:'pre-wrap', wordBreak:'break-word' }}>
                    <RichLine text={task.text} dimTag={project==='__everything__' ? null : project}/>
                  </div>
                )}
              </div>
            );
          }

          return (
            <div>
              {allDates.filter(([date, { open, done }]) =>
                pvTaskFilter === 'open' ? (open.length > 0 || date === todayStr) :
                pvTaskFilter === 'done' ? (done.length > 0 || date === todayStr) : true
              ).map(([date, { all }], dateIdx) => {
                const isToday = date === todayStr;
                const filtered = all.filter(t =>
                  pvTaskFilter === 'open' ? !t.done :
                  pvTaskFilter === 'done' ? t.done : true
                );
                return (
                  <div key={date}>
                    <div style={{ display:'flex', alignItems:'center', gap:8,
                      marginTop: dateIdx === 0 ? 0 : 4, marginBottom: 6 }}>
                      <div
                        onClick={() => !isToday && onSelectDate && (onBack(), onSelectDate(date))}
                        style={{
                          fontFamily: mono, fontSize: 10,
                          color: isToday ? C.accent : C.muted,
                          letterSpacing: '0.06em', textTransform: 'uppercase',
                          cursor: (!isToday && onSelectDate) ? 'pointer' : 'default',
                          display: 'inline-block', transition: 'color 0.15s',
                        }}
                        onMouseEnter={e => { if (!isToday && onSelectDate) e.currentTarget.style.color = C.text; }}
                        onMouseLeave={e => { if (!isToday && onSelectDate) e.currentTarget.style.color = isToday ? C.accent : C.muted; }}
                      >{isToday ? 'Today' : fmtDate(date)}</div>
                    </div>
                    {isToday && project !== '__everything__' && pvTaskFilter !== 'done' && (
                      <NewProjectTask project={project} onAdd={addNewTask} />
                    )}
                    {filtered.map(task => renderTaskRow(task))}
                    <div style={{ borderTop:`1px solid ${C.border}`, marginTop:12, marginBottom:4 }}/>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </Widget>

      {/* Journal Entries */}
      <Widget
        label={entries?.journalEntries?.length ? `Journal · ${entries.journalEntries.length}` : 'Journal'}
        color={C.accent} autoHeight
        collapsed={entriesCollapsed} onToggle={toggleEntries}
        headerLeft={null}
      >
        {entries === null ? loadingCards
          : (() => {
            const today = todayKey();
            const otherDates = journalByDate.filter(([d]) => d !== today);
            const todayLines = journalByDate.find(([d]) => d === today)?.[1] || [];
            const allDates = [[today, todayLines], ...otherDates];

            function renderLines(date, lines) {
              const blocks = [];
              let cur = [];
              lines.forEach((entry, i) => {
                if (i === 0 || entry.lineIndex === lines[i-1].lineIndex + 1) cur.push(entry);
                else { if (cur.length) blocks.push(cur); cur = [entry]; }
              });
              if (cur.length) blocks.push(cur);
              return blocks.map((block, bi) => (
                <div key={bi} style={{ display:'flex', flexDirection:'column', gap:0 }}>
                  {block.map(entry => (
                    <EntryLine
                      key={`${date}-${entry.lineIndex}`}
                      entry={entry} date={date}
                      editing={editingEntry?.date === date && editingEntry?.lineIndex === entry.lineIndex}
                      onStartEdit={() => setEditingEntry({ date, lineIndex: entry.lineIndex, text: entry.text })}
                      onSave={async (text) => { await saveJournalEdit(date, entry.lineIndex, text); setEditingEntry(null); }}
                      dimTag={project === '__everything__' ? null : project}
                    />
                  ))}
                </div>
              ));
            }

            return (
              <div style={{ display:'flex', flexDirection:'column' }}>
                {allDates.map(([date, lines], dateIdx) => {
                  const isToday = date === today;
                  if (!isToday && lines.length === 0) return null;
                  return (
                    <div key={date}>
                      <div style={{
                        fontFamily: mono, fontSize: 10,
                        color: isToday ? C.accent : C.muted,
                        letterSpacing: '0.06em', textTransform: 'uppercase',
                        marginTop: dateIdx === 0 ? 0 : 4, marginBottom: 8,
                      }}>{isToday ? 'Today' : fmtDate(date)}</div>
                      {isToday && project !== '__everything__' && (
                        <AddJournalLine project={project} onAdd={addNewJournal} />
                      )}
                      <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                        {renderLines(date, lines)}
                      </div>
                      <div style={{ borderTop:`1px solid ${C.border}`, marginTop:16, marginBottom:4 }}/>
                    </div>
                  );
                })}
              </div>
            );
          })()
        }
      </Widget>
      {/* Workouts card */}
      {workoutItems && workoutItems.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div onClick={toggleWorkouts} style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', padding:'4px 0', marginBottom: workoutsCollapsed ? 0 : 8 }}>
            <span style={{ fontFamily: mono, fontSize: 9, letterSpacing:'0.08em', textTransform:'uppercase', color: _pcol+'cc' }}>
              {workoutsCollapsed ? '▸' : '▾'} Workouts
            </span>
          </div>
          {!workoutsCollapsed && (() => {
            const byDate = {};
            workoutItems.forEach(w => { if (!byDate[w.date]) byDate[w.date] = []; byDate[w.date].push(w); });
            return Object.entries(byDate).sort((a,b) => b[0].localeCompare(a[0])).map(([date, ws]) => (
              <div key={date} style={{ marginBottom: 10 }}>
                <div style={{ fontFamily: mono, fontSize: 9, color:'var(--dl-muted)', letterSpacing:'0.06em', textTransform:'uppercase', marginBottom: 4 }}>{fmtDate(date)}</div>
                {ws.map((w,i) => (
                  <div key={i} style={{ fontFamily: serif, fontSize: F.md, color:'var(--dl-text)', lineHeight:1.5, padding:'3px 0' }}>
                    {w.title}
                    {(w.duration_min || w.distance_m) && (
                      <span style={{ color:'var(--dl-muted)', fontSize: F.sm, marginLeft: 8 }}>
                        {w.duration_min ? `${w.duration_min}min` : ''}
                        {w.distance_m ? ` · ${(w.distance_m/1000).toFixed(1)}km` : ''}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ));
          })()}
        </div>
      )}

      {/* Meals card */}
      {mealItems && mealItems.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div onClick={toggleMeals} style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', padding:'4px 0', marginBottom: mealsCollapsed ? 0 : 8 }}>
            <span style={{ fontFamily: mono, fontSize: 9, letterSpacing:'0.08em', textTransform:'uppercase', color: _pcol+'cc' }}>
              {mealsCollapsed ? '▸' : '▾'} Meals
            </span>
          </div>
          {!mealsCollapsed && (() => {
            const byDate = {};
            mealItems.forEach(m => { if (!byDate[m.date]) byDate[m.date] = []; byDate[m.date].push(m); });
            return Object.entries(byDate).sort((a,b) => b[0].localeCompare(a[0])).map(([date, ms]) => (
              <div key={date} style={{ marginBottom: 10 }}>
                <div style={{ fontFamily: mono, fontSize: 9, color:'var(--dl-muted)', letterSpacing:'0.06em', textTransform:'uppercase', marginBottom: 4 }}>{fmtDate(date)}</div>
                {ms.map((m,i) => (
                  <div key={i} style={{ fontFamily: serif, fontSize: F.md, color:'var(--dl-text)', lineHeight:1.5, padding:'3px 0' }}>
                    {m.content}
                    {m.ai_calories && <span style={{ color:'var(--dl-muted)', fontSize: F.sm, marginLeft: 8 }}>{m.ai_calories} kcal</span>}
                  </div>
                ))}
              </div>
            ));
          })()}
        </div>
      )}

    </div>
    </NoteContext.Provider>
  );
}

