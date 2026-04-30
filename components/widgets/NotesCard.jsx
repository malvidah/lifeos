"use client";
import { useState, useEffect, useRef, useCallback, useMemo, useContext } from "react";
import { createPortal } from "react-dom";
import { mono, F } from "@/lib/tokens";
import { api } from "@/lib/api";
import { useCollapse } from "@/lib/hooks";
import { createClient } from "@/lib/supabase";
import { useDbSave, MEM } from "@/lib/db";
import { ProjectNamesContext, NavigationContext, TripNamesContext } from "@/lib/contexts";
import { useTripByName } from "@/lib/useTrips";
import { Card } from "../ui/primitives.jsx";
import { showToast } from "../ui/Toast.jsx";
import { DayLabEditor } from "../Editor.jsx";
import { extractImages, stripImageChips, extractDrawingTags, extractPlaceTags, MediaStrip, MediaSlideshow, DropZone } from "./JournalEditor.jsx";
import { NoteContext } from "@/lib/contexts";
import { useTheme } from "@/lib/theme";
import { uploadImageFile, deleteImageFile } from "@/lib/images";
import NotesKanban from "./NotesKanban.jsx";
import NotesGrid from "./NotesGrid.jsx";
import { firstMediaForNote } from "./NoteCardItem.jsx";

// Inline editable title shown next to the back chevron in kanban detail view.
// Local state so typing doesn't thrash parent re-renders; commit on blur/Enter.
function KanbanTitleRow({ note, currentTitle, onBack, onTitleCommit }) {
  const [draft, setDraft] = useState(currentTitle);
  // Sync draft if the note (or its title) changes externally (e.g. cascade rename).
  useEffect(() => { setDraft(currentTitle); }, [note.id, currentTitle]);
  const inputRef = useRef(null);
  const commit = () => {
    const next = draft.trim();
    if (!next) { setDraft(currentTitle); return; }
    if (next !== currentTitle) onTitleCommit(next);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, gap: 4 }}>
      <button
        onClick={onBack}
        title="Back to kanban"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--dl-middle)', fontFamily: mono, fontSize: 18,
          padding: '0 4px 0 0', lineHeight: 1, flexShrink: 0,
        }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--dl-strong)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--dl-middle)'}
      >‹</button>
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); inputRef.current?.blur(); }
          if (e.key === 'Escape') { setDraft(currentTitle); inputRef.current?.blur(); }
        }}
        placeholder="Untitled"
        style={{
          flex: 1, minWidth: 0,
          background: 'transparent', border: 'none', outline: 'none', padding: 0,
          fontFamily: mono, fontSize: '0.8em', fontWeight: 400,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          color: 'var(--dl-strong)',
        }}
      />
    </div>
  );
}

