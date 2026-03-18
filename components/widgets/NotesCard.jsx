"use client";
import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useContext } from "react";
import { mono, F } from "@/lib/tokens";
import { api } from "@/lib/api";
import { useCollapse } from "@/lib/hooks";
import { createClient } from "@/lib/supabase";
import { useDbSave, MEM } from "@/lib/db";
import { NoteContext, ProjectNamesContext, NavigationContext } from "@/lib/contexts";
import { Card } from "../ui/primitives.jsx";
import { DayLabEditor } from "../Editor.jsx";
import { extractImages, stripImageChips, PhotoStrip, Slideshow, DropZone } from "./JournalEditor.jsx";
import { uploadImageFile, deleteImageFile } from "@/lib/images";

// ─── NotesCard ────────────────────────────────────────────────────────────────
// Self-contained Notes tab card.
// project: null or "__everything__" → show all notes
//          any other string → show notes tagged to that project
export default function NotesCard({ project, token, userId }) {
  const pvProjectNames = useContext(ProjectNamesContext);
  const { navigateToProject } = useContext(NavigationContext);

  // Normalize: null and __everything__ both mean "all notes"
  const effectiveProject = (!project || project === '__everything__') ? '__everything__' : project;

  const { value: projectsMeta, setValue: setProjectsMeta } =
    useDbSave('global', 'projects', {}, token, userId);

  const [notesList, setNotesList] = useState([]);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const deletedNoteIds = useRef(new Set());

  // Note photos state
  const [noteLightbox, setNoteLightbox] = useState(null);
  const [noteDragging, setNoteDragging] = useState(false);
  const [noteUploading, setNoteUploading] = useState(false);
  const noteEditorRef = useRef(null);
  const noteDragCounter = useRef(0);

  // Load notes whenever project changes
  useEffect(() => {
    if (!token) return;
    let stale = false;
    setNotesLoaded(false);
    const url = effectiveProject === '__everything__'
      ? '/api/notes'
      : `/api/notes?project=${encodeURIComponent(effectiveProject)}`;
    api.get(url, token)
      .then(res => {
        if (stale) return;
        const notes = res?.notes || [];
        setNotesList(notes);
        setNotesLoaded(true);
        setActiveNoteId(prev => notes.find(n => n.id === prev) ? prev : notes[0]?.id ?? null);
      })
      .catch(() => { if (!stale) setNotesLoaded(true); });
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

  // Notes sort mode
  const [notesSortRecent, toggleNotesSort] = useCollapse(`pv:${effectiveProject}:notes-sort`, false);
  const [recentPinnedId, setRecentPinnedId] = useState(null);

  const sortedNotes = useMemo(() => {
    if (notesSortRecent) {
      const byDate = [...notesList].sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
      if (recentPinnedId && byDate.length > 1 && byDate[0]?.id !== recentPinnedId) {
        const pinnedIdx = byDate.findIndex(n => n.id === recentPinnedId);
        if (pinnedIdx > 0) { const [p] = byDate.splice(pinnedIdx, 1); byDate.unshift(p); }
      }
      return byDate;
    }
    const order = (projectsMeta || {})[effectiveProject]?.noteOrder || [];
    const orderMap = new Map(order.map((id, i) => [id, i]));
    return [...notesList].sort((a, b) => {
      const ai = orderMap.has(a.id) ? orderMap.get(a.id) : 9999;
      const bi = orderMap.has(b.id) ? orderMap.get(b.id) : 9999;
      if (ai !== bi) return ai - bi;
      return new Date(a.created_at || 0) - new Date(b.created_at || 0);
    });
  }, [notesList, projectsMeta, effectiveProject, notesSortRecent, recentPinnedId]);

  const allNoteNames = notesList.map(noteName).filter(Boolean);

  const saveNoteOrder = useCallback((orderedIds) => {
    if (!effectiveProject || effectiveProject === '__everything__') return;
    setProjectsMeta(prev => {
      const updated = { ...(prev || {}) };
      updated[effectiveProject] = { ...(updated[effectiveProject] || {}), noteOrder: orderedIds };
      return updated;
    }, { skipHistory: true });
  }, [effectiveProject, setProjectsMeta]);

  // FLIP animation refs
  const tabElemsRef = useRef({});
  const pendingFlipSnap = useRef(null);

  // Drag-to-reorder tab state
  const tabRowRef = useRef(null);
  const tabPending = useRef(null);
  const tabItemWidths = useRef([]);
  const tabDragIdxRef = useRef(null);
  const tabOverIdxRef = useRef(null);
  const [tabDragging, setTabDragging] = useState(false);
  const [, tabBump] = useState(0);

  const canReorderTabs = !notesSortRecent && sortedNotes.length > 1;

  const calcTabOver = (clientX) => {
    const rect = tabRowRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const relX = clientX - rect.left + (tabRowRef.current?.scrollLeft || 0);
    let accum = 0;
    for (let i = 0; i < tabItemWidths.current.length; i++) {
      accum += tabItemWidths.current[i];
      if (relX < accum - tabItemWidths.current[i] / 2) return i;
    }
    return Math.max(0, tabItemWidths.current.length - 1);
  };

  const handleTabPointerDown = (e, idx) => {
    if (!canReorderTabs) return;
    e.preventDefault();
    tabPending.current = { idx, pointerId: e.pointerId, startX: e.clientX };
    tabRowRef.current?.setPointerCapture(e.pointerId);
  };

  const handleTabPointerMove = (e) => {
    const p = tabPending.current;
    if (!p && !tabDragging) return;
    if (p && !tabDragging) {
      if (Math.abs(e.clientX - p.startX) < 5) return;
      tabDragIdxRef.current = p.idx;
      tabOverIdxRef.current = p.idx;
      setTabDragging(true);
      tabPending.current = null;
    }
    if (tabDragIdxRef.current != null) {
      const newOver = calcTabOver(e.clientX);
      if (newOver !== tabOverIdxRef.current) {
        const snap = {};
        Object.entries(tabElemsRef.current).forEach(([nid, el]) => {
          if (el) snap[nid] = el.getBoundingClientRect().left;
        });
        pendingFlipSnap.current = snap;
      }
      tabOverIdxRef.current = newOver;
      tabBump(n => n + 1);
    }
  };

  const handleTabPointerUp = () => {
    const wasPending = tabPending.current;
    const wasDragging = tabDragIdxRef.current != null;
    const dragFrom = tabDragIdxRef.current;
    const dragTo = tabOverIdxRef.current;

    if (wasPending?.pointerId != null) {
      try { tabRowRef.current?.releasePointerCapture(wasPending.pointerId); } catch {}
    }

    if (wasDragging && dragFrom != null && dragTo != null && dragFrom !== dragTo) {
      const ids = sortedNotes.map(n => n.id);
      const [moved] = ids.splice(dragFrom, 1);
      ids.splice(dragTo, 0, moved);
      saveNoteOrder(ids);
    }

    if (wasPending && !wasDragging) {
      selectNote(sortedNotes[wasPending.idx]?.id);
    }

    tabPending.current = null;
    tabDragIdxRef.current = null;
    tabOverIdxRef.current = null;
    setTabDragging(false);
  };

  // Visual tab order during drag
  const dragFrom = tabDragIdxRef.current;
  const dragTo = tabOverIdxRef.current;
  let displayNotes = sortedNotes;
  if (tabDragging && dragFrom != null && dragTo != null && dragFrom !== dragTo) {
    displayNotes = [...sortedNotes];
    const [moved] = displayNotes.splice(dragFrom, 1);
    displayNotes.splice(dragTo, 0, moved);
  }

  // FLIP animation after reorder
  useLayoutEffect(() => {
    const snap = pendingFlipSnap.current;
    if (!snap) return;
    pendingFlipSnap.current = null;
    Object.entries(tabElemsRef.current).forEach(([id, el]) => {
      if (!el || snap[id] == null) return;
      const newX = el.getBoundingClientRect().left;
      const delta = snap[id] - newX;
      if (Math.abs(delta) < 1) return;
      el.style.transition = 'none';
      el.style.transform = `translateX(${delta}px)`;
      el.offsetHeight;
      el.style.transition = 'transform 0.22s cubic-bezier(0.4,0,0.2,1)';
      el.style.transform = 'translateX(0)';
      const cleanup = () => { el.style.transition = ''; el.style.transform = ''; };
      el.addEventListener('transitionend', cleanup, { once: true });
    });
  });

  const skipPhantomBlur = useRef(false);

  const addNote = useCallback(async (initialName = '', { silent = false, initialContent } = {}) => {
    const content = initialContent || initialName || '';
    const res = await api.post('/api/notes', { content, origin_project: effectiveProject === '__everything__' ? null : effectiveProject }, token);
    if (res?.note) {
      setNotesList(prev => [res.note, ...prev]);
      if (!silent) setActiveNoteId(res.note.id);
    }
  }, [effectiveProject, token]);

  const selectNote = (id) => {
    setActiveNoteId(id);
    if (notesSortRecent && sortedNotes[0]?.id !== id) {
      const snap = {};
      Object.entries(tabElemsRef.current).forEach(([nid, el]) => {
        if (el) snap[nid] = el.getBoundingClientRect().left;
      });
      pendingFlipSnap.current = snap;
      setRecentPinnedId(id);
    }
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
  }, [notesList, addNote]); // eslint-disable-line

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
    await api.delete(`/api/notes?id=${id}`, token);
  };

  const noteImages = useMemo(() => extractImages(activeNote?.content), [activeNote?.content]);

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

  const [notesCollapsed, toggleNotes] = useCollapse(`pv:${effectiveProject}:journal`, false);

  const noteNamesForContext = allNoteNames;

  return (
    <NoteContext.Provider value={{ notes: noteNamesForContext, onCreateNote: (name, opts) => addNote(name, opts) }}>

      {/* Notes card */}
      <Card
        label="Notes"
        color={"var(--dl-highlight)"}
        collapsed={notesCollapsed}
        onToggle={toggleNotes}
        headerRight={
          <button
            onClick={e => { e.stopPropagation(); toggleNotesSort(); }}
            title={notesSortRecent ? "Sort: recent" : "Sort: manual order"}
            style={{ background:'none', border:'none', cursor:'pointer', padding:'2px 8px', color:"var(--dl-middle)", display:'flex', alignItems:'center', borderRadius:4, transition:'color 0.12s' }}
            onMouseEnter={e => e.currentTarget.style.color="var(--dl-strong)"}
            onMouseLeave={e => e.currentTarget.style.color="var(--dl-middle)"}
          >
            {notesSortRecent ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="9" y2="18"/>
              </svg>
            )}
          </button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 220 }}>
          {/* Tab row: draggable note tabs with pinned + button */}
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <div
              ref={tabRowRef}
              onPointerMove={handleTabPointerMove}
              onPointerUp={handleTabPointerUp}
              onPointerCancel={handleTabPointerUp}
              style={{
                display: 'flex', gap: 2, overflowX: tabDragging ? 'hidden' : 'auto', overflowY: 'hidden',
                paddingBottom: 8, paddingRight: 40,
                borderBottom: '1px solid var(--dl-border)',
                scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch',
                touchAction: canReorderTabs ? 'none' : 'auto',
              }}
            >
              {sortedNotes.length === 0 && (
                <button onClick={() => { skipPhantomBlur.current = true; addNote(); }}
                  style={{
                    background: 'var(--dl-border-15, rgba(128,120,100,0.1))', border: 'none',
                    borderRadius: 100, padding: '5px 14px', cursor: 'text',
                    fontFamily: mono, fontSize: F.sm, letterSpacing: '0.08em',
                    textTransform: 'uppercase', color: "var(--dl-middle)",
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}>Untitled</button>
              )}
              {displayNotes.map((note, idx) => {
                const active = note.id === activeNoteId;
                const isDragged = tabDragging && sortedNotes[tabDragIdxRef.current]?.id === note.id;
                return (
                  <button
                    key={note.id}
                    ref={el => {
                      if (el) tabItemWidths.current[idx] = el.offsetWidth + 2;
                      tabElemsRef.current[note.id] = el;
                    }}
                    onPointerDown={e => handleTabPointerDown(e, idx)}
                    onClick={() => { if (!canReorderTabs) selectNote(note.id); }}
                    style={{
                      background: active ? 'var(--dl-glass-active, var(--dl-accent-13))' : 'transparent',
                      border: 'none', borderRadius: 100,
                      padding: '5px 12px', cursor: canReorderTabs ? 'grab' : 'pointer', flexShrink: 0,
                      fontFamily: mono, fontSize: F.sm, letterSpacing: '0.08em',
                      textTransform: 'uppercase', whiteSpace: 'nowrap',
                      color: active ? "var(--dl-strong)" : "var(--dl-middle)",
                      opacity: isDragged ? 0.4 : 1,
                      transition: 'color 0.15s, opacity 0.15s, background 0.15s',
                      maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis',
                    }}
                    onMouseEnter={e => { if (!active && !tabDragging) e.currentTarget.style.color = "var(--dl-strong)"; }}
                    onMouseLeave={e => { if (!active && !tabDragging) e.currentTarget.style.color = "var(--dl-middle)"; }}
                  >{noteName(note)}</button>
                );
              })}
            </div>
            {/* Vignette fade + pinned add button */}
            <div style={{
              position: 'absolute', right: 0, top: 0, bottom: 8,
              display: 'flex', alignItems: 'center',
              paddingLeft: 24,
              background: 'linear-gradient(to right, transparent, var(--dl-card) 40%)',
            }}>
              <button
                onClick={() => { skipPhantomBlur.current = true; addNote(); }}
                title="New note"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--dl-middle)', display: 'flex', alignItems: 'center',
                  padding: '4px 6px', borderRadius: 100, transition: 'color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = "var(--dl-strong)"}
                onMouseLeave={e => e.currentTarget.style.color = "var(--dl-middle)"}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Editor + photos */}
          <div
            style={{ flex: 1, minWidth: 0, position: 'relative' }}
            onDragEnter={handleNoteDragEnter}
            onDragLeave={handleNoteDragLeave}
            onDragOver={handleNoteDragOver}
            onDrop={handleNoteDrop}
          >
            {/* Delete note button */}
            {activeNote && (
              <button
                onClick={() => setDeleteConfirm({ id: activeNote.id, name: noteName(activeNote) })}
                title="Delete note"
                style={{
                  position: 'absolute', top: 4, right: 4, zIndex: 2,
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
            )}
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
                ref={noteEditorRef}
                key={activeNote.id}
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
                onBlur={html => {
                  if (skipPhantomBlur.current) { skipPhantomBlur.current = false; return; }
                  const text = html?.replace(/<[^>]*>/g, '').trim();
                  if (text && text !== 'Untitled') { skipPhantomBlur.current = true; addNote('', { initialContent: html }); }
                }}
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

      {/* Delete note confirmation dialog */}
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
