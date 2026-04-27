"use client";
// Read-only NotesCard for the public profile.
// Mirrors the dashboard NotesCard's shape (header mode toggle + grid/kanban
// body + click-to-detail) but strips every write affordance:
//   - no "+ note" tile, no drag-reorder, no kanban status toggles
//   - detail view is HTML-rendered (no editor), no inline title editing
import { useState, useMemo } from "react";
import { Card } from "../ui/primitives.jsx";
import NotesGrid from "./NotesGrid.jsx";
import NotesKanban from "./NotesKanban.jsx";
import { firstMediaForNote } from "./NoteCardItem.jsx";
import {
  extractImages, extractPlaceTags, MediaStrip, MediaSlideshow,
} from "./JournalEditor.jsx";
import { mono, F, serif, projectColor } from "@/lib/tokens";
import { useTheme } from "@/lib/theme";

// ── Helpers ─────────────────────────────────────────────────────────────────
function noteName(note) {
  const c = note?.content || '';
  if (c.startsWith('<')) {
    const m = c.match(/<h1[^>]*>(.*?)<\/h1>/s);
    return m ? m[1].replace(/<[^>]+>/g, '').trim() || 'Untitled' : 'Untitled';
  }
  return c.split('\n')[0].trim() || 'Untitled';
}

// Sanitize note HTML for display (mirrors share/[token] page).
function sanitizeHtml(html) {
  if (!html) return '';
  let s = html;
  // Strip image chips / image-blocks (rendered separately in MediaStrip).
  s = s.replace(/<span[^>]*data-image-chip="[^"]*"[^>]*>[\s\S]*?<\/span>/g, '');
  s = s.replace(/<div[^>]*data-imageblock="[^"]*"[^>]*>[\s\S]*?<\/div>/g, '');
  // Remove the H1 (we render the title separately above the body).
  s = s.replace(/<h1[^>]*>[\s\S]*?<\/h1>/, '');
  // Strip inline styles + arbitrary data-* (keep project-tag + note-link + trip-tag).
  s = s.replace(/ style="[^"]*"/g, '');
  s = s.replace(/ data-(?!project-tag|note-link|trip-tag|place-tag|drawing-tag)[a-z-]+="[^"]*"/g, '');
  // Replace project tags with styled chip.
  s = s.replace(/<span[^>]*data-project-tag="([^"]*)"[^>]*>[^<]*<\/span>/g, (_, name) => {
    const col = projectColor(name);
    return `<span class="dl-public-chip" style="color:${col};background:${col}22">${name}</span>`;
  });
  // Trip / place / note chips → muted accented chip.
  s = s.replace(/<span[^>]*data-trip-tag="([^"]*)"[^>]*>[^<]*<\/span>/g,
    '<span class="dl-public-chip" style="color:#5BA89D;background:#5BA89D22">🗺️ $1</span>');
  s = s.replace(/<span[^>]*data-place-tag="([^"]*)"[^>]*>[^<]*<\/span>/g,
    '<span class="dl-public-chip" style="color:#E8A95B;background:#E8A95B22">📍 $1</span>');
  s = s.replace(/<span[^>]*data-note-link="([^"]*)"[^>]*>[^<]*<\/span>/g,
    '<span class="dl-public-chip" style="color:var(--dl-accent);background:var(--dl-accent-10, rgba(208,136,40,0.12))">$1</span>');
  s = s.replace(/&nbsp;/g, ' ');
  return s;
}

