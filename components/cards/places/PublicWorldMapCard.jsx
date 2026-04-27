"use client";
// Read-only WorldMap for the public profile page.
// Mirrors the dashboard WorldMapCard's full UX (mode toggle + bottom strip +
// two-step click → detail) but reuses the dashboard components in `readOnly`
// mode so visuals + interactions match exactly.
//
// What's different vs the dashboard:
//   - No double-click on map to add places / stops
//   - No "+ new trip" tile, no "+ new place" tile
//   - No is_public toggles in collection cards (we never pass onTogglePublic)
//   - StopCard / TripHeader run in `readOnly` mode
import { useEffect, useRef, useState, useMemo } from "react";
import { mono } from "@/lib/tokens";
import { useTheme } from "@/lib/theme";
import { resolveTripSegments, MODE_STYLE } from "@/lib/routing";
import CollectionScroller from "./CollectionScroller.jsx";
import TripScroller from "../trip/TripScroller.jsx";
import TripStopsRow from "../trip/TripStopsRow.jsx";
import TripHeader from "../trip/TripHeader.jsx";
import { MapSearch } from "../WorldMapCard.jsx";

const MAP_TILES_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const MAP_TILES_DARK  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

export default function PublicWorldMapCard({ places = [], collections = [], trips = [], tags = [] }) {
  const containerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const layerRef = useRef([]);
  const LRef = useRef(null);
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const todayStr = new Date().toISOString().slice(0, 10);

  // ── Mode + selection state (mirrors dashboard's `mode` / `inDetail`) ────
  // Default to whichever mode has more content. Both visible iff both > 0.
  const [mode, setMode] = useState(() => {
    const placesCount = places.length;
    const tripsCount = trips.length;
    if (placesCount === 0 && tripsCount > 0) return 'trip';
    if (tripsCount > placesCount) return 'trip';
    return 'places';
  });
  // Places mode
  const [activeTag, setActiveTag] = useState(null);              // null = no tag filter; string = tag name
  const [activeCollection, setActiveCollection] = useState(null); // null = ALL; string = collection name
  const [placesInDetail, setPlacesInDetail] = useState(false);
  const [selectedPlaceId, setSelectedPlaceId] = useState(null);
  // Trip mode
  const [previewedTripId, setPreviewedTripId] = useState(null);
  const [tripInDetail, setTripInDetail] = useState(false);

  // ── Init Leaflet once ────────────────────────────────────────────────────
  const [leafletReady, setLeafletReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const Lmod = await import('leaflet');
      await import('leaflet/dist/leaflet.css');
      if (cancelled) return;
      const L = Lmod.default || Lmod;
      LRef.current = L;
      if (!containerRef.current || mapInstanceRef.current) { setLeafletReady(true); return; }
      const map = L.map(containerRef.current, {
        // Match the dashboard WorldMapCard — hide Leaflet's default zoom buttons
        // (mouse-wheel + pinch zoom still work). Keeps the chrome clean.
        zoomControl: false, attributionControl: false, worldCopyJump: true,
      }).setView([20, 0], 2);
      L.tileLayer(dark ? MAP_TILES_DARK : MAP_TILES_LIGHT, { maxZoom: 19 }).addTo(map);
      mapInstanceRef.current = map;
      setLeafletReady(true);
    })();
    return () => {
      cancelled = true;
      try { mapInstanceRef.current?.remove(); } catch {}
      mapInstanceRef.current = null;
    };
  }, []); // eslint-disable-line

  // Place IDs that belong to the currently-selected collection (null = no
  // collection selected; show all public places).
  const placesInSelectedCollection = useMemo(() => {
    if (!activeCollection) return null;
    const found = collections.find(c => c.name === activeCollection);
    return found ? new Set(found.place_ids || []) : new Set();
  }, [activeCollection, collections]);

  // ── Visible places (filtered by tag + collection) ───────────────────────
  const visiblePlaces = useMemo(() => {
    let out = places;
    if (activeTag) out = out.filter(p => (p.category || '').toLowerCase() === activeTag.toLowerCase());
    if (placesInSelectedCollection) out = out.filter(p => placesInSelectedCollection.has(p.id));
    return out;
  }, [places, activeTag, placesInSelectedCollection]);

  const previewedTrip = useMemo(
    () => trips.find(t => t.id === previewedTripId) || null,
    [trips, previewedTripId]
  );

  // ── Layer rendering ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!leafletReady || !mapInstanceRef.current) return;
    const L = LRef.current;
    const map = mapInstanceRef.current;
    layerRef.current.forEach(l => { try { l.remove(); } catch {} });
    layerRef.current = [];

    if (mode === 'places') {
      // Pin colour comes from the place's TAG (place type), not its collection.
      const colorOf = (cat) => tags.find(t => t.name?.toLowerCase() === (cat || '').toLowerCase())?.color || '#D08828';
      const coords = [];
      for (const p of visiblePlaces) {
        if (p.lat == null || p.lng == null) continue;
        const color = p.color || colorOf(p.category);
        const isSel = selectedPlaceId === p.id;
        const size = isSel ? 16 : 12;
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${isSel ? 3 : 2}px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>`,
          iconSize: [size + 4, size + 4], iconAnchor: [(size + 4) / 2, (size + 4) / 2],
        });
        const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);
        if (p.name) marker.bindTooltip(p.name, { className: 'daylab-tooltip', direction: 'top', offset: [0, -10] });
        // Soft-select: highlight + scroll carousel to it, but DON'T zoom in.
        // Aggressive zoom on every pin click was disorienting; pan-only feels
        // closer to the dashboard's "select" affordance.
        marker.on('click', () => setSelectedPlaceId(p.id));
        layerRef.current.push(marker);
        coords.push([p.lat, p.lng]);
      }
      // Fit bounds to whatever is currently visible. Don't auto-zoom on
      // individual pin selection (that flow lives on the dashboard).
      if (coords.length >= 2) {
        map.fitBounds(L.latLngBounds(coords).pad(0.2));
      } else if (coords.length === 1) {
        map.setView(coords[0], Math.max(map.getZoom(), 10));
      }
    } else if (mode === 'trip') {
      // Each trip's polyline is fetched async via resolveTripSegments — same
      // routing engine the dashboard uses, so segments follow real roads/paths
      // and respect each leg's mode (walk / bike / transit / drive).
      const allCoords = [];
      const cancelMarkers = []; // track per-render cancellation flags
      for (const t of trips) {
        const stops = (t.stops || []).filter(s => s.lat != null && s.lng != null);
        if (stops.length === 0) continue;
        const isFocus = t.id === previewedTripId;
        // Numbered stop badges for the focused trip (mirror dashboard).
        if (isFocus) {
          stops.forEach((s, i) => {
            const html = `<div style="
              width:18px;height:18px;border-radius:50%;background:#5BA89D;color:#fff;
              font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;font-weight:700;
              display:flex;align-items:center;justify-content:center;
              border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);
            ">${i + 1}</div>`;
            const icon = L.divIcon({ className: '', html, iconSize: [22, 22], iconAnchor: [11, 11] });
            const m = L.marker([s.lat, s.lng], { icon, interactive: false }).addTo(map);
            layerRef.current.push(m);
          });
        }
        // Async route resolution — segments arrive shaped to mode, drawn with
        // MODE_STYLE. Faint orange placeholder until segments resolve so the
        // user has a visual cue where the trip lives on the map.
        const flag = { cancelled: false };
        cancelMarkers.push(flag);
        const placeholderLatLngs = stops.map(s => [s.lat, s.lng]);
        const placeholder = L.polyline(placeholderLatLngs, {
          color: dark ? '#D08828' : '#B87018',
          weight: isFocus ? 2.5 : 1.5,
          opacity: isFocus ? 0.5 : 0.25,
          dashArray: '4,4',
        }).addTo(map);
        layerRef.current.push(placeholder);
        resolveTripSegments(stops, 'walk').then(segments => {
          if (flag.cancelled) return;
          try { placeholder.remove(); } catch {}
          (segments || []).forEach(seg => {
            if (!seg?.coordinates?.length) return;
            const latlngs = seg.coordinates.map(([lng, lat]) => [lat, lng]);
            const style = MODE_STYLE[seg.mode] || MODE_STYLE.walk;
            const poly = L.polyline(latlngs, {
              ...style,
              weight: isFocus ? (style.weight + 1) : (style.weight - 0.5),
              opacity: isFocus ? 0.9 : 0.45,
              interactive: false,
            }).addTo(map);
            layerRef.current.push(poly);
          });
        }).catch(() => {});
        allCoords.push(...stops.map(s => [s.lat, s.lng]));
      }
      // Cancel pending segment renders if this effect re-runs.
      const teardownPrev = layerRef.current._cancelMarkers;
      if (teardownPrev) teardownPrev.forEach(f => { f.cancelled = true; });
      layerRef.current._cancelMarkers = cancelMarkers;
      const focusCoords = previewedTripId
        ? (previewedTrip?.stops || []).filter(s => s.lat != null).map(s => [s.lat, s.lng])
        : allCoords;
      if (focusCoords.length >= 2) map.fitBounds(L.latLngBounds(focusCoords).pad(0.2));
      else if (focusCoords.length === 1) map.setView(focusCoords[0], 10);
    }
  }, [mode, visiblePlaces, collections, tags, trips, previewedTripId, tripInDetail, previewedTrip, selectedPlaceId, leafletReady, dark]);

  // Reset cross-mode state on mode switch.
  useEffect(() => {
    if (mode !== 'places') { setPlacesInDetail(false); setSelectedPlaceId(null); }
    if (mode !== 'trip')   setTripInDetail(false);
  }, [mode]);

  // Each collection's place count comes from its membership join (already in
  // c.place_ids from the public API).
  const scrollerCollections = useMemo(() => collections.map(c => ({
    id: c.id, name: c.name, color: c.color || 'var(--dl-accent)', is_public: !!c.is_public,
    count: c.place_count || (c.place_ids?.length || 0),
  })), [collections]);

  return (
    <div style={{
      position: 'relative', width: '100%', height: 480,
      borderRadius: 10, overflow: 'hidden', background: '#0d1a24',
    }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Tag pills (top-left) — same as dashboard. Only in places mode and not detail. */}
      {mode === 'places' && !placesInDetail && tags.length > 0 && (
        <div style={{
          position: 'absolute', top: 50, left: 10, right: 10, zIndex: 999,
          display: 'flex', gap: 4, flexWrap: 'wrap',
        }}>
          <button onClick={() => setActiveTag(null)}
            style={{
              backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
              background: !activeTag ? 'var(--dl-accent-20)' : 'var(--dl-glass)',
              border: `1px solid ${!activeTag ? 'var(--dl-accent)' : 'var(--dl-glass-border)'}`,
              borderRadius: 100, padding: '3px 10px', cursor: 'pointer',
              fontFamily: mono, fontSize: 10, letterSpacing: '0.06em',
              color: !activeTag ? 'var(--dl-accent)' : 'var(--dl-middle)',
              textTransform: 'uppercase',
            }}>All</button>
          {tags.map(t => (
            <button key={t.id} onClick={() => setActiveTag(activeTag === t.name ? null : t.name)}
              style={{
                backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
                background: activeTag === t.name ? t.color + '33' : 'var(--dl-glass)',
                border: `1px solid ${activeTag === t.name ? t.color : 'var(--dl-glass-border)'}`,
                borderRadius: 100, padding: '3px 10px', cursor: 'pointer',
                fontFamily: mono, fontSize: 10, letterSpacing: '0.06em',
                color: activeTag === t.name ? t.color : 'var(--dl-middle)',
                textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4,
              }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
              {t.name}
            </button>
          ))}
        </div>
      )}

      {/* Search — top-LEFT, circle by default, expands on click. Identical
          shape to the dashboard. Mirrors the same Photon + Nominatim search
          but only over `places` (the user's public set). */}
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 1000 }}>
        <MapSearch
          places={places}
          onSelect={(p) => {
            setSelectedPlaceId(p.id);
            if (p.lat != null && p.lng != null) mapInstanceRef.current?.setView([p.lat, p.lng], 14);
          }}
          onGeoSelect={(r) => {
            if (r.lat != null && r.lng != null) mapInstanceRef.current?.setView([r.lat, r.lng], 14);
          }}
          isDark={dark}
          mapInstance={mapInstanceRef}
          compact
        />
      </div>

      {/* Mode toggle — top-RIGHT, icon-only, identical to dashboard. */}
      {(places.length > 0 || trips.length > 0) && (
        <div style={{
          position: 'absolute', top: 10, right: 10, zIndex: 999,
          display: 'flex', gap: 1,
          backdropFilter: 'blur(20px) saturate(1.4)', WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
          background: 'var(--dl-glass)', border: '1px solid var(--dl-glass-border)',
          borderRadius: 100, padding: 3, boxShadow: 'var(--dl-glass-shadow)',
        }}>
          {places.length > 0 && (
            <button onClick={() => setMode('places')}
              title="Places"
              style={{
                background: mode === 'places' ? 'var(--dl-accent-15)' : 'none',
                border: 'none', borderRadius: 100, padding: '5px 8px', cursor: 'pointer',
                color: mode === 'places' ? 'var(--dl-accent)' : 'var(--dl-middle)',
                display: 'flex', alignItems: 'center', transition: 'all 0.15s',
              }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
            </button>
          )}
          {trips.length > 0 && (
            <button onClick={() => setMode('trip')}
              title="Trips"
              style={{
                background: mode === 'trip' ? 'var(--dl-accent-15)' : 'none',
                border: 'none', borderRadius: 100, padding: '5px 8px', cursor: 'pointer',
                color: mode === 'trip' ? 'var(--dl-accent)' : 'var(--dl-middle)',
                display: 'flex', alignItems: 'center', transition: 'all 0.15s',
              }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="5" cy="18" r="2" />
                <circle cx="19" cy="6" r="2" />
                <path d="M5 16C5 11 14 13 14 8" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Top-left detail header (places-mode detail) */}
      {mode === 'places' && placesInDetail && (
        <div style={{
          position: 'absolute', top: 10, left: 10, zIndex: 999,
          display: 'flex', alignItems: 'center', gap: 6,
          backdropFilter: 'blur(20px) saturate(1.4)', WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
          background: 'var(--dl-glass)', border: '1px solid var(--dl-glass-border)',
          borderRadius: 100, padding: '4px 12px', boxShadow: 'var(--dl-glass-shadow)',
        }}>
          <button
            onClick={() => { setPlacesInDetail(false); setSelectedPlaceId(null); }}
            title="Back to collections"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--dl-middle)', padding: 0, lineHeight: 1, fontSize: 18 }}>‹</button>
          <span style={{
            fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--dl-strong)',
          }}>{activeCollection || 'All places'}</span>
        </div>
      )}

      {/* Top-left trip header (trip-mode detail) */}
      {mode === 'trip' && tripInDetail && previewedTrip && (
        <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 999 }}>
          <TripHeader
            trip={previewedTrip}
            onBack={() => setTripInDetail(false)}
            readOnly
          />
        </div>
      )}

      {/* Bottom strip */}
      <div style={{
        position: 'absolute', bottom: 10, left: 0, right: 0, zIndex: 999,
      }}>
        {/* PLACES MODE */}
        {mode === 'places' && !placesInDetail && scrollerCollections.length > 0 && (
          <CollectionScroller
            collections={scrollerCollections}
            totalCount={places.length}
            selectedCollection={activeCollection}
            onPreview={(key) => { setActiveCollection(key); setSelectedPlaceId(null); }}
            onEnterDetail={(key) => { setActiveCollection(key); setPlacesInDetail(true); }}
            // No onTogglePublic — eye toggle hides itself.
          />
        )}
        {mode === 'places' && placesInDetail && (
          <PublicPlaceCarousel
            places={visiblePlaces}
            selectedPlaceId={selectedPlaceId}
            onSelect={(id) => setSelectedPlaceId(id)}
          />
        )}

        {/* TRIP MODE */}
        {mode === 'trip' && !tripInDetail && trips.length > 0 && (
          <TripScroller
            trips={trips}
            todayStr={todayStr}
            previewedId={previewedTripId}
            onPreview={(id) => setPreviewedTripId(id)}
            onEnterDetail={(id) => { setPreviewedTripId(id); setTripInDetail(true); }}
            onCreate={() => {}}
            readOnly
          />
        )}
        {mode === 'trip' && tripInDetail && previewedTrip && (
          <TripStopsRow
            trip={previewedTrip}
            readOnly
          />
        )}
      </div>
    </div>
  );
}

