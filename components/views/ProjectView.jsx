"use client";
import { useState, useEffect, useRef, useCallback, useMemo, Fragment, useContext } from "react";
import { serif, mono, F, R, projectColor, CHIP_TOKENS } from "@/lib/tokens";
import { toKey, todayKey, shift, fmtDate, MONTHS_SHORT, DAYS_SHORT } from "@/lib/dates";
import { api } from "@/lib/api";
import { extractTags, tagDisplayName } from "@/lib/tags";
import { useDbSave, dbLoad, dbSave, MEM } from "@/lib/db";
import { useProjects } from "@/lib/useProjects";
import { useCollapse } from "@/lib/hooks";
import { createClient } from "@/lib/supabase";
import { useNavigation, useProjectNames, NoteContext, ProjectNamesContext, NavigationContext } from "@/lib/contexts";
import { Card, Ring, ChevronBtn, TagChip, RichLine, Shimmer } from "../ui/primitives.jsx";
import { DayLabEditor } from "../Editor.jsx";
import { TaskFilterBtns, NewProjectTask, TaskCheckbox, clientParseTasks, tasksToHtml } from "../widgets/Tasks.jsx";
import { AddJournalLine } from "../widgets/JournalEditor.jsx";
import { ProjectSettingsPanel } from "./ProjectSettingsPanel.jsx";

// ─── HealthAllMeals ───────────────────────────────────────────────────────────
// EntryBlock — renders one paragraph block (may span multiple lines joined by \n).
// In edit mode, opens a multi-line DayLabEditor for the whole block.
function EntryLine({ entry, date, editing, onStartEdit, onSave, dimTag }) {
  const baseStyle = { fontFamily: serif, fontSize: F.md, lineHeight: '1.7', padding: '2px 0', wordBreak: 'break-word' };
  const ctxProjects = useContext(ProjectNamesContext);
  const ctxNotes    = useContext(NoteContext);
  const { navigateToProject, navigateToNote } = useContext(NavigationContext);

  if (editing) {
    return (
      <DayLabEditor
        value={entry.text}
        onBlur={text => onSave(text)}
        placeholder=""
        projectNames={ctxProjects}
        noteNames={ctxNotes.notes}
        onCreateNote={ctxNotes.onCreateNote}
        onProjectClick={name => navigateToProject(name)}
        onNoteClick={name => navigateToNote(name)}
        textColor={"var(--dl-strong)"}
        mutedColor={"var(--dl-middle)"}
        color={"var(--dl-accent)"}
        style={{ width: '100%', minHeight: '1.7em' }}
      />
    );
  }
  // Multi-line blocks: render each line through RichLine, separated by line breaks
  const lines = entry.text.split('\n');
  return (
    <div style={{ ...baseStyle, color:"var(--dl-strong)", cursor:'text' }} onClick={onStartEdit}>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br/>}
          <RichLine text={line} dimTag={dimTag}/>
        </Fragment>
      ))}
    </div>
  );
}

