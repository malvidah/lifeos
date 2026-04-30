"use client";
import React, { useState, useRef, useMemo } from "react";
import { mono, F } from "@/lib/tokens";
import NoteCardItem from "./NoteCardItem.jsx";

const DEFAULT_STATUSES = ['document', 'in progress', 'archived'];
const CARD_RADIUS = 10;
const COL_W = 240;

const FIXED_COLORS = {
  'document':    '#6BAED6',
  'new':         '#6BAED6',
  'in progress': '#E8A95B',
  'archived':    'var(--dl-middle)',
};
const PALETTE = ['#6BAED6', '#E8A95B', '#8DB86B', '#C49BC4', '#E07C7C', '#5BA89D', '#D4A85B', '#7B96D4'];
export function statusColor(name) {
  const key = (name || '').toLowerCase().trim();
  if (FIXED_COLORS[key]) return FIXED_COLORS[key];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}


function ReadOnlyColumnHeader({ statusKey, color, count }) {
  return (
    <div style={{
      paddingBottom: 4, gap: 6,
      borderBottom: `2px solid ${typeof color === 'string' && color.startsWith('#') ? color + '44' : 'var(--dl-border)'}`,
    }}>
      <span style={{
        fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
        color, fontWeight: 600,
      }}>
        {statusKey} <span style={{ fontWeight: 400, opacity: 0.6 }}>({count})</span>
      </span>
    </div>
  );
}

