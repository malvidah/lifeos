"use client";
import React, { useState } from "react";
import { mono } from "@/lib/tokens";
import { projectColor } from "@/lib/tokens";
import { extractImages, extractDrawingTags, extractPlaceTags, extractCollectionTags, MiniTripMap } from "./JournalEditor.jsx";

const CARD_RADIUS = 10;

// Pick the first media item that would appear in the note's media strip,
// matching the priority used in NotesCard: photo → drawing → place → trip.
// `drawings` is the global drawings list so we can grab a thumbnail.
// `trips`    is the global trips list so we can attach the trip's stops for
//            the route preview without an extra fetch.
export function firstMediaForNote(note, { drawings = [], trips = [] } = {}) {
  const content = note?.content || '';
  if (!content) return null;

  const imgUrls = extractImages(content);
  if (imgUrls.length) return { type: 'image', url: imgUrls[0] };

  const drawingTitles = extractDrawingTags(content);
  for (const t of drawingTitles) {
    const d = drawings.find(x => x.title === t);
    if (d?.thumbnail) return { type: 'drawing', thumbnail: d.thumbnail, title: t };
    if (d) return { type: 'drawing', title: t }; // drawing exists but no thumb yet
  }

  const placeTags = extractPlaceTags(content);
  if (placeTags.length) return { type: 'place', name: placeTags[0] };

  const tripMatch = content.match(/data-trip-tag="([^"]+)"/);
  if (tripMatch) {
    const tripName = tripMatch[1];
    const trip = trips.find(t => t.name === tripName) || null;
    return { type: 'trip', name: tripName, trip };
  }

  const collectionNames = extractCollectionTags(content);
  if (collectionNames.length) return { type: 'collection', name: collectionNames[0] };

  return null;
}

// Decode HTML entities (&nbsp;, &amp;, etc.) so they don't show as literal
// "&nbsp;" in the card preview. Browser-only; bails on SSR.
function decodeEntities(s) {
  if (!s || typeof document === 'undefined') return s;
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
}

// Strip tags + image chips + image-block divs from HTML and decode entities.
export function previewText(html) {
  if (!html) return '';
  const stripped = html
    .replace(/<h1[^>]*>.*?<\/h1>/gs, '')
    .replace(/<span\s+data-image-chip="[^"]*"[^>]*>[\s\S]*?<\/span>/g, '')
    .replace(/<div\s+data-imageblock="[^"]*"[^>]*>[\s\S]*?<\/div>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return decodeEntities(stripped).slice(0, 140);
}

// First image URL in the note (image chip, imageblock, or [img:] text), or null.
function firstImageUrl(content) {
  const urls = extractImages(content);
  return urls.length ? urls[0] : null;
}

// Banner shown above the title — adapts to whatever first media is available.
function MediaPreview({ preview }) {
  if (!preview) return null;
  if (preview.type === 'image') {
    return (
      <div style={{
        width: '100%', aspectRatio: '16 / 9', background: 'var(--dl-border-15, rgba(128,120,100,0.1))',
        backgroundImage: `url("${preview.url}")`,
        backgroundSize: 'cover', backgroundPosition: 'center',
      }} />
    );
  }
  if (preview.type === 'drawing' && preview.thumbnail) {
    return (
      <div style={{
        width: '100%', aspectRatio: '16 / 9', background: 'var(--dl-card)',
        backgroundImage: `url("${preview.thumbnail}")`,
        backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
      }} />
    );
  }
  // Trip with at least one geocoded stop → real Leaflet mini-map (matches strip).
  if (preview.type === 'trip' && preview.trip) {
    const hasCoords = (preview.trip.stops || []).some(s => s.lat != null && s.lng != null);
    if (hasCoords) {
      return (
        <div
          onClick={e => e.stopPropagation()}
          style={{ width: '100%', aspectRatio: '16 / 9', overflow: 'hidden', background: '#0d1a24', position: 'relative', pointerEvents: 'none' }}
        >
          <MiniTripMap trip={preview.trip} />
        </div>
      );
    }
  }
  // Drawing without thumbnail, place, or trip-without-coords → text/icon banner.
  const meta = preview.type === 'trip'    ? { icon: '🗺️', label: preview.name, tint: '#5BA89D' }
              : preview.type === 'place'  ? { icon: '📍', label: preview.name, tint: '#E8A95B' }
              : preview.type === 'drawing'? { icon: '✎',  label: preview.title, tint: '#C49BC4' }
              : null;
  if (!meta) return null;
  return (
    <div style={{
      width: '100%', aspectRatio: '16 / 9',
      background: `linear-gradient(135deg, ${meta.tint}22, ${meta.tint}08)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      fontFamily: mono, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
      color: meta.tint, padding: '0 10px', textAlign: 'center',
    }}>
      <span style={{ fontSize: 16, lineHeight: 1 }}>{meta.icon}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1 }}>
        {meta.label}
      </span>
    </div>
  );
}

function ProjectPill({ project }) {
  if (!project) return null;
  const col = projectColor(project);
  return (
    <span style={{
      fontFamily: mono, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase',
      color: col, background: col + '22', borderRadius: 999, padding: '1px 7px',
      whiteSpace: 'nowrap', lineHeight: '1.65',
    }}>
      {project}
    </span>
  );
}

// Card UI shared between the kanban view and the grid view.
// Drop targeting (the hairline above/below) is opt-in via dropEdge: 'top' | 'bottom' | null.
export default function NoteCardItem({
  note, noteName, showProjects,
  onClick, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
  draggable = true, isDragging = false, dropEdge = null,
  mediaPreview, // optional precomputed { type, url|thumbnail|name|title }
}) {
  const [hovered, setHovered] = useState(false);
  const preview = previewText(note.content);
  // Fallback to image-only when no precomputed media is supplied (keeps the
  // card useful in any context that doesn't know about drawings/trips/places).
  const effectivePreview = mediaPreview ?? (firstImageUrl(note.content) ? { type: 'image', url: firstImageUrl(note.content) } : null);
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        background: 'var(--dl-card)',
        border: '1px solid var(--dl-border)',
        borderRadius: CARD_RADIUS,
        padding: 0,
        cursor: 'pointer',
        opacity: isDragging ? 0.5 : 1,
        transform: hovered && !isDragging ? 'translateY(-0.5px)' : 'none',
        boxShadow: hovered && !isDragging ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
        transition: 'opacity 0.15s, box-shadow 0.15s, transform 0.1s',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {dropEdge === 'top' && <DropIndicator side="top" />}
      {dropEdge === 'bottom' && <DropIndicator side="bottom" />}
      <MediaPreview preview={effectivePreview} />
      <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{
          fontFamily: mono, fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase',
          color: 'var(--dl-strong)', fontWeight: 500,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          overflow: 'hidden', wordBreak: 'break-word', lineHeight: 1.3,
        }}>
          {noteName(note)}
        </div>
        {preview && (
          <div style={{
            fontFamily: mono, fontSize: 11, color: 'var(--dl-middle)',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden', lineHeight: 1.35,
          }}>
            {preview}
          </div>
        )}
        {showProjects && (note.project_tags || []).length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
            {note.project_tags.slice(0, 3).map(p => <ProjectPill key={p} project={p} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function DropIndicator({ side }) {
  return (
    <div style={{
      position: 'absolute',
      [side]: -3,
      left: 4, right: 4, height: 2,
      background: 'var(--dl-accent)',
      borderRadius: 2,
      pointerEvents: 'none',
    }} />
  );
}
