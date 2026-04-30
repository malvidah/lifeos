"use client";
import React, { useState, useMemo } from "react";
import { mono } from "@/lib/tokens";
import NoteCardItem from "./NoteCardItem.jsx";

// Notes shown as a responsive card grid. Two modes:
//   - 'recent': sort by updated_at desc, no DnD
//   - 'manual': respects projectsMeta order; HTML5 drag-and-drop reorders cards.
//     The grid is "dense" — flex-wrap with no gaps, so cards reflow to fill rows.
export default function NotesGrid({
  notes,
  noteName,
  effectiveProject,
  sort = 'manual', // 'manual' | 'recent'
  onSelectNote,
  onAddNote,
  onSaveOrder,        // (orderedIds: string[]) => void — only used when sort==='manual'
  getMediaPreview,    // (note) => { type, ... } | null
  readOnly = false,   // public profile: hide "+ note" tile + disable DnD
}) {
  const showProjects = effectiveProject === '__everything__';

  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null); // id we're hovering over
  const [dropEdge, setDropEdge] = useState(null);     // 'before' | 'after'

  const orderedNotes = notes; // already sorted by parent (recent or manual order)

  const onDragStart = (e, id) => {
    if (sort !== 'manual') return;
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragEnd = () => {
    if (sort !== 'manual') { setDragId(null); setDragOverId(null); setDropEdge(null); return; }
    if (dragId && dragOverId && dropEdge && dragId !== dragOverId) {
      const ids = orderedNotes.map(n => n.id);
      const fromIdx = ids.indexOf(dragId);
      const targetIdx = ids.indexOf(dragOverId);
      if (fromIdx !== -1 && targetIdx !== -1) {
        ids.splice(fromIdx, 1);
        const adjustedTarget = ids.indexOf(dragOverId);
        const insertIdx = dropEdge === 'after' ? adjustedTarget + 1 : adjustedTarget;
        ids.splice(insertIdx, 0, dragId);
        onSaveOrder?.(ids);
      }
    }
    setDragId(null);
    setDragOverId(null);
    setDropEdge(null);
  };
  const onCardDragOver = (e, id) => {
    if (sort !== 'manual' || !dragId || dragId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Decide which side based on horizontal mid-point — grid flows L→R then wraps.
    const rect = e.currentTarget.getBoundingClientRect();
    const isAfter = (e.clientX - rect.left) > rect.width / 2;
    setDragOverId(id);
    setDropEdge(isAfter ? 'after' : 'before');
  };
  const onCardDragLeave = (e, id) => {
    if (!e.currentTarget.contains(e.relatedTarget) && dragOverId === id) {
      setDragOverId(null);
      setDropEdge(null);
    }
  };
  const onCardDrop = (e) => { e.preventDefault(); };

  return (
    <div style={{
      display: 'grid',
      gridTemplateRows: 'repeat(3, auto)',
      gridAutoFlow: 'column',
      gridAutoColumns: 200,
      gap: 8,
      overflowX: 'auto',
      overflowY: 'hidden',
      scrollbarWidth: 'none',
      msOverflowStyle: 'none',
      minHeight: 120,
    }}>
      {orderedNotes.map(note => {
        const dropEdgeForCard = (!readOnly && dragOverId === note.id && dragId && dragId !== note.id)
          ? (dropEdge === 'after' ? 'bottom' : 'top')
          : null;
        return (
          <NoteCardItem
            key={note.id}
            note={note}
            noteName={noteName}
            showProjects={showProjects}
            mediaPreview={getMediaPreview?.(note)}
            draggable={!readOnly && sort === 'manual'}
            isDragging={dragId === note.id}
            dropEdge={dropEdgeForCard}
            onClick={() => onSelectNote?.(note.id)}
            onDragStart={readOnly ? undefined : (e => onDragStart(e, note.id))}
            onDragEnd={readOnly ? undefined : onDragEnd}
            onDragOver={readOnly ? undefined : (e => onCardDragOver(e, note.id))}
            onDragLeave={readOnly ? undefined : (e => onCardDragLeave(e, note.id))}
            onDrop={readOnly ? undefined : onCardDrop}
          />
        );
      })}
      {/* "+ note" tile — same footprint as a card so the grid flows uniformly.
          Hidden in read-only mode (public profile view). */}
      {!readOnly && <button
        onClick={() => onAddNote()}
        title="New note"
        style={{
          background: 'transparent',
          border: '1px dashed var(--dl-border)',
          borderRadius: 10,
          padding: '8px 10px',
          cursor: 'pointer',
          color: 'var(--dl-middle)',
          fontFamily: mono, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
          minHeight: 64,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'color 0.15s, border-color 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--dl-strong)'; e.currentTarget.style.borderColor = 'var(--dl-middle)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--dl-middle)'; e.currentTarget.style.borderColor = 'var(--dl-border)'; }}
      >+ note</button>}
    </div>
  );
}