// ─── NotesCard ────────────────────────────────────────────────────────────────
// Self-contained Notes tab card.
// project: null → show all notes; any string → show notes tagged to that project
// onNoteNamesChange: called whenever note list changes so Dashboard can sync NoteContext
export default function NotesCard({ project, token, userId, onNoteNamesChange, collapsed: externalCollapsed, onToggle: externalToggle, expandHref }) {
  const pvProjectNames = useContext(ProjectNamesContext);
  const pvTripNames    = useContext(TripNamesContext);
  const { navigateToProject, navigateToTrip } = useContext(NavigationContext);
  const { drawings: ctxDrawings } = useContext(NoteContext);
  const { theme } = useTheme();
  const dark = theme === 'dark';

  // null means "all notes"
  const effectiveProject = project || '__everything__';

  const { value: projectsMeta, setValue: setProjectsMeta } =
    useDbSave('global', 'projects', {}, token, userId);

  const [notesList, setNotesList] = useState([]);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const deletedNoteIds = useRef(new Set());

  // Note media state
  const [noteMediaIdx, setNoteMediaIdx] = useState(null); // null = strip, 0+ = slideshow
  const [noteDragging, setNoteDragging] = useState(false);
  const [noteUploading, setNoteUploading] = useState(false);
  const noteEditorRef = useRef(null);
  const noteDragCounter = useRef(0);

  // Drawings data pipeline (same as JournalEditor)
  const [allDrawingsList, setAllDrawingsList] = useState([]);
  useEffect(() => {
    if (!token) return;
    api.get('/api/drawings', token).then(d => setAllDrawingsList(d?.drawings ?? [])).catch(() => {});
  }, [token]);

  const [drawingStrokesCache, setDrawingStrokesCache] = useState({});

  // All places for map items
  const [allPlaces, setAllPlaces] = useState([]);
  useEffect(() => {
    if (!token) return;
    api.get('/api/places', token).then(d => setAllPlaces(d?.places ?? [])).catch(() => {});
  }, [token]);

  // All trips (with slim stops incl. lat/lng) so card thumbnails can render
  // a route silhouette without per-trip detail fetches.
  const [allTrips, setAllTrips] = useState([]);
  useEffect(() => {
    if (!token) return;
    api.get('/api/trips', token).then(d => setAllTrips(d?.trips ?? [])).catch(() => {});
    const refresh = () => api.get('/api/trips', token).then(d => setAllTrips(d?.trips ?? [])).catch(() => {});
    window.addEventListener('daylab:trips-changed', refresh);
    return () => window.removeEventListener('daylab:trips-changed', refresh);
  }, [token]);

  // Load notes whenever project changes
  useEffect(() => {
    if (!token) return;
    let stale = false;
    const url = effectiveProject === '__everything__'
      ? '/api/notes'
      : `/api/notes?project=${encodeURIComponent(effectiveProject)}`;
    api.get(url, token)
      .then(res => {
        if (stale) return;
        const notes = res?.notes || [];
        setNotesList(notes);
        setActiveNoteId(prev => notes.find(n => n.id === prev) ? prev : notes[0]?.id ?? null);
      })
      .catch(() => { showToast('Failed to load notes', 'error'); });
    return () => { stale = true; };
  }, [effectiveProject, token]); // eslint-disable-line

  const activeNote = notesList.find(n => n.id === activeNoteId) ?? notesList[0] ?? null;

  const noteName = (note) => {
    const c = note?.content || '';
    if (c.startsWith('<')) {
      const m = c.match(/<h1[^>]*>(.*?)<\/h1>/s);
      return m ? m[1].replace(/<[^>]+>/g, '').trim() || 'Untitled' : 'Untitled';
    }
    return c.split('\n')[0].trim() || 'Untitled';
  };

  // Notes view mode: 'manual' (drag-reorder tabs), 'recent' (sort by updated), 'kanban' (status board).
  // Persisted per project via localStorage so each project can remember its preferred view.
  const viewModeKey = `view:${effectiveProject}:notes`;
  const [notesViewMode, setNotesViewModeState] = useState(() => {
    if (typeof window === 'undefined') return 'manual';
    return localStorage.getItem(viewModeKey) || 'manual';
  });
  // Re-sync when the project (and thus the key) changes.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setNotesViewModeState(localStorage.getItem(viewModeKey) || 'manual');
  }, [viewModeKey]);
  const setNotesViewMode = (m) => {
    setNotesViewModeState(m);
    if (typeof window !== 'undefined') localStorage.setItem(viewModeKey, m);
  };
  const kanbanMode = notesViewMode === 'kanban';
  const [kanbanDetailId, setKanbanDetailId] = useState(null);

  const [noteSearch, setNoteSearch] = useState('');
  const [noteSearchOpen, setNoteSearchOpen] = useState(false);
  const noteSearchRef = useRef(null);

  // Sorted note list for grid view. Manual = projectsMeta order; recent = updated_at desc.
  // Kanban does its own grouping by status, so this only feeds the grid component.
  const sortedNotes = useMemo(() => {
    if (notesViewMode === 'recent') {
      return [...notesList].sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    }
    const order = (projectsMeta || {})[effectiveProject]?.noteOrder || [];
    const orderMap = new Map(order.map((id, i) => [id, i]));
    return [...notesList].sort((a, b) => {
      const ai = orderMap.has(a.id) ? orderMap.get(a.id) : 9999;
      const bi = orderMap.has(b.id) ? orderMap.get(b.id) : 9999;
      if (ai !== bi) return ai - bi;
      return new Date(a.created_at || 0) - new Date(b.created_at || 0);
    });
  }, [notesList, projectsMeta, effectiveProject, notesViewMode]);

  const filteredNotes = useMemo(() => {
    if (!noteSearch) return notesList;
    const q = noteSearch.toLowerCase();
    return notesList.filter(n => {
      const name = noteName(n).toLowerCase();
      const body = (n.content || '').replace(/<[^>]+>/g, '').toLowerCase();
      return name.includes(q) || body.includes(q);
    });
  }, [notesList, noteSearch]);

  const filteredSortedNotes = useMemo(() => {
    if (!noteSearch) return sortedNotes;
    const q = noteSearch.toLowerCase();
    return sortedNotes.filter(n => {
      const name = noteName(n).toLowerCase();
      const body = (n.content || '').replace(/<[^>]+>/g, '').toLowerCase();
      return name.includes(q) || body.includes(q);
    });
  }, [sortedNotes, noteSearch]);

  const allNoteNames = notesList.map(noteName).filter(Boolean);

  // Propagate note names to Dashboard so NoteContext.Provider at that level stays current
  useEffect(() => {
    onNoteNamesChange?.(allNoteNames);
  }, [allNoteNames.join(',')]); // eslint-disable-line

  // Compute the first media item for a note (image > drawing > place > trip).
  // Used by grid/kanban cards for the banner thumbnail.
  const getMediaPreview = useCallback(
    (note) => firstMediaForNote(note, { drawings: allDrawingsList, trips: allTrips }),
    [allDrawingsList, allTrips]
  );

  const saveNoteOrder = useCallback((orderedIds) => {
    if (effectiveProject === '__everything__') return;
    setProjectsMeta(prev => {
      const updated = { ...(prev || {}) };
      updated[effectiveProject] = { ...(updated[effectiveProject] || {}), noteOrder: orderedIds };
      return updated;
    }, { skipHistory: true });
  }, [effectiveProject, setProjectsMeta]);

  const addNote = useCallback(async (initialName = '', { silent = false, initialContent, status } = {}) => {
    const content = initialContent || initialName || '';
    const res = await api.post('/api/notes', {
      content,
      origin_project: effectiveProject === '__everything__' ? null : effectiveProject,
      status: status || undefined,
    }, token);
    if (res?.note) {
      setNotesList(prev => [res.note, ...prev]);
      if (!silent) setActiveNoteId(res.note.id);
    }
    return res?.note ?? null;
  }, [effectiveProject, token]);

  // Update a note's status (used by the kanban view's drag-drop). Optimistic.
  const patchNoteStatus = useCallback(async (id, status) => {
    setNotesList(prev => prev.map(n => n.id === id ? { ...n, status } : n));
    try {
      const res = await api.patch('/api/notes', { id, status }, token);
      if (res?.note) setNotesList(prev => prev.map(n => n.id === id ? { ...n, ...res.note } : n));
    } catch {
      showToast('Failed to update status', 'error');
    }
  }, [token]);

  // Bulk-rename: change all notes whose status === oldStatus to newStatus.
  // Used when a kanban column header is renamed.
  const bulkRenameStatus = useCallback(async (oldStatus, newStatus) => {
    setNotesList(prev => prev.map(n => {
      const s = (n.status || 'new').toLowerCase().trim();
      return s === oldStatus ? { ...n, status: newStatus } : n;
    }));
    try {
      await api.patch('/api/notes', { id: '__bulk__', oldStatus, status: newStatus }, token);
    } catch {
      showToast('Failed to rename column', 'error');
    }
  }, [token]);

  // Open a note in detail mode (used by external navigation events + note links).
  const openNoteDetail = useCallback((id) => {
    setActiveNoteId(id);
    setKanbanDetailId(id);
  }, []);

  // Navigate-to-note from journal chip clicks
  useEffect(() => {
    const goHandler = async (e) => {
      const targetName = e.detail?.name || '';
      const match = notesList.find(n => noteName(n).toLowerCase() === targetName.toLowerCase());
      if (match) openNoteDetail(match.id);
      else {
        const note = await addNote(targetName);
        if (note) openNoteDetail(note.id);
      }
    };
    const createHandler = async (e) => {
      const note = await addNote(e.detail?.name || '');
      if (note) openNoteDetail(note.id);
    };
    window.addEventListener('daylab:go-to-note', goHandler);
    window.addEventListener('daylab:create-note', createHandler);
    return () => {
      window.removeEventListener('daylab:go-to-note', goHandler);
      window.removeEventListener('daylab:create-note', createHandler);
    };
  }, [notesList, addNote, openNoteDetail]); // eslint-disable-line

  const updateNoteContent = useCallback((id, newContent) => {
    if (deletedNoteIds.current.has(id)) return;
    const oldNote = notesList.find(n => n.id === id);
    if (!oldNote) return;
    const oldName = noteName(oldNote);
    const newName = newContent
      ? (newContent.match(/<h1[^>]*>(.*?)<\/h1>/s)?.[1]?.replace(/<[^>]+>/g, '').trim() || newContent.split('\n')[0].trim() || 'Untitled')
      : 'Untitled';

    setNotesList(prev => prev.map(n =>
      n.id === id ? { ...n, content: newContent, updated_at: new Date().toISOString() } : n
    ));
    api.patch('/api/notes', { id, content: newContent }, token).then(res => {
      if (deletedNoteIds.current.has(id)) return;
      if (res?.note) {
        setNotesList(prev => prev.map(n => n.id === id ? { ...n, ...res.note } : n));
      }
    });

    // Propagate rename to all DB entries that reference [oldName]
    if (oldName !== newName && token && userId) {
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
    }
  }, [notesList, token, userId]); // eslint-disable-line

  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const deleteNote = async (id) => {
    deletedNoteIds.current.add(id);
    setNotesList(prev => {
      const remaining = prev.filter(n => n.id !== id);
      setActiveNoteId(remaining[0]?.id ?? null);
      return remaining;
    });
    // If we were viewing the deleted note in kanban detail mode, return to the grid.
    setKanbanDetailId(prev => prev === id ? null : prev);
    await api.delete(`/api/notes?id=${id}`, token);
  };

  const noteImages = useMemo(() => extractImages(activeNote?.content), [activeNote?.content]);

  // Ambient trip preview: when the active note has a /tr trip tag, surface
  // that trip on the WorldMap (preview only — won't override an active
  // detail-mode trip). Picks the FIRST trip tag in the note.
  useEffect(() => {
    const html = activeNote?.content || '';
    const m = html.match(/data-trip-tag="([^"]+)"/);
    const tripName = m?.[1];
    if (!tripName) return;
    navigateToTrip(tripName, { openDetail: false });
  }, [activeNote?.id, activeNote?.content, navigateToTrip]);

  // Fetch strokes for drawing tags in the active note
  useEffect(() => {
    if (!token || !allDrawingsList.length || !activeNote?.content) return;
    const titles = extractDrawingTags(activeNote.content);
    if (!titles.length) return;
    const needed = allDrawingsList.filter(d => titles.includes(d.title) && !drawingStrokesCache[d.id]);
    if (!needed.length) return;
    Promise.all(needed.map(d => api.get(`/api/drawings?id=${d.id}`, token)))
      .then(results => {
        const updates = {};
        results.forEach((r, i) => { if (r?.drawing?.strokes) updates[needed[i].id] = r.drawing.strokes; });
        if (Object.keys(updates).length) setDrawingStrokesCache(prev => ({ ...prev, ...updates }));
      }).catch(() => {});
  }, [token, allDrawingsList, activeNote?.content]); // eslint-disable-line

  // Build drawing data map: title → { strokes, thumbnail }
  const drawingDataMap = useMemo(() => {
    const map = {};
    allDrawingsList.forEach(d => {
      map[d.title] = { strokes: drawingStrokesCache[d.id] || [], thumbnail: d.thumbnail || null };
    });
    // Only override with live context strokes when non-empty (ctxDrawings list API has no strokes)
    (ctxDrawings || []).forEach(d => {
      if (d && typeof d === 'object' && d.title && d.strokes?.length > 0) {
        map[d.title] = { strokes: d.strokes, thumbnail: d.thumbnail || null };
      }
    });
    return map;
  }, [allDrawingsList, drawingStrokesCache, ctxDrawings]);

  // Typed photo media items
  const notePhotoItems = useMemo(() => noteImages.map(url => ({ type: 'photo', url })), [noteImages]);

  // Typed drawing media items from /d tags in the note content
  const noteDrawingItems = useMemo(() => {
    if (!activeNote?.content) return [];
    return extractDrawingTags(activeNote.content)
      .map(t => drawingDataMap[t] ? { type: 'drawing', title: t, strokes: drawingDataMap[t].strokes, thumbnail: drawingDataMap[t].thumbnail } : null)
      .filter(Boolean);
  }, [activeNote?.content, drawingDataMap]);

  // Place map item from /p tags in the note content
  const noteMapItem = useMemo(() => {
    if (!activeNote?.content || !allPlaces.length) return null;
    const taggedNames = extractPlaceTags(activeNote.content);
    if (!taggedNames.length) return null;
    const tagged = taggedNames
      .map(name => allPlaces.find(p => p.name === name))
      .filter(p => p && p.lat != null && p.lng != null)
      .map(p => ({ name: p.name, lat: p.lat, lng: p.lng, color: p.color }));
    return tagged.length ? { type: 'map', places: tagged } : null;
  }, [activeNote?.content, allPlaces]);

  // Trip mini-map item from the first /tr tag in the note content. Loaded
  // lazily; renders as a routed mini-map in the media strip.
  const noteTripName = useMemo(() => {
    const m = activeNote?.content?.match(/data-trip-tag="([^"]+)"/);
    return m?.[1] || null;
  }, [activeNote?.content]);
  const noteTripData = useTripByName(noteTripName, token);
  const noteTripItem = useMemo(() => {
    if (!noteTripData || !(noteTripData.stops?.length)) return null;
    return { type: 'trip-map', name: noteTripData.name, trip: noteTripData };
  }, [noteTripData]);

  // All visual media: photos + drawings + map + trip
  const allNoteMedia = useMemo(() => {
    const items = [...notePhotoItems, ...noteDrawingItems];
    if (noteMapItem)  items.push(noteMapItem);
    if (noteTripItem) items.push(noteTripItem);
    return items;
  }, [notePhotoItems, noteDrawingItems, noteMapItem, noteTripItem]);

  useEffect(() => {
    if (allNoteMedia.length === 0) setNoteMediaIdx(null);
    else if (noteMediaIdx != null && noteMediaIdx >= allNoteMedia.length) setNoteMediaIdx(0);
  }, [allNoteMedia.length, activeNoteId]); // eslint-disable-line

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
    content = stripImageChips(content);
    content = content.replace(/<div\s+data-imageblock="[^"]*"[^>]*>[\s\S]*?<\/div>/g, '');
    content = content.replace(/\[img:https?:\/\/[^\]]+\]\n?/g, '');
    content = content.replace(/<p>\s*<\/p>/g, '');
    const chips = newOrder.map(url => `<span data-image-chip="${url}">\u{1F4F7}</span> `).join('');
    if (chips) {
      if (content.includes('</p>')) {
        content = content.replace(/<\/p>\s*$/, chips + '</p>');
      } else {
        content = (content || '') + `<p>${chips}</p>`;
      }
    }
    updateNoteContent(activeNote.id, content);
    noteEditorRef.current?.setContent?.(content);
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

  const [internalCollapsed, internalToggle] = useCollapse(`pv:${effectiveProject}:notes`, false);
  const notesCollapsed = externalCollapsed != null ? externalCollapsed : internalCollapsed;
  const toggleNotes = externalToggle || internalToggle;

  return (
    <>

      {/* Notes card */}
      <Card
        label="📄 Notes"
        color={"var(--dl-highlight)"}
        collapsed={notesCollapsed}
        onToggle={toggleNotes}
        expandHref={expandHref}
        headerLeft={!kanbanDetailId && (
          <button
            onClick={async (e) => { e.stopPropagation(); const note = await addNote(''); if (note) { setActiveNoteId(note.id); setKanbanDetailId(note.id); } }}
            title="New note"
            style={{ background:'none', border:'none', cursor:'pointer', color:'var(--dl-middle)', padding:'2px 4px', display:'flex', alignItems:'center', fontSize:16, lineHeight:1 }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--dl-strong)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--dl-middle)'}
          >+</button>
        )}
        headerRight={
          <div style={{ display:'flex', alignItems:'center', gap:6 }} onClick={e => e.stopPropagation()}>
            {noteSearchOpen ? (
              <div style={{ display:'flex', alignItems:'center', gap:4, background:'var(--dl-border-15, rgba(128,120,100,0.1))', borderRadius:100, padding:'2px 8px' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--dl-middle)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  ref={noteSearchRef}
                  value={noteSearch}
                  onChange={e => setNoteSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') { setNoteSearch(''); setNoteSearchOpen(false); } }}
                  placeholder="search..."
                  autoFocus
                  style={{
                    background:'transparent', border:'none', outline:'none',
                    fontFamily: mono, fontSize:11, color:'var(--dl-strong)',
                    width: 100, padding:'4px 0',
                  }}
                />
                <button
                  onClick={() => { setNoteSearch(''); setNoteSearchOpen(false); }}
                  style={{ background:'none', border:'none', cursor:'pointer', color:'var(--dl-middle)', padding:'2px 0', fontSize:14, lineHeight:1, fontFamily:mono }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--dl-strong)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--dl-middle)'}
                >×</button>
              </div>
            ) : (
              <button
                onClick={() => { setNoteSearchOpen(true); setTimeout(() => noteSearchRef.current?.focus(), 0); }}
                title="Search notes"
                style={{ background:'none', border:'none', cursor:'pointer', color:'var(--dl-middle)', padding:'4px', display:'flex', alignItems:'center' }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--dl-strong)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--dl-middle)'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </button>
            )}
            <div style={{ display:'flex', gap:2, background:'var(--dl-border-15, rgba(128,120,100,0.1))', borderRadius:100, padding:2 }}>
              {[
                { key: 'manual', label: 'Manual order',
                  icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="9" y2="18"/></svg> },
                { key: 'recent', label: 'Recent first',
                  icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
                { key: 'kanban', label: 'Kanban by status',
                  icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1" y="1.5" width="3.5" height="13" rx="1"/><rect x="6.25" y="1.5" width="3.5" height="8.5" rx="1"/><rect x="11.5" y="1.5" width="3.5" height="10.5" rx="1"/></svg> },
              ].map(({key, label, icon}) => {
                const active = notesViewMode === key;
                return (
                  <button key={key} onClick={() => { if (!active) { setNotesViewMode(key); setKanbanDetailId(null); } }}
                    aria-label={label} aria-pressed={active}
                    style={{
                      padding:'4px 8px', borderRadius:100, cursor:'pointer', border:'none',
                      display:'flex', alignItems:'center',
                      background: active ? 'var(--dl-glass-active, var(--dl-accent-13))' : 'transparent',
                      color: active ? 'var(--dl-strong)' : 'var(--dl-middle)',
                      transition:'all 0.15s',
                    }}
                    onMouseEnter={e => { if (!active) { e.currentTarget.style.color='var(--dl-strong)'; e.currentTarget.style.background='var(--dl-glass-active, var(--dl-accent-13))'; } }}
                    onMouseLeave={e => { if (!active) { e.currentTarget.style.color='var(--dl-middle)'; e.currentTarget.style.background='transparent'; } }}
                  >{icon}</button>
                );
              })}
            </div>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 220 }}>
          {/* Detail-mode style: hide the editor's H1 since the title input lives in the header row. */}
          {kanbanDetailId && (
            <style>{`.dl-hide-h1 .ProseMirror h1 { display: none; }`}</style>
          )}

          {/* ── Detail header: back chevron + inline editable title (any mode) ── */}
          {kanbanDetailId && activeNote && (
            <KanbanTitleRow
              key={activeNote.id}
              note={activeNote}
              currentTitle={noteName(activeNote)}
              onBack={() => setKanbanDetailId(null)}
              onTitleCommit={(newTitle) => {
                const cleaned = newTitle.trim();
                if (!cleaned) return;
                const oldContent = activeNote.content || '';
                const escHtml = cleaned.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
                const next = /<h1[^>]*>.*?<\/h1>/s.test(oldContent)
                  ? oldContent.replace(/<h1([^>]*)>.*?<\/h1>/s, `<h1$1>${escHtml}</h1>`)
                  : `<h1>${escHtml}</h1>${oldContent}`;
                if (next === oldContent) return;
                updateNoteContent(activeNote.id, next);
                noteEditorRef.current?.setContent?.(next);
              }}
            />
          )}

          {/* ── Grid views (no detail open) ───────────────────────────────── */}
          {!kanbanDetailId && kanbanMode && (
            <NotesKanban
              notes={filteredNotes}
              noteName={noteName}
              effectiveProject={effectiveProject}
              projectsMeta={projectsMeta}
              setProjectsMeta={setProjectsMeta}
              onSelectNote={(id) => { setActiveNoteId(id); setKanbanDetailId(id); setNoteSearch(''); setNoteSearchOpen(false); }}
              onAddNote={async (status) => {
                const note = await addNote('', { status });
                if (note) { setActiveNoteId(note.id); setKanbanDetailId(note.id); }
              }}
              onPatchNote={(id, updates) => {
                if (updates.status !== undefined) patchNoteStatus(id, updates.status);
              }}
              onBulkRenameStatus={bulkRenameStatus}
              getMediaPreview={getMediaPreview}
            />
          )}
          {!kanbanDetailId && !kanbanMode && (
            <NotesGrid
              notes={filteredSortedNotes}
              noteName={noteName}
              effectiveProject={effectiveProject}
              sort={notesViewMode}
              onSelectNote={(id) => { setActiveNoteId(id); setKanbanDetailId(id); setNoteSearch(''); setNoteSearchOpen(false); }}
              onAddNote={async () => {
                const note = await addNote('');
                if (note) { setActiveNoteId(note.id); setKanbanDetailId(note.id); }
              }}
              onSaveOrder={saveNoteOrder}
              getMediaPreview={getMediaPreview}
            />
          )}

          {/* ── Editor — only when a note is open in detail mode ──────────── */}
          {kanbanDetailId && (
          <div
            data-no-pointer-capture
            className="dl-hide-h1"
            style={{ flex: 1, minWidth: 0, position: 'relative' }}
            onDragEnter={handleNoteDragEnter}
            onDragLeave={handleNoteDragLeave}
            onDragOver={handleNoteDragOver}
            onDrop={handleNoteDrop}
          >
            {/* Delete note button */}
            {activeNote && (
              <div style={{ position: 'absolute', top: 4, right: 4, zIndex: 2, display: 'flex', gap: 2 }}>
                {/* Public/private toggle — eye-open = public, eye-off = private */}
                <button
                  onClick={() => {
                    const next = !activeNote.is_public;
                    setNotesList(prev => prev.map(n => n.id === activeNote.id ? { ...n, is_public: next } : n));
                    api.patch('/api/notes', { id: activeNote.id, is_public: next }, token).catch(() => {
                      // rollback on failure
                      setNotesList(prev => prev.map(n => n.id === activeNote.id ? { ...n, is_public: !next } : n));
                      showToast('Failed to update visibility', 'error');
                    });
                  }}
                  title={activeNote.is_public ? 'Public — click to make private' : 'Private — click to make public'}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: activeNote.is_public ? 'var(--dl-accent)' : 'var(--dl-middle)',
                    padding: 6, borderRadius: 6, transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = activeNote.is_public ? 'var(--dl-accent)' : 'var(--dl-strong)'}
                  onMouseLeave={e => e.currentTarget.style.color = activeNote.is_public ? 'var(--dl-accent)' : 'var(--dl-middle)'}
                >
                  {activeNote.is_public ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  )}
                </button>
                <button
                  onClick={() => setDeleteConfirm({ id: activeNote.id, name: noteName(activeNote) })}
                  title="Delete note"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--dl-middle)', padding: 6, borderRadius: 6,
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--dl-strong)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--dl-middle)'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                    <line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
                  </svg>
                </button>
              </div>
            )}
            {/* Media strip / slideshow for current note */}
            {allNoteMedia.length > 0 && (
              noteMediaIdx != null
                ? <MediaSlideshow mediaItems={allNoteMedia} index={noteMediaIdx} onClose={() => setNoteMediaIdx(null)} dark={dark} token={token} />
                : <MediaStrip mediaItems={allNoteMedia} onViewItem={i => setNoteMediaIdx(i)} onReorderPhotos={reorderNoteImages} dark={dark} token={token} />
            )}
            {(noteDragging || noteUploading) ? (
              <DropZone uploading={noteUploading} />
            ) : activeNote ? (
              <DayLabEditor
                ref={noteEditorRef}
                key={activeNote.id}
                value={activeNote.content || ''}
                noteTitle
                autoFocus
                showScheduleTags={false}
                onBlur={html => updateNoteContent(activeNote.id, html)}
                onImageUpload={file => uploadImageFile(file, token)}
                onImageDelete={src => deleteImageFile(src, token)}
                noteNames={allNoteNames.filter(n => n !== noteName(activeNote))}
                projectNames={pvProjectNames}
                tripNames={pvTripNames}
                onCreateNote={addNote}
                onProjectClick={name => navigateToProject(name)}
                onTripClick={name => navigateToTrip(name, { openDetail: true })}
                onNoteClick={name => {
                  const match = notesList.find(n => noteName(n).toLowerCase() === name.toLowerCase());
                  if (match) { setActiveNoteId(match.id); setKanbanDetailId(match.id); }
                  else addNote(name).then(n => { if (n) { setActiveNoteId(n.id); setKanbanDetailId(n.id); } });
                }}
                textColor={"var(--dl-strong)"}
                mutedColor={"var(--dl-middle)"}
                color={"var(--dl-highlight)"}
                hideInlineImages
                style={{ minHeight: 180, width: '100%' }}
              />
            ) : null}
          </div>
          )}
        </div>
      </Card>

      {/* Delete note confirmation dialog — rendered via portal to escape Card's backdropFilter stacking context */}
      {deleteConfirm && typeof document !== 'undefined' && createPortal(
        <>
          <div
            onClick={() => setDeleteConfirm(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            zIndex: 9001, width: 'min(340px, calc(100vw - 40px))',
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
        </>,
        document.body
      )}
    </>
  );
}
