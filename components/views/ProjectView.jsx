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
import { useTheme } from "@/lib/theme";
import { TaskFilterBtns, clientParseTasks, tasksToHtml, injectTaskListStyles } from "../widgets/Tasks.jsx";
import { AddJournalLine, extractImages, PhotoStrip, Slideshow, DropZone } from "../widgets/JournalEditor.jsx";
import { uploadImageFile, deleteImageFile } from "@/lib/images";
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
        value={entry.content || entry.text}
        onBlur={html => onSave(html)}
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

// ─── ProjectDateTaskEditor ────────────────────────────────────────────────────
// Per-date TipTap task list editor for the project view. Works like the daily
// view editor but only shows tasks tagged to this project, merging changes back
// into the full day's task list on save.
function ProjectDateTaskEditor({ date, project, tasks, token, userId, onTasksChanged, taskFilter }) {
  const { theme } = useTheme();
  const ctxProjects = useContext(ProjectNamesContext);
  const ctxNotes    = useContext(NoteContext);
  const { navigateToProject, navigateToNote } = useContext(NavigationContext);
  const saveTimer = useRef(null);
  const savingRef = useRef(false);
  const latestHtml = useRef(null);
  const chip = `{${project}}`;

  // Build initial HTML from the project's tasks for this date
  const initialHtml = useMemo(() => {
    if (!tasks || tasks.length === 0) return '';
    return tasksToHtml(tasks.map(t => ({ id: t.id, text: t.text, done: !!t.done })));
  }, []); // eslint-disable-line

  const isEmpty = useMemo(() => clientParseTasks(initialHtml).length === 0, [initialHtml]);

  // Inject task list styles (same as daily view)
  const accentHex = theme === 'light' ? '#B87018' : '#D08828';
  useEffect(() => injectTaskListStyles(accentHex), [accentHex]);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  async function mergeAndSave(newHtml) {
    if (savingRef.current) return; // prevent overlapping saves
    savingRef.current = true;
    try {
      let editorTasks = clientParseTasks(newHtml);
      // Auto-tag tasks that don't reference this project (skip for __everything__)
      if (project !== '__everything__') {
        editorTasks = editorTasks.map(t => {
          if (!t.text.toLowerCase().includes(chip)) return { ...t, text: `${t.text} ${chip}` };
          return t;
        });
      }
      // Load full day's tasks and replace the project-tagged ones
      const raw = await dbLoad(date, 'tasks', token);
      const allTasks = clientParseTasks(raw);
      let merged;
      if (project === '__everything__') {
        merged = editorTasks;
      } else {
        // Build merged list: keep non-project tasks in place, swap project tasks
        merged = [];
        let projectTasksInserted = false;
        for (const t of allTasks) {
          if (t.text.toLowerCase().includes(chip)) {
            if (!projectTasksInserted) {
              merged.push(...editorTasks);
              projectTasksInserted = true;
            }
            // Skip original project task (replaced by editorTasks)
          } else {
            merged.push(t);
          }
        }
        if (!projectTasksInserted) merged.push(...editorTasks);
      }
      const mergedHtml = tasksToHtml(merged);
      await dbSave(date, 'tasks', mergedHtml, token);
      window.dispatchEvent(new CustomEvent('daylab:refresh', { detail: { types: ['tasks'], date } }));
      if (onTasksChanged) onTasksChanged(date, editorTasks);
    } finally {
      savingRef.current = false;
    }
  }

  function handleUpdate(newHtml) {
    latestHtml.current = newHtml;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => mergeAndSave(newHtml), 800);
  }

  return (
    <div data-filter={taskFilter} style={{
      '--task-border': "var(--dl-border2)",
      '--task-color':  "var(--dl-accent)",
      '--task-fill':   theme === 'light' ? "var(--dl-bg)" : "var(--dl-middle)",
    }}>
      <div style={{ position: 'relative' }}>
        <DayLabEditor
          taskList
          value={initialHtml}
          onUpdate={handleUpdate}
          placeholder=""
          projectNames={ctxProjects}
          noteNames={ctxNotes.notes}
          textColor={"var(--dl-strong)"}
          mutedColor={"var(--dl-middle)"}
          color={"var(--dl-accent)"}
          onProjectClick={name => navigateToProject(name)}
          onNoteClick={name => navigateToNote(name)}
          style={{ padding: 0 }}
        />
        {isEmpty && (
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

// ─── ProjectView ──────────────────────────────────────────────────────────────
export default function ProjectView({ project, token, userId, onBack, onSelectDate, taskFilter, setTaskFilter, settingsOpen, onCloseSettings, onRenamed }) {
  const pvProjectNames = useContext(ProjectNamesContext);
  const { navigateToProject, navigateToNote } = useContext(NavigationContext);
  const { value: projectsMeta, setValue: setProjectsMeta } =
    useDbSave('global', 'projects', {}, token, userId);

  // Track project recency — updates last_active whenever the user opens a project view
  const { projects: projectsMap, updateProject } = useProjects(token);
  useEffect(() => {
    if (!project || project.startsWith('__') || !token) return;
    updateProject(project, { last_active: todayKey() });
  }, [project, token]); // eslint-disable-line

  const [entries, setEntries] = useState(null); // null=loading, obj=loaded
  const [entriesRev, setEntriesRev] = useState(0);

  // Listen for daylab:refresh events to refetch entries when journal/tasks change
  useEffect(() => {
    const handler = (e) => {
      if (!e.detail?.types || e.detail.types.includes('journal') || e.detail.types.includes('tasks')) {
        setEntriesRev(r => r + 1);
      }
    };
    window.addEventListener('daylab:refresh', handler);
    return () => window.removeEventListener('daylab:refresh', handler);
  }, []);
  const pvTaskFilter = taskFilter;
  const setPvTaskFilter = setTaskFilter;
  const [editingEntry, setEditingEntry] = useState(null); // {date,lineIndex,text}

  // Notes — independent entities from the `notes` table, tagged to projects via project_tags
  const [notesList, setNotesList] = useState([]);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const deletedNoteIds = useRef(new Set()); // guards against unmount flush re-saving

  // Note photos state
  const [noteLightbox, setNoteLightbox] = useState(null); // null=strip, number=slideshow index
  const [noteDragging, setNoteDragging] = useState(false);
  const [noteUploading, setNoteUploading] = useState(false);
  const [noteEditorRev, setNoteEditorRev] = useState(0); // bump to force editor remount after reorder
  const noteDragCounter = useRef(0);

  // Load notes for this project
  useEffect(() => {
    if (!project || project.startsWith('__') || !token) return;
    let stale = false;
    setNotesLoaded(false);
    api.get(`/api/notes?project=${encodeURIComponent(project)}`, token)
      .then(res => {
        if (stale) return;
        const notes = res?.notes || [];
        setNotesList(notes);
        setNotesLoaded(true);
        setActiveNoteId(prev => notes.find(n => n.id === prev) ? prev : notes[0]?.id ?? null);
      })
      .catch(() => { if (!stale) setNotesLoaded(true); });
    return () => { stale = true; };
  }, [project, token]);

  const activeNote = notesList.find(n => n.id === activeNoteId) ?? notesList[0] ?? null;
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
  const sortedNotes = [...notesList].sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  // All current note names (for {note} autocomplete)
  const allNoteNames = notesList.map(noteName).filter(Boolean);

  const addNote = async (initialName = '', { silent = false, initialContent } = {}) => {
    const content = initialContent || initialName || '';
    const res = await api.post('/api/notes', { content, origin_project: project }, token);
    if (res?.note) {
      setNotesList(prev => [res.note, ...prev]);
      if (!silent) setActiveNoteId(res.note.id);
    }
  };
  const selectNote = (id) => setActiveNoteId(id);

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
    // Skip if note was just deleted — prevents unmount flush from re-saving
    if (deletedNoteIds.current.has(id)) return;

    const oldNote = notesList.find(n => n.id === id);
    if (!oldNote) return; // note not in list (already removed)
    const oldName = noteName(oldNote);
    const newName = newContent
      ? (newContent.match(/<h1[^>]*>(.*?)<\/h1>/s)?.[1]?.replace(/<[^>]+>/g, '').trim() || newContent.split('\n')[0].trim() || 'Untitled')
      : 'Untitled';

    // Optimistic local update
    setNotesList(prev => prev.map(n =>
      n.id === id ? { ...n, content: newContent, updated_at: new Date().toISOString() } : n
    ));
    // Persist — server extracts title + project_tags from content
    api.patch('/api/notes', { id, content: newContent }, token).then(res => {
      if (deletedNoteIds.current.has(id)) return; // deleted while saving
      if (res?.note) {
        setNotesList(prev => prev.map(n => n.id === id ? { ...n, ...res.note } : n));
      }
    });

    // Propagate rename to all DB entries that reference [oldName]
    if (oldName !== newName && token) {
      const esc2 = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const sb = createClient();

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

      const escHtml = oldName.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const newHtml = newName.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
  const deleteNote = async (id) => {
    // Mark as deleted BEFORE state update so unmount flush skips this note
    deletedNoteIds.current.add(id);
    setNotesList(prev => {
      const remaining = prev.filter(n => n.id !== id);
      setActiveNoteId(remaining[0]?.id ?? null);
      return remaining;
    });
    await api.delete(`/api/notes?id=${id}`, token);
  };

  // Note images — derived from active note content
  const noteImages = useMemo(() => extractImages(activeNote?.content), [activeNote?.content]);

  // Reset lightbox when switching notes or when images change
  useEffect(() => {
    if (noteImages.length === 0) setNoteLightbox(null);
    else if (noteLightbox != null && noteLightbox >= noteImages.length) setNoteLightbox(0);
  }, [noteImages.length, activeNoteId]); // eslint-disable-line

  const addImageToNote = useCallback((url) => {
    if (!activeNote) return;
    const content = activeNote.content || '';
    if (content.includes(url)) return;
    const chipHtml = `<span data-image-chip="${url}">\u{1F4F7}</span> `;
    const newContent = content.includes('</p>')
      ? content.replace(/<\/p>\s*$/, chipHtml + '</p>')
      : content + `<p>${chipHtml}</p>`;
    updateNoteContent(activeNote.id, newContent);
  }, [activeNote, updateNoteContent]);

  const reorderNoteImages = useCallback((newOrder) => {
    if (!activeNote) return;
    let content = activeNote.content || '';
    // Remove all image references
    content = content.replace(/<span\s+data-image-chip="[^"]*"[^>]*>[^<]*<\/span>\s*/g, '');
    content = content.replace(/<div\s+data-imageblock="[^"]*"[^>]*>[\s\S]*?<\/div>/g, '');
    content = content.replace(/\[img:https?:\/\/[^\]]+\]\n?/g, '');
    content = content.replace(/<p>\s*<\/p>/g, '');
    // Re-add in new order
    const chips = newOrder.map(url => `<span data-image-chip="${url}">\u{1F4F7}</span> `).join('');
    if (chips) {
      if (content.includes('</p>')) {
        content = content.replace(/<\/p>\s*$/, chips + '</p>');
      } else {
        content = (content || '') + `<p>${chips}</p>`;
      }
    }
    updateNoteContent(activeNote.id, content);
    setNoteEditorRev(r => r + 1); // force editor remount with new chip order
  }, [activeNote, updateNoteContent]);

  const handleNoteDrop = useCallback(async (e) => {
    e.preventDefault(); e.stopPropagation();
    noteDragCounter.current = 0; setNoteDragging(false);
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
    if (!files.length || !token || !activeNote) return;
    setNoteUploading(true);
    try {
      const urls = await Promise.all(files.map(f => uploadImageFile(f, token)));
      urls.filter(Boolean).forEach(url => addImageToNote(url));
    } finally { setNoteUploading(false); }
  }, [token, activeNote, addImageToNote]);

  const handleNoteDragEnter = useCallback((e) => {
    e.preventDefault(); noteDragCounter.current++;
    if (e.dataTransfer?.types?.includes('Files')) setNoteDragging(true);
  }, []);
  const handleNoteDragLeave = useCallback((e) => {
    e.preventDefault(); noteDragCounter.current--;
    if (noteDragCounter.current <= 0) { noteDragCounter.current = 0; setNoteDragging(false); }
  }, []);
  const handleNoteDragOver = useCallback((e) => { e.preventDefault(); }, []);

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

  // Load entries when project changes — includes LOOK FOR search terms from settings
  // Also refetches when entriesRev bumps (daylab:refresh events)
  useEffect(() => {
    if (!token || !project) return;
    // Only show loading skeleton on initial load, not on refresh
    if (entriesRev === 0) setEntries(null);
    // Load search terms for this project first, then fetch entries
    api.get('/api/settings', token)
      .then(s => {
        const terms = s?.data?.projectSettings?.[project]?.searchTerms ?? [];
        const termsParam = terms.length
          ? `&terms=${terms.map(t => encodeURIComponent(t)).join(',')}`
          : '';
        return api.get(`/api/project-entries?project=${encodeURIComponent(project)}${termsParam}`, token);
      })
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
  }, [project, token, entriesRev]); // eslint-disable-line

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
    const tags = extractTags(text).filter(t => !t.startsWith('__'));
    if (!tags.length) return;
    const meta = projectsMeta || {};
    const newTags = tags.filter(t => !meta[t]);
    if (!newTags.length) return;
    const updated = { ...meta };
    newTags.forEach(t => { updated[t] = { description: '', createdAt: new Date().toISOString() }; });
    setProjectsMeta(updated, { skipHistory: true });
  }

  async function saveJournalEdit(date, lineIndex, newHtml, blockLength = 1) {
    const current = await dbLoad(date, 'journal', token);
    if (current === null) return;
    // Journal content is HTML (<p>…</p> blocks). Split into blocks for editing.
    const paraRe = /<p\b[^>]*>[\s\S]*?<\/p>/gi;
    const blocks = (current || '').match(paraRe) || [];
    // Editor returns HTML — extract <p> blocks from it
    const newBlocks = newHtml.match(paraRe) || [`<p>${newHtml}</p>`];
    blocks.splice(lineIndex, blockLength, ...newBlocks);
    const updated = blocks.join('');
    await dbSave(date, 'journal', updated, token);
    // Update module-level cache so daily view reflects immediately
    MEM[`${userId}:${date}:journal`] = updated;
    window.dispatchEvent(new CustomEvent('daylab:refresh', { detail: { types: ['journal'] } }));
    // Convert HTML to plain text for local state + tag registration
    const newText = newHtml
      .replace(/<span[^>]*data-project-tag="([^"]+)"[^>]*>[^<]*<\/span>/g, '{$1}')
      .replace(/<span[^>]*data-note-link="([^"]+)"[^>]*>[^<]*<\/span>/g, '[$1]')
      .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ').trim();
    registerNewTags(newText);
    setEntries(prev => prev ? {
      ...prev,
      journalEntries: prev.journalEntries.map(e =>
        (e.date === date && e.lineIndex === lineIndex) ? { ...e, text: newText, content: newHtml } : e
      ),
    } : prev);
  }

  // Called by ProjectDateTaskEditor when tasks are saved for a date
  function handleTasksChanged(date, updatedTasks) {
    registerNewTags(updatedTasks.map(t => t.text).join(' '));
    setEntries(prev => prev ? {
      ...prev,
      taskEntries: [
        ...prev.taskEntries.filter(t => t.date !== date),
        ...updatedTasks.map(t => ({ date, id: t.id, text: t.text, done: !!t.done })),
      ],
    } : prev);
  }

  async function addNewJournal(text) {
    if (!text.trim()) return;
    const today = todayKey();
    let entryText = text.trim();
    // Auto-tag with project chip (skip for __everything__ — no project to tag)
    if (project !== '__everything__') {
      const chip = `{${project.toLowerCase()}}`;
      const hasTag = entryText.endsWith(`#${project}`) || entryText.includes(chip);
      if (!hasTag) entryText = `${entryText} ${chip}`;
    }
    const current = await dbLoad(today, 'journal', token);
    const existing = (typeof current === 'string' ? current : '') || '';
    // Journal content is HTML — append as a new <p> block
    const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const newBlock = `<p>${escHtml(entryText)}</p>`;
    const updated = existing ? existing + newBlock : newBlock;
    const paraRe = /<p\b[^>]*>[\s\S]*?<\/p>/gi;
    const allBlocks = updated.match(paraRe) || [];
    const newLineIndex = allBlocks.length - 1;
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
                  {(note.project_tags || []).filter(t => t !== project?.toLowerCase()).map(t => (
                    <span key={t} title={tagDisplayName(t)} style={{ flexShrink: 0, width: 6, height: 6, borderRadius: '50%', background: projectColor(t), marginRight: 2, opacity: 0.7 }}/>
                  ))}
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
            {/* Line above chevron */}
            <div style={{ position: 'absolute', top: 0, bottom: '50%', marginBottom: 10, left: '50%', width: 1, background: 'var(--dl-border)' }}/>
            {/* Line below chevron */}
            <div style={{ position: 'absolute', top: '50%', marginTop: 10, bottom: 0, left: '50%', width: 1, background: 'var(--dl-border)' }}/>
            <div className="notes-chevron" style={{ position: 'relative', zIndex: 1, color: 'var(--dl-border)', transition: 'color 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="7" height="10" viewBox="0 0 7 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {notesListCollapsed
                  ? <polyline points="1.5,1.5 5.5,5 1.5,8.5"/>
                  : <polyline points="5.5,1.5 1.5,5 5.5,8.5"/>}
              </svg>
            </div>
          </div>

          {/* Right: editor + photos — full width when list collapsed */}
          <div
            style={{ flex: 1, minWidth: 0, paddingLeft: 10 }}
            onDragEnter={handleNoteDragEnter}
            onDragLeave={handleNoteDragLeave}
            onDragOver={handleNoteDragOver}
            onDrop={handleNoteDrop}
          >
            {/* Photos for current note */}
            {noteImages.length > 0 && (
              noteLightbox != null
                ? <Slideshow images={noteImages} index={noteLightbox} onClose={() => setNoteLightbox(null)} />
                : <PhotoStrip images={noteImages} onViewImage={i => setNoteLightbox(i)} onReorder={reorderNoteImages} />
            )}
            {(noteDragging || noteUploading) ? (
              <DropZone uploading={noteUploading} />
            ) : activeNote ? (
              <DayLabEditor
                key={`${activeNote.id}:${noteEditorRev}`}
                value={activeNote.content || ''}
                noteTitle
                autoFocus
                onBlur={html => updateNoteContent(activeNote.id, html)}
                onImageUpload={file => uploadImageFile(file, token)}
                onImageDelete={src => deleteImageFile(src, token)}
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
                hideInlineImages
                style={{ minHeight: 180, width: '100%' }}
              />
            ) : (
              <DayLabEditor
                key="phantom"
                value=""
                noteTitle
                onBlur={html => { if (skipPhantomBlur.current) { skipPhantomBlur.current = false; return; } const text = html?.replace(/<[^>]*>/g, '').trim(); if (text && text !== 'Untitled') { skipPhantomBlur.current = true; addNote('', { initialContent: html }); } }}
                onImageUpload={file => uploadImageFile(file, token)}
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
        ) : (() => {
          const todayStr = todayKey();
          const otherDates = tasksByDate.filter(([d]) => d !== todayStr).sort(([a],[b]) => b.localeCompare(a));
          const todayEntry = tasksByDate.find(([d]) => d === todayStr);
          // Always include Today section with editor (even when empty)
          const allDates = todayEntry
            ? [[todayStr, todayEntry[1]], ...otherDates]
            : [[todayStr, { all:[], open:[], done:[] }], ...otherDates];

          return (
            <div>
              {allDates.filter(([date, { open, done }]) =>
                pvTaskFilter === 'open' ? (open.length > 0 || date === todayStr) :
                pvTaskFilter === 'done' ? (done.length > 0 || date === todayStr) : true
              ).map(([date, { all }], dateIdx) => {
                const isToday = date === todayStr;
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
                    <ProjectDateTaskEditor
                      key={`${project}-${date}`}
                      date={date}
                      project={project}
                      tasks={all}
                      token={token}
                      userId={userId}
                      onTasksChanged={handleTasksChanged}
                      taskFilter={pvTaskFilter}
                    />
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
                  onStartEdit={() => setEditingEntry({ date, lineIndex: entry.lineIndex, text: entry.text, content: entry.content })}
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
                      {isToday && (
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
          projectData={projectsMap?.get(project)}
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