// Per-place carousel for places-mode detail. Mirrors the dashboard's place
// carousel but read-only (no "+ new place" tile, no edit buttons).
function PublicPlaceCarousel({ places, selectedPlaceId, onSelect }) {
  const scrollRef = useRef(null);
  // Scroll the selected card into view when selection changes (e.g. user
  // clicked a pin on the map).
  useEffect(() => {
    if (!selectedPlaceId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-place-id="${selectedPlaceId}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [selectedPlaceId]);

  return (
    <div ref={scrollRef} style={{
      display: 'flex', gap: 6, padding: '0 10px',
      overflowX: 'auto', overflowY: 'hidden',
      scrollbarWidth: 'none', msOverflowStyle: 'none',
      pointerEvents: 'auto',
    }}>
      {places.map(p => {
        const selected = p.id === selectedPlaceId;
        return (
          <button
            key={p.id}
            data-place-id={p.id}
            onClick={() => onSelect(p.id)}
            style={{
              flexShrink: 0, width: 200, minHeight: 60,
              background: 'var(--dl-glass)',
              backdropFilter: 'blur(20px) saturate(1.4)', WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
              border: selected ? `1.5px solid ${p.color || 'var(--dl-accent)'}` : '1px solid var(--dl-glass-border)',
              borderRadius: 10, padding: 8, boxShadow: 'var(--dl-glass-shadow)',
              cursor: 'pointer', textAlign: 'left',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {p.color && <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />}
              <span style={{
                fontFamily: mono, fontSize: 12, fontWeight: 600,
                color: selected ? (p.color || 'var(--dl-accent)') : 'var(--dl-strong)',
                letterSpacing: '0.02em',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
              }}>{p.name || 'Place'}</span>
            </div>
            {p.notes && (
              <div style={{
                fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>{p.notes}</div>
            )}
          </button>
        );
      })}
    </div>
  );
}