function ColumnHeader({ statusKey, color, count, onRename, onAddNote, onDelete, canDelete, onColDragStart, onColDragEnd, colDraggable }) {
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
      {colDraggable && (
        <span
          draggable
          onDragStart={onColDragStart}
          onDragEnd={onColDragEnd}
          title="Drag to reorder"
          style={{
            cursor: 'grab', color: 'var(--dl-border2, var(--dl-middle))', fontSize: 10,
            lineHeight: 1, flexShrink: 0, userSelect: 'none', padding: '0 2px',
          }}
        >⠿</span>
      )}
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
  readOnly = false,
}) {
  const customList = projectsMeta?.[effectiveProject]?.noteStatuses;
  const baseList = Array.isArray(customList) && customList.length ? customList : DEFAULT_STATUSES;

  const columns = useMemo(() => {
    const seen = new Set(baseList);
    const extras = [];
    for (const n of notes) {
      const s = (n.status || 'document').toLowerCase().trim();
      if (!seen.has(s)) { seen.add(s); extras.push(s); }
    }
    return [...baseList, ...extras];
  }, [baseList, notes]);

  const grouped = useMemo(() => {
    const out = {};
    for (const c of columns) out[c] = [];
    for (const n of notes) {
      const s = (n.status || 'document').toLowerCase().trim();
      (out[s] ||= []).push(n);
    }
    return out;
  }, [columns, notes]);

  const showProjects = effectiveProject === '__everything__';

  // Card drag state (move note between columns)
  const [dragId, setDragId] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

  // Column drag state (reorder columns)
  const [dragColKey, setDragColKey] = useState(null);
  const [dragOverColKey, setDragOverColKey] = useState(null);
  const [colDropEdge, setColDropEdge] = useState(null);

  const persistList = (list) => {
    setProjectsMeta(prev => {
      const next = { ...(prev || {}) };
      next[effectiveProject] = { ...(next[effectiveProject] || {}), noteStatuses: list };
      return next;
    }, { skipHistory: true });
  };

  // ── Card DnD ──
  const onDragStart = (e, id) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'card');
  };
  const onDragEnd = () => {
    if (dragId && dragOverCol) {
      const note = notes.find(n => n.id === dragId);
      const current = (note?.status || 'document').toLowerCase().trim();
      if (note && current !== dragOverCol) onPatchNote(dragId, { status: dragOverCol });
    }
    setDragId(null);
    setDragOverCol(null);
  };
  const onColDragOver = (e, colKey) => {
    if (dragColKey) return; // column drag handled separately
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCol(colKey);
  };
  const onColDragLeave = (e, colKey) => {
    if (!e.currentTarget.contains(e.relatedTarget) && dragOverCol === colKey) {
      setDragOverCol(null);
    }
  };

  // ── Column DnD ──
  const onColumnDragStart = (e, colKey) => {
    setDragColKey(colKey);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'column');
  };
  const onColumnDragEnd = () => {
    if (dragColKey && dragOverColKey && colDropEdge && dragColKey !== dragOverColKey) {
      const list = [...columns];
      const fromIdx = list.indexOf(dragColKey);
      const targetIdx = list.indexOf(dragOverColKey);
      if (fromIdx !== -1 && targetIdx !== -1) {
        list.splice(fromIdx, 1);
        const adjustedTarget = list.indexOf(dragOverColKey);
        const insertIdx = colDropEdge === 'after' ? adjustedTarget + 1 : adjustedTarget;
        list.splice(insertIdx, 0, dragColKey);
        persistList(list);
      }
    }
    setDragColKey(null);
    setDragOverColKey(null);
    setColDropEdge(null);
  };
  const onColumnDragOver = (e, colKey) => {
    if (!dragColKey || dragColKey === colKey) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const isAfter = (e.clientX - rect.left) > rect.width / 2;
    setDragOverColKey(colKey);
    setColDropEdge(isAfter ? 'after' : 'before');
  };
  const onColumnDragLeave = (e, colKey) => {
    if (!e.currentTarget.contains(e.relatedTarget) && dragOverColKey === colKey) {
      setDragOverColKey(null);
      setColDropEdge(null);
    }
  };

  const renameColumn = (oldKey, newKey) => {
    if (!newKey || newKey === oldKey) return;
    if (columns.includes(newKey)) {
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
        const isCardDropTarget = dragId && dragOverCol === colKey;
        const isColDropTarget = dragColKey && dragOverColKey === colKey && dragColKey !== colKey;
        const canDelete = baseList.includes(colKey) && items.length === 0;
        return (
          <div
            key={colKey}
            onDragOver={e => {
              if (dragColKey) { onColumnDragOver(e, colKey); }
              else { onColDragOver(e, colKey); }
            }}
            onDragLeave={e => {
              if (dragColKey) { onColumnDragLeave(e, colKey); }
              else { onColDragLeave(e, colKey); }
            }}
            onDrop={e => e.preventDefault()}
            style={{
              position: 'relative',
              flex: `0 0 ${COL_W}px`, width: COL_W, minHeight: 100,
              display: 'flex', flexDirection: 'column', gap: 6,
              scrollSnapAlign: 'start',
              background: isCardDropTarget ? `${typeof color === 'string' && color.startsWith('#') ? color : 'var(--dl-highlight)'}10` : 'transparent',
              borderRadius: CARD_RADIUS, padding: isCardDropTarget ? 4 : 0,
              transition: 'background 0.15s, padding 0.15s',
              opacity: dragColKey === colKey ? 0.4 : 1,
            }}
          >
            {isColDropTarget && colDropEdge === 'before' && <ColDropIndicator side="left" />}
            {isColDropTarget && colDropEdge === 'after' && <ColDropIndicator side="right" />}
            {readOnly ? (
              <ReadOnlyColumnHeader statusKey={colKey} color={color} count={items.length} />
            ) : (
              <ColumnHeader
                statusKey={colKey}
                color={color}
                count={items.length}
                onRename={(next) => renameColumn(colKey, next)}
                onAddNote={() => onAddNote(colKey)}
                onDelete={() => removeColumn(colKey)}
                canDelete={canDelete}
                colDraggable
                onColDragStart={e => onColumnDragStart(e, colKey)}
                onColDragEnd={onColumnDragEnd}
              />
            )}
            {items.map(n => (
              <NoteCardItem
                key={n.id}
                note={n}
                noteName={noteName}
                showProjects={showProjects}
                mediaPreview={getMediaPreview?.(n)}
                draggable={!readOnly}
                onClick={() => onSelectNote(n.id)}
                onDragStart={readOnly ? undefined : (e => onDragStart(e, n.id))}
                onDragEnd={readOnly ? undefined : onDragEnd}
                isDragging={dragId === n.id}
              />
            ))}
            {!readOnly && items.length === 0 && (
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
      {!readOnly && (
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
      )}
    </div>
  );
}

function ColDropIndicator({ side }) {
  return (
    <div style={{
      position: 'absolute',
      top: 0, bottom: 0,
      [side]: -5,
      width: 2,
      background: 'var(--dl-accent)',
      borderRadius: 2,
      pointerEvents: 'none',
      zIndex: 1,
    }} />
  );
}
