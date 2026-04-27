"use client";
import React, { useState, useRef, useMemo } from "react";
import { mono, F } from "@/lib/tokens";
import NoteCardItem from "./NoteCardItem.jsx";

const DEFAULT_STATUSES = ['new', 'in progress', 'archived'];
const CARD_RADIUS = 10;
// Fixed column width so the kanban scrolls horizontally on narrow screens
// (iPhone) rather than squishing columns down to unreadable widths.
const COL_W = 240;

// Stable color per status name. Defaults get fixed colors; everything else
// hashes to a small palette so the same name always gets the same color.
const FIXED_COLORS = {
  'new':         '#6BAED6',
  'in progress': '#E8A95B',
  'archived':    'var(--dl-middle)',
};
const PALETTE = ['#6BAED6', '#E8A95B', '#8DB86B', '#C49BC4', '#E07C7C', '#5BA89D', '#D4A85B', '#7B96D4'];
function statusColor(name) {
  const key = (name || '').toLowerCase().trim();
  if (FIXED_COLORS[key]) return FIXED_COLORS[key];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}


function ColumnHeader({ statusKey, color, count, onRename, onAddNote, onDelete, canDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(statusKey);
  const inputRef = useRef(null);

  const startEdit = () => { setDraft(statusKey); setEditing(true); setTimeout(() => inputRef.current?.select(), 0); };
  const commit = () => {
    setEditing(false);
    const next = draft.trim().toLowerCase();
    if (next && next !== statusKey) onRename(next);
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      paddingBottom: 4, gap: 6,
      borderBottom: `2px solid ${typeof color === 'string' && color.startsWith('#') ? color + '44' : 'var(--dl-border)'}`,
    }}>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          autoFocus
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setEditing(false); setDraft(statusKey); }
          }}
          style={{
            flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
            fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
            color, fontWeight: 600, padding: 0,
          }}
        />
      ) : (
        <span
          onClick={startEdit}
          title="Click to rename"
          style={{
            flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
            color, fontWeight: 600, cursor: 'text',
          }}
        >
          {statusKey} <span style={{ fontWeight: 400, opacity: 0.6 }}>({count})</span>
        </span>
      )}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <button
          onClick={onAddNote}
          title="New note in this column"
          style={{ fontFamily: mono, fontSize: 12, color: 'var(--dl-middle)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}
        >+</button>
        {canDelete && (
          <button
            onClick={onDelete}
            title="Remove column (notes keep their status)"
            style={{ fontFamily: mono, fontSize: 11, color: 'var(--dl-middle)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, opacity: 0.6 }}
          >×</button>
        )}
      </div>
    </div>
  );
}

export default function NotesKanban({
  notes,
  noteName,
  effectiveProject,
  projectsMeta,
  setProjectsMeta,
  onSelectNote,
  onAddNote,
  onPatchNote,
  onBulkRenameStatus,
  getMediaPreview,
}) {
  // Per-project status list. Falls back to defaults until user customizes.
  const customList = projectsMeta?.[effectiveProject]?.noteStatuses;
  const baseList = Array.isArray(customList) && customList.length ? customList : DEFAULT_STATUSES;

  // Auto-discover any status values present in current notes that aren't in the
  // configured list (legacy notes, cross-project tags, etc.) so nothing is hidden.
  const columns = useMemo(() => {
    const seen = new Set(baseList);
    const extras = [];
    for (const n of notes) {
      const s = (n.status || 'new').toLowerCase().trim();
      if (!seen.has(s)) { seen.add(s); extras.push(s); }
    }
    return [...baseList, ...extras];
  }, [baseList, notes]);

  const grouped = useMemo(() => {
    const out = {};
    for (const c of columns) out[c] = [];
    for (const n of notes) {
      const s = (n.status || 'new').toLowerCase().trim();
      (out[s] ||= []).push(n);
    }
    return out;
  }, [columns, notes]);

  const showProjects = effectiveProject === '__everything__';

  // Drag state
  const [dragId, setDragId] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

  const persistList = (list) => {
    setProjectsMeta(prev => {
      const next = { ...(prev || {}) };
      next[effectiveProject] = { ...(next[effectiveProject] || {}), noteStatuses: list };
      return next;
    }, { skipHistory: true });
  };

  const onDragStart = (e, id) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragEnd = () => {
    if (dragId && dragOverCol) {
      const note = notes.find(n => n.id === dragId);
      const current = (note?.status || 'new').toLowerCase().trim();
      if (note && current !== dragOverCol) onPatchNote(dragId, { status: dragOverCol });
    }
    setDragId(null);
    setDragOverCol(null);
  };
  const onColDragOver = (e, colKey) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCol(colKey);
  };
  const onColDragLeave = (e, colKey) => {
    if (!e.currentTarget.contains(e.relatedTarget) && dragOverCol === colKey) {
      setDragOverCol(null);
    }
  };

  const renameColumn = (oldKey, newKey) => {
    if (!newKey || newKey === oldKey) return;
    if (columns.includes(newKey)) {
      // Merge: just remove the old column from the list and bulk-update notes.
      const next = baseList.filter(c => c !== oldKey);
      persistList(next);
      onBulkRenameStatus(oldKey, newKey);
      return;
    }
    const next = baseList.map(c => c === oldKey ? newKey : c);
    if (!baseList.includes(oldKey)) next.push(newKey);
    persistList(next);
    onBulkRenameStatus(oldKey, newKey);
  };

  const removeColumn = (key) => {
    if (!baseList.includes(key)) return;
    persistList(baseList.filter(c => c !== key));
  };

  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState('');
  const commitAdd = () => {
    const next = addDraft.trim().toLowerCase();
    setAdding(false);
    setAddDraft('');
    if (!next || columns.includes(next)) return;
    persistList([...baseList, next]);
  };

  return (
    <div style={{
      display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6,
      scrollSnapType: 'x proximity', WebkitOverflowScrolling: 'touch',
      minHeight: 200,
    }} data-no-page-swipe>
      {columns.map(colKey => {
        const items = grouped[colKey] || [];
        const color = statusColor(colKey);
        const isDropTarget = dragId && dragOverCol === colKey;
        const canDelete = baseList.includes(colKey) && items.length === 0;
        return (
          <div
            key={colKey}
            onDragOver={e => onColDragOver(e, colKey)}
            onDragLeave={e => onColDragLeave(e, colKey)}
            onDrop={e => e.preventDefault()}
            style={{
              flex: `0 0 ${COL_W}px`, width: COL_W, minHeight: 100,
              display: 'flex', flexDirection: 'column', gap: 6,
              scrollSnapAlign: 'start',
              background: isDropTarget ? `${typeof color === 'string' && color.startsWith('#') ? color : 'var(--dl-highlight)'}10` : 'transparent',
              borderRadius: CARD_RADIUS, padding: isDropTarget ? 4 : 0,
              transition: 'background 0.15s, padding 0.15s',
            }}
          >
            <ColumnHeader
              statusKey={colKey}
              color={color}
              count={items.length}
              onRename={(next) => renameColumn(colKey, next)}
              onAddNote={() => onAddNote(colKey)}
              onDelete={() => removeColumn(colKey)}
              canDelete={canDelete}
            />
            {items.map(n => (
              <NoteCardItem
                key={n.id}
                note={n}
                noteName={noteName}
                showProjects={showProjects}
                mediaPreview={getMediaPreview?.(n)}
                onClick={() => onSelectNote(n.id)}
                onDragStart={e => onDragStart(e, n.id)}
                onDragEnd={onDragEnd}
                isDragging={dragId === n.id}
              />
            ))}
            {items.length === 0 && (
              <div
                onClick={() => onAddNote(colKey)}
                style={{
                  fontFamily: mono, fontSize: 10, color: 'var(--dl-border2, var(--dl-middle))',
                  letterSpacing: '0.04em', padding: '8px 4px', cursor: 'pointer',
                  borderRadius: 6, textAlign: 'center', opacity: 0.6,
                }}
              >+ note</div>
            )}
          </div>
        );
      })}
      {/* Add-column control */}
      <div style={{ minWidth: 120, flexShrink: 0, display: 'flex', alignItems: 'flex-start', paddingTop: 2 }}>
        {adding ? (
          <input
            autoFocus
            value={addDraft}
            placeholder="status…"
            onChange={e => setAddDraft(e.target.value)}
            onBlur={commitAdd}
            onKeyDown={e => {
              if (e.key === 'Enter') commitAdd();
              if (e.key === 'Escape') { setAdding(false); setAddDraft(''); }
            }}
            style={{
              width: '100%', background: 'transparent', border: '1px dashed var(--dl-border)',
              borderRadius: 6, padding: '4px 8px', outline: 'none',
              fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--dl-strong)',
            }}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            style={{
              fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--dl-middle)', background: 'none', border: 'none', cursor: 'pointer',
              padding: '4px 0', transition: 'color 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--dl-strong)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--dl-middle)'}
          >+ status</button>
        )}
      </div>
    </div>
  );
}