// ─── ProjectView ──────────────────────────────────────────────────────────────
export default function ProjectView({ project, token, userId, onBack, onSelectDate, taskFilter, setTaskFilter, settingsOpen, onCloseSettings, onRenamed }) {
  const pvProjectNames = useContext(ProjectNamesContext);
  const { navigateToProject, navigateToNote } = useContext(NavigationContext);
  const { value: projectsMeta, setValue: setProjectsMeta } =
    useDbSave('global', 'projects', {}, token, userId);

  // Track project recency — updates last_active whenever the user opens a project view
  const { updateProject } = useProjects(token);
  useEffect(() => {
    if (!project || project.startsWith('__') || !token) return;
    updateProject(project, { last_active: todayKey() });
  }, [project, token]); // eslint-disable-line

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
  // Derive note name from content (HTML with <h1> or plain text first line)
  const noteName = (note) => {
    const c = note?.content || '';
    if (c.startsWith('<')) {
      const m = c.match(/<h1[^>]*>(.*?)<\/h1>/s);
      return m ? m[1].replace(/<[^>]+>/g, '').trim() || 'Untitled' : 'Untitled';
    }
    return c.split('\n')[0].trim() || 'Untitled';
  };
  // Sorted by most recent first for the left panel
  const sortedNotes = [...notesList].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  // All current note names (for {note} autocomplete)
  const allNoteNames = notesList.map(noteName).filter(Boolean);

  const getUniqueName = (baseName, existingNames) => {
    const lower = existingNames.map(n => n.toLowerCase());
    if (!lower.includes(baseName.toLowerCase())) return baseName;
    let i = 2;
    while (lower.includes(`${baseName} ${i}`.toLowerCase())) i++;
    return `${baseName} ${i}`;
  };
  const addNote = (initialName = '', { silent = false, initialContent } = {}) => {
    const id = `note_${Date.now()}`;
    let content = initialContent || initialName || '';
    // If content would produce a duplicate name, auto-suffix
    const derivedName = content ? (content.replace(/<[^>]*>/g, '').split('\n')[0].trim() || 'Untitled') : 'Untitled';
    const existingNames = notesList.map(noteName);
    const uniqueName = getUniqueName(derivedName, existingNames);
    if (uniqueName !== derivedName) {
      // Replace the title in content, or set content if empty
      if (!content) {
        content = uniqueName;
      } else if (content.includes('<h1')) {
        content = content.replace(/(<h1[^>]*>)(.*?)(<\/h1>)/, `$1${uniqueName}$3`);
      } else {
        const lines = content.split('\n');
        lines[0] = uniqueName;
        content = lines.join('\n');
      }
    }
    setNotesStore(current => {
      const list = Array.isArray(current?.notes) ? current.notes : [];
      return silent
        ? { ...current, notes: [...list, { id, content, updatedAt: Date.now() }] }
        : { ...current, notes: [...list, { id, content, updatedAt: Date.now() }], activeId: id };
    }, { skipHistory: true });
  };
  const selectNote = (id) => {
    setNotesStore(current => ({ ...current, activeId: id }), { skipHistory: true });
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
    window.addEventListener('daylab:go-to-note', goHandler);
    window.addEventListener('daylab:create-note', createHandler);
    return () => {
      window.removeEventListener('daylab:go-to-note', goHandler);
      window.removeEventListener('daylab:create-note', createHandler);
    };
  }, [notesList]); // eslint-disable-line
  const updateNoteContent = (id, newContent) => {
    const oldNote = notesList.find(n => n.id === id);
    const oldName = noteName(oldNote);
    const newName = (newContent || '').split('\n')[0].trim() || 'Untitled';
    setNotesStore(current => {
      const list = Array.isArray(current?.notes) ? current.notes : [];
      const updatedNotes = list.map(n => {
        if (n.id === id) return { ...n, content: newContent, updatedAt: Date.now() };
        if (oldName !== newName && n.content) {
          const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const updated = n.content.replace(new RegExp('\\[' + escaped + '\\]', 'g'), '[' + newName + ']');
          return updated !== n.content ? { ...n, content: updated } : n;
        }
        return n;
      });
      return { ...current, notes: updatedNotes };
    }, { skipHistory: true });

    // Propagate rename to all DB entries that reference [oldName]
    // Journal entries store links as plain text [name], tasks store as TipTap HTML data-note-link="name"
    if (oldName !== newName && token) {
      const esc2 = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const sb = createClient();

      // ── Journal entries: replace [oldName] → [newName] in block content ──
      sb.from('journal_blocks').select('id, date, content')
        .eq('user_id', userId).ilike('content', '%[' + oldName + ']%')
        .then(({ data: rows }) => {
          if (!rows?.length) return;
          const updates = rows
            .filter(row => row.content?.includes('[' + oldName + ']'))
            .map(row => {
              const updated = row.content.replace(new RegExp('\\[' + esc2 + '\\]', 'g'), '[' + newName + ']');
              return sb.from('journal_blocks').update({ content: updated }).eq('id', row.id).eq('user_id', userId);
            });
          if (!updates.length) return;
          Promise.all(updates).then(() => {
            const affectedDates = [...new Set(rows.map(r => r.date))];
            affectedDates.forEach(d => { delete MEM[userId + ':' + d + ':journal']; });
            window.dispatchEvent(new CustomEvent('daylab:refresh', { detail: { types: ['journal'] } }));
          });
        });

      // ── Task entries: replace data-note-link attribute + inner text in TipTap HTML ──
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

      sb.from('tasks').select('id, date, html, text')
        .eq('user_id', userId).ilike('html', '%data-note-link="' + escHtml + '"%')
        .then(({ data: rows }) => {
          if (!rows?.length) return;
          const updates = rows
            .filter(row => row.html?.includes('data-note-link="' + escHtml + '"'))
            .map(row => {
              const updatedHtml = replaceNoteSpan(row.html || '');
              const updatedText = (row.text || '').replace(new RegExp('\\[' + esc2 + '\\]', 'g'), '[' + newName + ']');
              return sb.from('tasks').update({ html: updatedHtml, text: updatedText }).eq('id', row.id).eq('user_id', userId);
            });
          if (!updates.length) return;
          Promise.all(updates).then(() => {
            const affectedDates = [...new Set(rows.map(r => r.date))];
            affectedDates.forEach(d => { delete MEM[userId + ':' + d + ':tasks']; });
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
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { id, name }
  const deleteNote = (id) => {
    setNotesStore(current => {
      const list = Array.isArray(current?.notes) ? current.notes : [];
      const remaining = list.filter(n => n.id !== id);
      return { ...current, notes: remaining, activeId: remaining[0]?.id ?? null };
    }, { skipHistory: true });
  };

  // Per-project collapse state (persisted)
  const [notesCollapsed,      toggleNotes]      = useCollapse(`pv:${project}:journal`,    false);
  const [notesListCollapsed,  toggleNotesList]  = useCollapse(`pv:${project}:notes-list`, false);
  const [tasksCollapsed,      toggleTasks]      = useCollapse(`pv:${project}:tasks`,      false);
  const [entriesCollapsed,    toggleEntries]    = useCollapse(`pv:${project}:entries`,    false);
  const [workoutsCollapsed,   toggleWorkouts]   = useCollapse(`pv:${project}:workouts`,   false);
  const [mealsCollapsed,      toggleMeals]      = useCollapse(`pv:${project}:meals`,      false);
  const [hoveredNoteId,       setHoveredNoteId] = useState(null);
  const skipPhantomBlur = useRef(false);

  // Workouts + meals tagged to this project
  const [workoutItems, setWorkoutItems] = useState(null); // null=not loaded, []=empty
  const [mealItems,    setMealItems]    = useState(null);

  useEffect(() => {
    if (!token || !project || project === '__everything__') return;
    api.get(`/api/workouts?project=${encodeURIComponent(project)}`, token)
      .then(d => setWorkoutItems(d?.workouts ?? []))
      .catch(() => setWorkoutItems([]));
    api.get(`/api/meals?project=${encodeURIComponent(project)}`, token)
      .then(d => setMealItems(d?.items ?? []))
      .catch(() => setMealItems([]));
  }, [project, token]); // eslint-disable-line

  const meta = useMemo(() => ((projectsMeta || {})[project] || {}), [projectsMeta, project]);

  // Load entries when project changes
  useEffect(() => {
    if (!token || !project) return;
    setEntries(null);
    api.get(`/api/project-entries?project=${encodeURIComponent(project)}`, token)
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

  async function saveJournalEdit(date, lineIndex, newText, blockLength = 1) {
    const current = await dbLoad(date, 'journal', token);
    if (current === null) return;
    const lines = (current || '').split('\n');
    // Replace the original block (blockLength lines starting at lineIndex) with
    // the edited text (which may itself span multiple lines after editing).
    lines.splice(lineIndex, blockLength, ...newText.split('\n'));
    const updated = lines.join('\n');
    await dbSave(date, 'journal', updated, token);
    // Update module-level cache so daily view reflects immediately
    MEM[`${userId}:${date}:journal`] = updated;
    window.dispatchEvent(new CustomEvent('daylab:refresh', { detail: { types: ['journal'] } }));
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
    window.dispatchEvent(new CustomEvent('daylab:refresh', { detail: { types: ['tasks'] } }));
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
    window.dispatchEvent(new CustomEvent('daylab:refresh', { detail: { types: ['tasks'] } }));
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
    const chip = `{${project.toLowerCase()}}`;
    const hasTag = text.trim().endsWith(`#${project}`) || text.includes(chip);
    const taskText = hasTag ? text.trim() : `${text.trim()} ${chip}`;
    const current = await dbLoad(today, 'tasks', token);
    const existing = clientParseTasks(current);
    const newTask = { id: crypto.randomUUID(), text: taskText, done: false };
    const html = tasksToHtml([...existing, newTask]);
    await dbSave(today, 'tasks', html, token);
    const cacheKey = `${userId}:${today}:tasks`;
    MEM[cacheKey] = html; // Zustand proxy notifies all subscribers
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
    const chip = `{${project.toLowerCase()}}`;
    const hasTag = text.trim().endsWith(`#${project}`) || text.includes(chip);
    const entryText = hasTag ? text.trim() : `${text.trim()} ${chip}`;
    const current = await dbLoad(today, 'journal', token);
    const existing = (typeof current === 'string' ? current : '') || '';
    const updated = existing ? existing.trimEnd() + '\n' + entryText : entryText;
    const newLineIndex = updated.split('\n').lastIndexOf(entryText);
    await dbSave(today, 'journal', updated, token);
    MEM[`${userId}:${today}:journal`] = updated;
    window.dispatchEvent(new CustomEvent('daylab:refresh', { detail: { types: ['journal'] } }));
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

  const _pcol = project === '__everything__' ? "var(--dl-accent)" : projectColor(project);
  const noteNamesForContext = allNoteNames;

  return (
    <NoteContext.Provider value={{ notes: noteNamesForContext, onCreateNote: (name, opts) => addNote(name, opts) }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 200 }}>

      {/* Notes card */}
      <Card
        label="Notes"
        color={"var(--dl-highlight)"}
        collapsed={notesCollapsed}
        onToggle={toggleNotes}
        headerRight={
          <button
            onClick={e => { e.stopPropagation(); skipPhantomBlur.current = true; addNote(); }}
            title="New note"
            style={{ background:'none', border:'none', cursor:'pointer', padding:'2px 8px', color:"var(--dl-middle)", display:'flex', alignItems:'center', borderRadius:4, transition:'color 0.12s' }}
            onMouseEnter={e => e.currentTarget.style.color="var(--dl-strong)"}
            onMouseLeave={e => e.currentTarget.style.color="var(--dl-middle)"}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        }
      >
        <div style={{ display: 'flex', minHeight: 220 }}>
          {/* Left panel: note list — hidden when notesListCollapsed */}
          {!notesListCollapsed && (
            <div style={{ width: 164, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto', maxHeight: 440, paddingRight: 2 }}>
              {sortedNotes.length === 0 && (
                <button onClick={() => { skipPhantomBlur.current = true; addNote(); }} style={{ background: 'none', border: 'none', padding: '6px 8px', textAlign: 'left', cursor: 'text', fontFamily: mono, fontSize: F.sm, letterSpacing: '0.08em', textTransform: 'uppercase', color: "var(--dl-middle)", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.5 }}>Untitled</button>
              )}
              {sortedNotes.map(note => (
                <div
                  key={note.id}
                  style={{ display: 'flex', alignItems: 'center', borderRadius: 6, background: note.id === activeNoteId ? "var(--dl-well)" : 'transparent', transition: 'background 0.1s' }}
                  onMouseEnter={() => setHoveredNoteId(note.id)}
                  onMouseLeave={() => setHoveredNoteId(null)}
                >
                  <button
                    onClick={() => selectNote(note.id)}
                    style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', padding: '6px 8px', textAlign: 'left', cursor: 'pointer', fontFamily: mono, fontSize: F.sm, letterSpacing: '0.08em', textTransform: 'uppercase', color: note.id === activeNoteId ? "var(--dl-strong)" : "var(--dl-highlight)", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.5 }}
                  >{noteName(note)}</button>
                  <button
                    onClick={e => { e.stopPropagation(); setDeleteConfirm({ id: note.id, name: noteName(note) }); }}
                    title="Delete"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', color: "var(--dl-middle)", fontSize: 14, lineHeight: 1, flexShrink: 0, opacity: hoveredNoteId === note.id ? 0.6 : 0, transition: 'opacity 0.12s', borderRadius: 4 }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                    onMouseLeave={e => e.currentTarget.style.opacity = hoveredNoteId === note.id ? '0.6' : '0'}
                  >×</button>
                </div>
              ))}
            </div>
          )}

          {/* Vertical divider with collapse chevron */}
          <div
            onClick={toggleNotesList}
            title={notesListCollapsed ? 'Show list' : 'Hide list'}
            style={{ width: 16, flexShrink: 0, position: 'relative', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onMouseEnter={e => e.currentTarget.querySelector('.notes-chevron').style.color = "var(--dl-middle)"}
            onMouseLeave={e => e.currentTarget.querySelector('.notes-chevron').style.color = "var(--dl-border)"}
          >
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, background: 'var(--dl-border)' }}/>
            <div className="notes-chevron" style={{ position: 'relative', zIndex: 1, color: 'var(--dl-border)', transition: 'color 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="7" height="10" viewBox="0 0 7 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {notesListCollapsed
                  ? <polyline points="1.5,1.5 5.5,5 1.5,8.5"/>
                  : <polyline points="5.5,1.5 1.5,5 5.5,8.5"/>}
              </svg>
            </div>
          </div>

          {/* Right: editor — full width when list collapsed */}
          <div style={{ flex: 1, minWidth: 0, paddingLeft: 10 }}>
            {activeNote ? (
              <DayLabEditor
                key={activeNote.id}
                value={activeNote.content || ''}
                noteTitle
                autoFocus
                onBlur={html => updateNoteContent(activeNote.id, html)}
                noteNames={allNoteNames.filter(n => n !== noteName(activeNote))}
                projectNames={pvProjectNames}
                onCreateNote={addNote}
                onProjectClick={name => navigateToProject(name)}
                onNoteClick={name => {
                  const match = notesList.find(n => noteName(n).toLowerCase() === name.toLowerCase());
                  if (match) selectNote(match.id);
                  else addNote(name);
                }}
                textColor={"var(--dl-strong)"}
                mutedColor={"var(--dl-middle)"}
                color={"var(--dl-highlight)"}
                style={{ minHeight: 180, width: '100%' }}
              />
            ) : (
              <DayLabEditor
                key="phantom"
                value=""
                noteTitle
                onBlur={html => { if (skipPhantomBlur.current) { skipPhantomBlur.current = false; return; } if (html?.replace(/<[^>]*>/g, '').trim()) addNote('', { initialContent: html }); }}
                noteNames={[]}
                projectNames={pvProjectNames}
                onCreateNote={addNote}
                onProjectClick={name => navigateToProject(name)}
                textColor={"var(--dl-strong)"}
                mutedColor={"var(--dl-middle)"}
                color={"var(--dl-highlight)"}
                style={{ minHeight: 180, width: '100%' }}
              />
            )}
          </div>
        </div>
      </Card>

      {/* Tasks — all projects and specific projects */}
      <Card
        label={taskEntries.length ? `Tasks · ${openTasks.length} open` : 'Tasks'}
        color={"var(--dl-blue)"} autoHeight
        collapsed={tasksCollapsed} onToggle={toggleTasks}
        headerRight={<TaskFilterBtns filter={pvTaskFilter} setFilter={setPvTaskFilter}/>}
      >
        {entries === null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Shimmer width="70%" height={13}/><Shimmer width="55%" height={13}/>
          </div>
        ) : taskEntries.length === 0 ? (
          project === '__everything__' ? (
            <div style={{ fontFamily: mono, fontSize: F.sm, color: "var(--dl-middle)" }}>No tasks yet.</div>
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
                  <DayLabEditor
                    autoFocus singleLine
                    value={editingTask.text}
                    textColor={task.done ? "var(--dl-highlight)" : "var(--dl-strong)"}
                    mutedColor={"var(--dl-middle)"}
                    color={"var(--dl-blue)"}
                    style={{ flex: 1, padding: 0, minHeight: '1.7em',
                      textDecoration: task.done ? 'line-through' : 'none',
                      opacity: task.done ? 0.6 : 1 }}
                    onBlur={async text => { await saveTaskEdit(task.date, task.id, text); setEditingTask(null); }}
                    onEnterCommit={async text => { await saveTaskEdit(task.date, task.id, text); setEditingTask(null); }}
                  />
                ) : (
                  <div onClick={() => setEditingTask({ date:task.date, id:task.id, text:task.text })}
                    style={{ flex:1, fontFamily:serif, fontSize:F.md, lineHeight:'1.7',
                      color: task.done ? "var(--dl-highlight)" : "var(--dl-strong)", cursor:'text',
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
                          color: isToday ? "var(--dl-accent)" : "var(--dl-highlight)",
                          letterSpacing: '0.06em', textTransform: 'uppercase',
                          cursor: (!isToday && onSelectDate) ? 'pointer' : 'default',
                          display: 'inline-block', transition: 'color 0.15s',
                        }}
                        onMouseEnter={e => { if (!isToday && onSelectDate) e.currentTarget.style.color = "var(--dl-strong)"; }}
                        onMouseLeave={e => { if (!isToday && onSelectDate) e.currentTarget.style.color = isToday ? "var(--dl-accent)" : "var(--dl-highlight)"; }}
                      >{isToday ? 'Today' : fmtDate(date)}</div>
                    </div>
                    {isToday && project !== '__everything__' && pvTaskFilter !== 'done' && (
                      <NewProjectTask project={project} onAdd={addNewTask} />
                    )}
                    {filtered.map(task => renderTaskRow(task))}
                    <div style={{ borderTop:"1px solid var(--dl-border)", marginTop:12, marginBottom:4 }}/>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </Card>

      {/* Journal Entries */}
      <Card
        label={entries?.journalEntries?.length ? `Journal · ${entries.journalEntries.length}` : 'Journal'}
        color={"var(--dl-accent)"} autoHeight
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
              return lines.map(entry => (
                <EntryLine
                  key={`${date}-${entry.lineIndex}`}
                  entry={entry} date={date}
                  editing={editingEntry?.date === date && editingEntry?.lineIndex === entry.lineIndex}
                  onStartEdit={() => setEditingEntry({ date, lineIndex: entry.lineIndex, text: entry.text })}
                  onSave={async (text) => { await saveJournalEdit(date, entry.lineIndex, text, entry.blockLength ?? 1); setEditingEntry(null); }}
                  dimTag={project === '__everything__' ? null : project}
                />
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
                        color: isToday ? "var(--dl-accent)" : "var(--dl-highlight)",
                        letterSpacing: '0.06em', textTransform: 'uppercase',
                        marginTop: dateIdx === 0 ? 0 : 4, marginBottom: 8,
                      }}>{isToday ? 'Today' : fmtDate(date)}</div>
                      {isToday && project !== '__everything__' && (
                        <AddJournalLine project={project} onAdd={addNewJournal} />
                      )}
                      <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                        {renderLines(date, lines)}
                      </div>
                      <div style={{ borderTop:"1px solid var(--dl-border)", marginTop:16, marginBottom:4 }}/>
                    </div>
                  );
                })}
              </div>
            );
          })()
        }
      </Card>

      {/* Workouts tagged to this project */}
      {workoutItems?.length > 0 && (
        <Card
          label={`Workouts · ${workoutItems.length}`}
          color={"var(--dl-green)"} autoHeight
          collapsed={workoutsCollapsed} onToggle={toggleWorkouts}
        >
          {(() => {
            const byDate = {};
            workoutItems.forEach(w => {
              if (!byDate[w.date]) byDate[w.date] = [];
              byDate[w.date].push(w);
            });
            return Object.entries(byDate)
              .sort(([a],[b]) => b.localeCompare(a))
              .map(([date, rows], di) => (
                <div key={date}>
                  <div style={{ fontFamily:mono, fontSize:10, color:"var(--dl-highlight)",
                    letterSpacing:'0.06em', textTransform:'uppercase',
                    marginTop: di===0 ? 0 : 12, marginBottom:8 }}>{fmtDate(date)}</div>
                  {rows.map(w => (
                    <div key={w.id} style={{ display:'flex', alignItems:'baseline', gap:8, padding:'3px 0',
                      borderTop:"1px solid var(--dl-border)" }}>
                      <span style={{ fontFamily:serif, fontSize:F.md, color:"var(--dl-strong)", flex:1 }}>{w.title}</span>
                      {w.duration_min > 0 && (
                        <span style={{ fontFamily:mono, fontSize:10, color:"var(--dl-middle)" }}>{w.duration_min}m</span>
                      )}
                      {w.distance_m > 0 && (
                        <span style={{ fontFamily:mono, fontSize:10, color:"var(--dl-middle)" }}>{(w.distance_m/1000).toFixed(1)}km</span>
                      )}
                      {w.calories > 0 && (
                        <span style={{ fontFamily:mono, fontSize:10, color:"var(--dl-middle)" }}>{w.calories} kcal</span>
                      )}
                    </div>
                  ))}
                </div>
              ));
          })()}
        </Card>
      )}

      {/* Meals tagged to this project */}
      {mealItems?.length > 0 && (
        <Card
          label={`Meals · ${mealItems.length}`}
          color={"var(--dl-red)"} autoHeight
          collapsed={mealsCollapsed} onToggle={toggleMeals}
        >
          {(() => {
            const byDate = {};
            mealItems.forEach(m => {
              if (!byDate[m.date]) byDate[m.date] = [];
              byDate[m.date].push(m);
            });
            return Object.entries(byDate)
              .sort(([a],[b]) => b.localeCompare(a))
              .map(([date, rows], di) => (
                <div key={date}>
                  <div style={{ fontFamily:mono, fontSize:10, color:"var(--dl-highlight)",
                    letterSpacing:'0.06em', textTransform:'uppercase',
                    marginTop: di===0 ? 0 : 12, marginBottom:8 }}>{fmtDate(date)}</div>
                  {rows.map(m => (
                    <div key={m.id} style={{ display:'flex', alignItems:'baseline', gap:8, padding:'3px 0',
                      borderTop:"1px solid var(--dl-border)" }}>
                      <span style={{ fontFamily:serif, fontSize:F.md, color:"var(--dl-strong)", flex:1 }}>{m.content}</span>
                      {m.ai_calories > 0 && (
                        <span style={{ fontFamily:mono, fontSize:10, color:"var(--dl-middle)" }}>{m.ai_calories} kcal</span>
                      )}
                    </div>
                  ))}
                </div>
              ));
          })()}
        </Card>
      )}

    </div>

      {onCloseSettings && (
        <ProjectSettingsPanel
          project={project} token={token}
          open={!!settingsOpen} onClose={onCloseSettings} onRenamed={onRenamed}
        />
      )}

      {/* ── Delete note confirmation ─────────────────────────────────────── */}
      {deleteConfirm && (
        <>
          <div
            onClick={() => setDeleteConfirm(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            zIndex: 301, width: 'min(340px, calc(100vw - 40px))',
            background: 'var(--dl-bg)', border: '1px solid var(--dl-border)',
            borderRadius: 14, padding: '24px 24px 20px',
            boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dl-highlight)', marginBottom: 4 }}>Delete note</div>
            <div style={{ fontFamily: mono, fontSize: 13, color: 'var(--dl-strong)', lineHeight: 1.5 }}>
              Delete <span style={{ color: 'var(--dl-accent)' }}>"{deleteConfirm.name}"</span>?
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteConfirm(null)}
                style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', background: 'none', border: '1px solid var(--dl-border)', borderRadius: 7, padding: '8px 16px', cursor: 'pointer', color: 'var(--dl-highlight)', transition: 'color 0.12s, border-color 0.12s' }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--dl-strong)'; e.currentTarget.style.borderColor = 'var(--dl-middle)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--dl-highlight)'; e.currentTarget.style.borderColor = 'var(--dl-border)'; }}
              >Cancel</button>
              <button
                onClick={() => { deleteNote(deleteConfirm.id); setDeleteConfirm(null); }}
                style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', background: '#c0392b22', border: '1px solid #c0392b55', borderRadius: 7, padding: '8px 16px', cursor: 'pointer', color: '#e05', transition: 'background 0.12s' }}
                onMouseEnter={e => e.currentTarget.style.background = '#c0392b44'}
                onMouseLeave={e => e.currentTarget.style.background = '#c0392b22'}
              >Delete</button>
            </div>
          </div>
        </>
      )}
    </NoteContext.Provider>
  );
}

