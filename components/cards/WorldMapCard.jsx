"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { mono, F } from "@/lib/tokens";
import { api } from "@/lib/api";
import { getCachedLocation, DEFAULT_LOCATION } from "@/lib/weather";
import { useTheme } from "@/lib/theme";
import dynamic from "next/dynamic";

// ─── Category config ────────────────────────────────────────────────────────
const CATEGORIES = [
  { id: 'pin',       label: 'Pin',       emoji: '📍' },
  { id: 'cafe',      label: 'Cafe',      emoji: '☕' },
  { id: 'food',      label: 'Food',      emoji: '🍽' },
  { id: 'viewpoint', label: 'Viewpoint', emoji: '👁' },
  { id: 'park',      label: 'Park',      emoji: '🌲' },
  { id: 'shop',      label: 'Shop',      emoji: '🛍' },
  { id: 'home',      label: 'Home',      emoji: '🏠' },
  { id: 'work',      label: 'Work',      emoji: '💼' },
];

function categoryEmoji(cat) {
  return CATEGORIES.find(c => c.id === cat)?.emoji || '📍';
}

// ─── Tile URLs ──────────────────────────────────────────────────────────────
const TILES_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png';
const TILES_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

// ─── Search bar ─────────────────────────────────────────────────────────────
function MapSearch({ places, onSelect, onGeoSelect, isDark }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [geoResults, setGeoResults] = useState([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);
  const inputRef = useRef(null);

  // Filter saved places
  useEffect(() => {
    if (!query.trim()) { setResults([]); setGeoResults([]); return; }
    const q = query.toLowerCase();
    setResults(places.filter(p => p.name.toLowerCase().includes(q)).slice(0, 5));
  }, [query, places]);

  // Geocode via Nominatim (debounced)
  useEffect(() => {
    clearTimeout(timerRef.current);
    if (!query.trim() || query.length < 3) { setGeoResults([]); return; }
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`,
          { headers: { 'User-Agent': 'DayLab/1.0' } }
        );
        if (res.ok) {
          const data = await res.json();
          setGeoResults(data.map(d => ({
            name: d.display_name.split(',').slice(0, 2).join(','),
            fullName: d.display_name,
            lat: parseFloat(d.lat),
            lng: parseFloat(d.lon),
          })));
        }
      } catch {}
    }, 400);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  const hasResults = results.length > 0 || geoResults.length > 0;

  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'var(--dl-bg)', borderRadius: 8,
        border: '1px solid var(--dl-border)',
        padding: '4px 8px',
      }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--dl-middle)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="Search places..."
          style={{
            background: 'none', border: 'none', outline: 'none',
            fontFamily: mono, fontSize: F.sm, color: 'var(--dl-strong)',
            letterSpacing: '0.03em', width: 140,
          }}
        />
      </div>
      {open && hasResults && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
          background: 'var(--dl-bg)', borderRadius: 8,
          border: '1px solid var(--dl-border)',
          boxShadow: 'var(--dl-shadow)',
          maxHeight: 240, overflowY: 'auto', zIndex: 1001,
        }}>
          {results.length > 0 && (
            <div style={{ padding: '4px 8px', fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Saved
            </div>
          )}
          {results.map(p => (
            <button key={p.id}
              onMouseDown={() => { onSelect(p); setQuery(''); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                background: 'none', border: 'none', padding: '6px 10px', cursor: 'pointer',
                fontFamily: mono, fontSize: F.sm, color: 'var(--dl-strong)',
                textAlign: 'left',
              }}>
              <span>{categoryEmoji(p.category)}</span>
              <span>{p.name}</span>
            </button>
          ))}
          {geoResults.length > 0 && (
            <div style={{ padding: '4px 8px', fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)', letterSpacing: '0.08em', textTransform: 'uppercase', borderTop: results.length ? '1px solid var(--dl-border)' : 'none' }}>
              Search
            </div>
          )}
          {geoResults.map((r, i) => (
            <button key={i}
              onMouseDown={() => { onGeoSelect(r); setQuery(''); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                background: 'none', border: 'none', padding: '6px 10px', cursor: 'pointer',
                fontFamily: mono, fontSize: F.sm, color: 'var(--dl-strong)',
                textAlign: 'left',
              }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--dl-middle)" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Map component (client-only) ────────────────────────────────────────────
function MapInner({ token }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const tileLayerRef = useRef(null);
  const markersRef = useRef([]);
  const locationDotsRef = useRef([]);
  const currentLocMarker = useRef(null);

  const [places, setPlaces] = useState([]);
  const [locations, setLocations] = useState([]);
  const [mode, setMode] = useState('places');
  const [addingPlace, setAddingPlace] = useState(null);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('pin');
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [leafletReady, setLeafletReady] = useState(false);
  const LRef = useRef(null);

  // Load Leaflet
  useEffect(() => {
    import('leaflet').then(L => {
      import('leaflet/dist/leaflet.css');
      LRef.current = L.default || L;
      setLeafletReady(true);
    });
  }, []);

  // Initialize map
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstance.current) return;
    const L = LRef.current;
    const loc = getCachedLocation() || DEFAULT_LOCATION;
    const map = L.map(mapRef.current, {
      center: [loc.lat, loc.lng],
      zoom: 13,
      zoomControl: false,
      attributionControl: false,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    tileLayerRef.current = L.tileLayer(isDark ? TILES_DARK : TILES_LIGHT, {
      attribution: TILE_ATTR,
      maxZoom: 19,
      keepBuffer: 6,        // keep extra tiles in memory to reduce flash
    }).addTo(map);

    map.on('click', (e) => {
      setSelectedPlace(null);
      setAddingPlace({ lat: e.latlng.lat, lng: e.latlng.lng });
      setNewName('');
      setNewCategory('pin');
    });

    mapInstance.current = map;
    return () => { map.remove(); mapInstance.current = null; };
  }, [leafletReady]); // eslint-disable-line

  // Switch tiles on theme change
  useEffect(() => {
    if (!mapInstance.current || !tileLayerRef.current) return;
    const L = LRef.current;
    tileLayerRef.current.remove();
    tileLayerRef.current = L.tileLayer(isDark ? TILES_DARK : TILES_LIGHT, {
      attribution: TILE_ATTR,
      maxZoom: 19,
      keepBuffer: 6,
    }).addTo(mapInstance.current);
  }, [isDark]);

  // Fetch places
  useEffect(() => {
    if (!token) return;
    api.get('/api/places', token).then(d => setPlaces(d?.places ?? []));
  }, [token]);

  // Fetch location history
  useEffect(() => {
    if (!token || mode !== 'timeline') return;
    api.get('/api/location?start=2020-01-01&end=2099-12-31', token).then(d => {
      setLocations(d?.locations ?? []);
    });
  }, [token, mode]);

  // Render place markers
  useEffect(() => {
    if (!mapInstance.current || !leafletReady) return;
    const L = LRef.current;
    const map = mapInstance.current;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    if (mode !== 'places') return;

    places.forEach(place => {
      const color = place.color || (isDark ? '#D08828' : '#B87018');
      const isSelected = selectedPlace?.id === place.id;
      const size = isSelected ? 16 : 12;
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:${size}px;height:${size}px;border-radius:50%;
          background:${color};
          border:2px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.8)'};
          box-shadow:0 1px 4px rgba(0,0,0,0.3);
          transition:all 0.15s;cursor:pointer;
        "></div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      const marker = L.marker([place.lat, place.lng], { icon }).addTo(map);
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        setSelectedPlace(place);
        setAddingPlace(null);
      });
      markersRef.current.push(marker);
    });
  }, [places, mode, leafletReady, isDark, selectedPlace]); // eslint-disable-line

  // Render current location
  useEffect(() => {
    if (!mapInstance.current || !leafletReady) return;
    const L = LRef.current;
    if (currentLocMarker.current) { currentLocMarker.current.remove(); currentLocMarker.current = null; }
    const loc = getCachedLocation();
    if (!loc) return;
    const accentColor = isDark ? '#D08828' : '#B87018';
    const icon = L.divIcon({
      className: '',
      html: `<div style="position:relative;width:20px;height:20px;">
        <div style="position:absolute;inset:0;border-radius:50%;background:${accentColor};opacity:0.2;animation:mapPulse 2s infinite;"></div>
        <div style="position:absolute;top:5px;left:5px;width:10px;height:10px;border-radius:50%;background:${accentColor};border:2px solid ${isDark ? '#111' : '#fff'};"></div>
      </div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    currentLocMarker.current = L.marker([loc.lat, loc.lng], { icon, interactive: false }).addTo(mapInstance.current);
  }, [leafletReady, isDark, mode]);

  // Render location history
  useEffect(() => {
    if (!mapInstance.current || !leafletReady) return;
    const L = LRef.current;
    const map = mapInstance.current;
    locationDotsRef.current.forEach(m => m.remove());
    locationDotsRef.current = [];
    if (mode !== 'timeline' || !locations.length) return;

    const coords = locations.map(l => [l.lat, l.lng]);
    const polyline = L.polyline(coords, {
      color: isDark ? '#D08828' : '#B87018',
      weight: 1.5, opacity: 0.25, dashArray: '6,6',
    }).addTo(map);
    locationDotsRef.current.push(polyline);

    const stays = [];
    let cur = { ...locations[0], days: 1 };
    for (let i = 1; i < locations.length; i++) {
      const loc = locations[i];
      const same = (loc.city && loc.city === cur.city) ||
        (Math.abs(loc.lat - cur.lat) < 0.5 && Math.abs(loc.lng - cur.lng) < 0.5);
      if (same) cur.days++;
      else { stays.push(cur); cur = { ...loc, days: 1 }; }
    }
    stays.push(cur);

    stays.forEach(stay => {
      const size = Math.max(6, Math.min(18, 4 + stay.days * 1.2));
      const color = isDark ? '#D08828' : '#B87018';
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};opacity:0.55;border:1.5px solid ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.7)'};box-shadow:0 1px 3px rgba(0,0,0,0.2);"></div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      const marker = L.marker([stay.lat, stay.lng], { icon }).addTo(map);
      marker.bindTooltip(
        `<div style="font-family:monospace;font-size:11px;letter-spacing:0.04em;">
          <strong>${stay.city || `${stay.lat.toFixed(1)}, ${stay.lng.toFixed(1)}`}</strong>
          ${stay.country ? `<span style="opacity:0.5;margin-left:4px">${stay.country}</span>` : ''}
          <br/><span style="opacity:0.6">${stay.days} day${stay.days !== 1 ? 's' : ''}</span>
        </div>`,
        { className: 'daylab-tooltip', direction: 'top', offset: [0, -size / 2] }
      );
      locationDotsRef.current.push(marker);
    });

    if (coords.length > 1) map.fitBounds(L.latLngBounds(coords).pad(0.1));
  }, [locations, mode, leafletReady, isDark]); // eslint-disable-line

  // Save new place
  const savePlace = useCallback(async () => {
    if (!addingPlace || !newName.trim() || !token) return;
    const result = await api.post('/api/places', {
      lat: addingPlace.lat, lng: addingPlace.lng,
      name: newName.trim(), category: newCategory,
    }, token);
    if (result?.place) setPlaces(prev => [result.place, ...prev]);
    setAddingPlace(null);
    setNewName('');
  }, [addingPlace, newName, newCategory, token]);

  // Delete place
  const deletePlace = useCallback(async (id) => {
    if (!token) return;
    await api.post(`/api/places?delete=${id}`, {}, token);
    setPlaces(prev => prev.filter(p => p.id !== id));
    setSelectedPlace(null);
  }, [token]);

  // Navigate to a saved place
  const goToPlace = useCallback((place) => {
    if (!mapInstance.current) return;
    mapInstance.current.flyTo([place.lat, place.lng], 16, { duration: 0.8 });
    setSelectedPlace(place);
    setAddingPlace(null);
  }, []);

  // Navigate to a geocoded result
  const goToGeo = useCallback((result) => {
    if (!mapInstance.current) return;
    mapInstance.current.flyTo([result.lat, result.lng], 16, { duration: 0.8 });
    setAddingPlace({ lat: result.lat, lng: result.lng });
    setNewName(result.name);
    setNewCategory('pin');
    setSelectedPlace(null);
  }, []);

  // + button: add pin at map center
  const addAtCenter = useCallback(() => {
    if (!mapInstance.current) return;
    const c = mapInstance.current.getCenter();
    setAddingPlace({ lat: c.lat, lng: c.lng });
    setNewName('');
    setNewCategory('pin');
    setSelectedPlace(null);
  }, []);

  // Background color to match tiles while loading
  const bgColor = isDark ? '#1a1a2e' : '#e8e4d8';

  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', position: 'relative', height: 400, background: bgColor }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      <style>{`
        .daylab-tooltip {
          background: var(--dl-bg) !important;
          border: 1px solid var(--dl-border) !important;
          border-radius: 8px !important;
          box-shadow: var(--dl-shadow-sm) !important;
          color: var(--dl-strong) !important;
          padding: 4px 8px !important;
        }
        .daylab-tooltip::before { border-top-color: var(--dl-border) !important; }
        @keyframes mapPulse {
          0%, 100% { transform: scale(1); opacity: 0.2; }
          50% { transform: scale(1.8); opacity: 0; }
        }
        .leaflet-tile-pane {
          filter: saturate(0.3) sepia(0.15) ${isDark ? 'brightness(0.7)' : 'brightness(1.02)'};
        }
        /* Match tile background to container so no white flash */
        .leaflet-container { background: ${bgColor} !important; }
        .leaflet-control-zoom a {
          background: var(--dl-bg) !important;
          color: var(--dl-strong) !important;
          border-color: var(--dl-border) !important;
          font-family: ${mono} !important;
        }
        .leaflet-control-zoom a:hover { background: var(--dl-surface) !important; }
      `}</style>

      {/* Top bar: mode toggle (left) + search (center) + add button (right) */}
      <div style={{
        position: 'absolute', top: 10, left: 10, right: 10, zIndex: 1000,
        display: 'flex', alignItems: 'flex-start', gap: 8,
      }}>
        {/* Mode toggle — icon buttons */}
        <div style={{
          display: 'flex', gap: 2,
          background: 'var(--dl-bg)', borderRadius: 8,
          border: '1px solid var(--dl-border)',
          padding: 2, flexShrink: 0,
        }}>
          {/* Places — pin icon */}
          <button onClick={() => { setMode('places'); setAddingPlace(null); setSelectedPlace(null); }}
            title="Places"
            style={{
              background: mode === 'places' ? 'var(--dl-accent-10)' : 'none',
              border: 'none', borderRadius: 6, padding: '5px 8px', cursor: 'pointer',
              color: mode === 'places' ? 'var(--dl-accent)' : 'var(--dl-middle)',
              display: 'flex', alignItems: 'center', transition: 'all 0.15s',
            }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
          </button>
          {/* Timeline — clock/path icon */}
          <button onClick={() => { setMode('timeline'); setAddingPlace(null); setSelectedPlace(null); }}
            title="Location timeline"
            style={{
              background: mode === 'timeline' ? 'var(--dl-accent-10)' : 'none',
              border: 'none', borderRadius: 6, padding: '5px 8px', cursor: 'pointer',
              color: mode === 'timeline' ? 'var(--dl-accent)' : 'var(--dl-middle)',
              display: 'flex', alignItems: 'center', transition: 'all 0.15s',
            }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </button>
        </div>

        {/* Search */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <MapSearch places={places} onSelect={goToPlace} onGeoSelect={goToGeo} isDark={isDark} />
        </div>

        {/* + Add pin button */}
        {mode === 'places' && (
          <button onClick={addAtCenter}
            title="Add a pin"
            style={{
              background: 'var(--dl-bg)', border: '1px solid var(--dl-border)',
              borderRadius: 8, padding: '5px 8px', cursor: 'pointer',
              color: 'var(--dl-accent)', display: 'flex', alignItems: 'center',
              flexShrink: 0, transition: 'all 0.15s',
            }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        )}
      </div>

      {/* Add-place popup */}
      {addingPlace && mode === 'places' && (
        <div style={{
          position: 'absolute', bottom: 12, left: 12, right: 12, zIndex: 1000,
          background: 'var(--dl-bg)', borderRadius: 10,
          border: '1px solid var(--dl-border)',
          padding: '10px 14px',
          boxShadow: 'var(--dl-shadow)',
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') savePlace(); if (e.key === 'Escape') setAddingPlace(null); }}
              placeholder="Name this place..."
              style={{
                flex: 1, background: 'var(--dl-well)', border: '1px solid var(--dl-border)',
                borderRadius: 6, padding: '6px 10px',
                fontFamily: mono, fontSize: F.sm,
                color: 'var(--dl-strong)', outline: 'none',
                letterSpacing: '0.03em',
              }}
            />
            <button onClick={savePlace}
              style={{
                background: 'var(--dl-accent)', border: 'none', borderRadius: 6,
                padding: '6px 14px', cursor: 'pointer',
                fontFamily: mono, fontSize: F.sm, fontWeight: 600,
                color: '#fff', letterSpacing: '0.04em',
              }}>
              Save
            </button>
            <button onClick={() => setAddingPlace(null)}
              style={{
                background: 'none', border: '1px solid var(--dl-border)', borderRadius: 6,
                padding: '6px 10px', cursor: 'pointer',
                fontFamily: mono, fontSize: F.sm,
                color: 'var(--dl-middle)',
              }}>
              &times;
            </button>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {CATEGORIES.map(cat => (
              <button key={cat.id}
                onClick={() => setNewCategory(cat.id)}
                style={{
                  background: newCategory === cat.id ? 'var(--dl-accent-10)' : 'var(--dl-well)',
                  border: `1px solid ${newCategory === cat.id ? 'var(--dl-accent)' : 'var(--dl-border)'}`,
                  borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
                  fontSize: 12, color: 'var(--dl-strong)',
                  transition: 'all 0.1s',
                }}>
                {cat.emoji} {cat.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Selected place detail */}
      {selectedPlace && mode === 'places' && (
        <div style={{
          position: 'absolute', bottom: 12, left: 12, right: 12, zIndex: 1000,
          background: 'var(--dl-bg)', borderRadius: 10,
          border: '1px solid var(--dl-border)',
          padding: '10px 14px',
          boxShadow: 'var(--dl-shadow)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: 14, marginRight: 6 }}>{categoryEmoji(selectedPlace.category)}</span>
              <span style={{ fontFamily: mono, fontSize: F.md, fontWeight: 600, color: 'var(--dl-strong)', letterSpacing: '0.03em' }}>
                {selectedPlace.name}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => deletePlace(selectedPlace.id)}
                style={{
                  background: 'none', border: '1px solid var(--dl-border)', borderRadius: 6,
                  padding: '3px 10px', cursor: 'pointer',
                  fontFamily: mono, fontSize: F.sm - 1,
                  color: 'var(--dl-red)',
                }}>
                Delete
              </button>
              <button onClick={() => setSelectedPlace(null)}
                style={{
                  background: 'none', border: '1px solid var(--dl-border)', borderRadius: 6,
                  padding: '3px 8px', cursor: 'pointer',
                  fontFamily: mono, fontSize: F.sm,
                  color: 'var(--dl-middle)',
                }}>
                &times;
              </button>
            </div>
          </div>
          {selectedPlace.notes && (
            <div style={{ fontFamily: mono, fontSize: F.sm, color: 'var(--dl-middle)', marginTop: 4 }}>
              {selectedPlace.notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const MapInnerNoSSR = dynamic(() => Promise.resolve(MapInner), { ssr: false });

export default function WorldMapCard({ token }) {
  return <MapInnerNoSSR token={token} />;
}
