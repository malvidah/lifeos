"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { mono, serif, F } from "@/lib/tokens";
import { api } from "@/lib/api";
import { Card } from "../ui/primitives.jsx";

// ── PhotosCard ───────────────────────────────────────────────────────────────
// Shows Google Photos for the selected date in a responsive grid.
// Click a photo to open a swipeable slideshow. Card hides when no photos.

export default function PhotosCard({ date, token }) {
  const [photos, setPhotos] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [viewIdx, setViewIdx] = useState(null); // null = grid, number = slideshow

  useEffect(() => {
    if (!token || !date) { setPhotos([]); setLoaded(true); return; }
    setLoaded(false);
    api.get(`/api/photos?date=${date}`, token)
      .then(d => {
        if (d?.error) console.warn('[PhotosCard] API error:', d.error);
        setPhotos(d?.photos || []);
        setLoaded(true);
      })
      .catch(e => { console.warn('[PhotosCard] fetch failed:', e); setPhotos([]); setLoaded(true); });
  }, [date, token]);

  // Reset slideshow when date changes
  useEffect(() => { setViewIdx(null); }, [date]);

  // Don't render anything if no photos
  if (loaded && photos.length === 0) return null;
  if (!loaded) return null; // don't flash empty card while loading

  return (
    <Card label="Photos" color="var(--dl-highlight)" autoHeight>
      {viewIdx != null ? (
        <Slideshow photos={photos} index={viewIdx} onClose={() => setViewIdx(null)} />
      ) : (
        <PhotoGrid photos={photos} onSelect={i => setViewIdx(i)} />
      )}
    </Card>
  );
}

// ── Photo Grid ────────────────────────────────────────────────────────────────
function PhotoGrid({ photos, onSelect }) {
  // Responsive: 3 columns on wide, 2 on narrow
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
      gap: 4,
      padding: '2px 0',
    }}>
      {photos.map((p, i) => (
        <button
          key={p.id}
          onClick={() => onSelect(i)}
          style={{
            background: 'var(--dl-well)',
            border: 'none',
            borderRadius: 8,
            overflow: 'hidden',
            cursor: 'pointer',
            aspectRatio: '1',
            padding: 0,
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >
          <img
            src={`${p.baseUrl}=w300-h300-c`}
            alt={p.filename || ''}
            loading="lazy"
            style={{
              width: '100%', height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        </button>
      ))}
    </div>
  );
}

// ── Slideshow ─────────────────────────────────────────────────────────────────
function Slideshow({ photos, index, onClose }) {
  const [idx, setIdx] = useState(index);
  const touchStart = useRef(null);

  const prev = useCallback(() => setIdx(i => (i - 1 + photos.length) % photos.length), [photos.length]);
  const next = useCallback(() => setIdx(i => (i + 1) % photos.length), [photos.length]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [prev, next, onClose]);

  const photo = photos[idx];
  if (!photo) return null;

  // Full-size URL — constrain to viewport-reasonable size
  const imgUrl = `${photo.baseUrl}=w1200-h900`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
      {/* Image container */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          borderRadius: 10,
          overflow: 'hidden',
          background: 'var(--dl-well)',
          cursor: 'pointer',
        }}
        // Swipe support
        onTouchStart={e => { touchStart.current = e.touches[0].clientX; }}
        onTouchEnd={e => {
          if (touchStart.current == null) return;
          const diff = e.changedTouches[0].clientX - touchStart.current;
          if (Math.abs(diff) > 50) { diff > 0 ? prev() : next(); }
          touchStart.current = null;
        }}
        onClick={next}
      >
        <img
          src={imgUrl}
          alt={photo.filename || ''}
          style={{
            width: '100%',
            maxHeight: 420,
            objectFit: 'contain',
            display: 'block',
          }}
        />
      </div>

      {/* Controls row */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 4px',
      }}>
        {/* Counter */}
        <span style={{
          fontFamily: mono, fontSize: F.sm, color: 'var(--dl-middle)',
          letterSpacing: '0.06em',
        }}>
          {idx + 1} / {photos.length}
        </span>

        {/* Nav buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          {photos.length > 1 && (
            <>
              <NavBtn onClick={prev}>‹</NavBtn>
              <NavBtn onClick={next}>›</NavBtn>
            </>
          )}
          <NavBtn onClick={onClose}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </NavBtn>
        </div>
      </div>
    </div>
  );
}

function NavBtn({ onClick, children }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      style={{
        background: 'var(--dl-glass-active)', border: 'none', borderRadius: 100,
        width: 28, height: 28, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--dl-strong)', fontFamily: mono, fontSize: 14,
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--dl-border2)'}
      onMouseLeave={e => e.currentTarget.style.background = 'var(--dl-glass-active)'}
    >
      {children}
    </button>
  );
}