// ── Mode toggle (manual / recent / kanban) ──────────────────────────────────
function ViewModeToggle({ mode, setMode }) {
  const modes = [
    { key: 'manual', label: 'Manual',
      icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="9" y2="18"/></svg> },
    { key: 'recent', label: 'Recent',
      icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
    { key: 'kanban', label: 'Kanban',
      icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1" y="1.5" width="3.5" height="13" rx="1"/><rect x="6.25" y="1.5" width="3.5" height="8.5" rx="1"/><rect x="11.5" y="1.5" width="3.5" height="10.5" rx="1"/></svg> },
  ];
  return (
    <div style={{ display: 'flex', gap: 2, background: 'var(--dl-border-15, rgba(128,120,100,0.1))', borderRadius: 100, padding: 2 }} onClick={e => e.stopPropagation()}>
      {modes.map(m => {
        const active = mode === m.key;
        return (
          <button key={m.key} onClick={() => setMode(m.key)}
            aria-label={m.label} aria-pressed={active}
            style={{
              padding: '4px 8px', borderRadius: 100, cursor: 'pointer', border: 'none',
              display: 'flex', alignItems: 'center',
              background: active ? 'var(--dl-glass-active, var(--dl-accent-13))' : 'transparent',
              color: active ? 'var(--dl-strong)' : 'var(--dl-middle)',
              transition: 'all 0.15s',
            }}>
            {m.icon}
          </button>
        );
      })}
    </div>
  );
}

// ── Detail view (read-only) ──────────────────────────────────────────────────
function PublicNoteDetail({ note, trips, places, onBack }) {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const [mediaIdx, setMediaIdx] = useState(null);

  // Build media items the same way NotesCard does, but only with public-available
  // sources (photos, place tags → public places, /tr tag → public trip).
  const allMedia = useMemo(() => {
    const items = [];
    const html = note?.content || '';
    extractImages(html).forEach(url => items.push({ type: 'photo', url }));
    const placeTagNames = extractPlaceTags(html);
    const placeMatches = placeTagNames
      .map(n => (places || []).find(p => p.name === n))
      .filter(p => p && p.lat != null && p.lng != null)
      .map(p => ({ name: p.name, lat: p.lat, lng: p.lng, color: p.color }));
    if (placeMatches.length) items.push({ type: 'map', places: placeMatches });
    const tripMatch = html.match(/data-trip-tag="([^"]+)"/);
    if (tripMatch) {
      const trip = (trips || []).find(t => t.name === tripMatch[1]);
      if (trip && (trip.stops?.length || 0) > 0) items.push({ type: 'trip-map', name: trip.name, trip });
    }
    return items;
  }, [note?.content, places, trips]);

  const cleanedHtml = useMemo(() => sanitizeHtml(note?.content || ''), [note?.content]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Inline style for the chips we inject and the public body type. */}
      <style>{`
        .dl-public-chip { display:inline-block; padding:1px 6px; border-radius:999px;
          font-family:${'ui-monospace, SFMono-Regular, Menlo, monospace'}; font-size:0.8em;
          letterSpacing:0.04em; text-transform:uppercase; line-height:1.6; }
        .dl-public-body { font-family:${serif}; font-size:${F.md}; line-height:1.7; color:var(--dl-strong); }
        .dl-public-body p { margin:0 0 0.5em; }
        .dl-public-body a[href] { color:var(--dl-accent); text-decoration:underline; }
        .dl-public-body ul, .dl-public-body ol { margin:0.4em 0 0.4em 1.2em; }
        .dl-public-body h1, .dl-public-body h2, .dl-public-body h3 { font-family:${mono}; font-size:0.9em; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; margin:0.8em 0 0.3em; color:var(--dl-strong); }
        .dl-public-body img { max-width:100%; border-radius:6px; }
      `}</style>

      {/* Back chevron + title row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <button
          onClick={onBack}
          title="Back to notes"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--dl-middle)', fontFamily: mono, fontSize: 18,
            padding: '0 4px 0 0', lineHeight: 1, flexShrink: 0,
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--dl-strong)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--dl-middle)'}
        >‹</button>
        <h1 style={{
          margin: 0,
          fontFamily: mono, fontSize: '0.8em', fontWeight: 400,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          color: 'var(--dl-strong)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {noteName(note)}
        </h1>
      </div>

      {/* Media strip (no reorder — onReorderPhotos undefined disables drag) */}
      {allMedia.length > 0 && (
        mediaIdx != null
          ? <MediaSlideshow mediaItems={allMedia} index={mediaIdx} onClose={() => setMediaIdx(null)} dark={dark} />
          : <MediaStrip mediaItems={allMedia} onViewItem={(i) => setMediaIdx(i)} dark={dark} />
      )}

      {/* Body */}
      <div className="dl-public-body" dangerouslySetInnerHTML={{ __html: cleanedHtml }} />
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
export default function PublicNotesCard({ notes, trips, places }) {
  const [viewMode, setViewMode] = useState('manual'); // 'manual' | 'recent' | 'kanban'
  const [detailId, setDetailId] = useState(null);

  const sortedNotes = useMemo(() => {
    if (viewMode === 'recent') {
      return [...notes].sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    }
    return [...notes];
  }, [notes, viewMode]);

  const activeNote = useMemo(() => notes.find(n => n.id === detailId) || null, [notes, detailId]);
  const getMediaPreview = (n) => firstMediaForNote(n, { trips });

  return (
    <Card
      label="📄 Notes"
      color="var(--dl-highlight)"
      autoHeight
      slim
      headerRight={!detailId && <ViewModeToggle mode={viewMode} setMode={setViewMode} />}
    >
      {detailId && activeNote ? (
        <PublicNoteDetail
          note={activeNote}
          trips={trips}
          places={places}
          onBack={() => setDetailId(null)}
        />
      ) : viewMode === 'kanban' ? (
        <NotesKanban
          notes={notes}
          noteName={noteName}
          effectiveProject="__everything__"
          projectsMeta={{}}
          setProjectsMeta={() => {}}
          onSelectNote={(id) => setDetailId(id)}
          onAddNote={() => {}}
          onPatchNote={() => {}}
          onBulkRenameStatus={() => {}}
          getMediaPreview={getMediaPreview}
        />
      ) : (
        <NotesGrid
          notes={sortedNotes}
          noteName={noteName}
          effectiveProject="__everything__"
          sort={viewMode}
          readOnly
          onSelectNote={(id) => setDetailId(id)}
          getMediaPreview={getMediaPreview}
        />
      )}
    </Card>
  );
}
