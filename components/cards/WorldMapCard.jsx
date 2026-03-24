"use client";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
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

// ─── Tile URLs for light/dark ───────────────────────────────────────────────
// CartoDB Positron (light) and Dark Matter (dark) — free, minimalist, no key
const TILES_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png';
const TILES_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

// ─── Map component (must be client-only, no SSR) ───────────────────────────
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
  const [mode, setMode] = useState('places'); // 'places' | 'timeline'
  const [addingPlace, setAddingPlace] = useState(null); // { lat, lng } when user clicked to add
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('pin');
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [leafletReady, setLeafletReady] = useState(false);
  const LRef = useRef(null); // Leaflet module reference

  // Load Leaflet dynamically (client-only)
  useEffect(() => {
    import('leaflet').then(L => {
      // Import CSS
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

    // Add zoom control bottom-right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Add tile layer
    tileLayerRef.current = L.tileLayer(isDark ? TILES_DARK : TILES_LIGHT, {
      attribution: TILE_ATTR,
      maxZoom: 19,
    }).addTo(map);

    // Click to add place
    map.on('click', (e) => {
      setSelectedPlace(null);
      setAddingPlace({ lat: e.latlng.lat, lng: e.latlng.lng });
      setNewName('');
      setNewCategory('pin');
    });

    mapInstance.current = map;

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, [leafletReady]); // eslint-disable-line

  // Switch tile layer on theme change
  useEffect(() => {
    if (!mapInstance.current || !tileLayerRef.current) return;
    const L = LRef.current;
    tileLayerRef.current.remove();
    tileLayerRef.current = L.tileLayer(isDark ? TILES_DARK : TILES_LIGHT, {
      attribution: TILE_ATTR,
      maxZoom: 19,
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

    // Clear old markers
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
          transition:all 0.15s;
          cursor:pointer;
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

    if (currentLocMarker.current) {
      currentLocMarker.current.remove();
      currentLocMarker.current = null;
    }

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

  // Render location history dots
  useEffect(() => {
    if (!mapInstance.current || !leafletReady) return;
    const L = LRef.current;
    const map = mapInstance.current;

    // Clear old
    locationDotsRef.current.forEach(m => m.remove());
    locationDotsRef.current = [];

    if (mode !== 'timeline' || !locations.length) return;

    // Draw connecting line
    const coords = locations.map(l => [l.lat, l.lng]);
    const polyline = L.polyline(coords, {
      color: isDark ? '#D08828' : '#B87018',
      weight: 1.5,
      opacity: 0.25,
      dashArray: '6,6',
    }).addTo(map);
    locationDotsRef.current.push(polyline);

    // Group stays for sizing
    const stays = [];
    let cur = { ...locations[0], days: 1 };
    for (let i = 1; i < locations.length; i++) {
      const loc = locations[i];
      const same = (loc.city && loc.city === cur.city) ||
        (Math.abs(loc.lat - cur.lat) < 0.5 && Math.abs(loc.lng - cur.lng) < 0.5);
      if (same) {
        cur.days++;
      } else {
        stays.push(cur);
        cur = { ...loc, days: 1 };
      }
    }
    stays.push(cur);

    stays.forEach(stay => {
      const size = Math.max(6, Math.min(18, 4 + stay.days * 1.2));
      const color = isDark ? '#D08828' : '#B87018';
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:${size}px;height:${size}px;border-radius:50%;
          background:${color};opacity:0.55;
          border:1.5px solid ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.7)'};
          box-shadow:0 1px 3px rgba(0,0,0,0.2);
        "></div>`,
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

    // Fit bounds to show all
    if (coords.length > 1) {
      map.fitBounds(L.latLngBounds(coords).pad(0.1));
    }
  }, [locations, mode, leafletReady, isDark]); // eslint-disable-line

  // Save new place
  const savePlace = useCallback(async () => {
    if (!addingPlace || !newName.trim() || !token) return;
    const result = await api.post('/api/places', {
      lat: addingPlace.lat,
      lng: addingPlace.lng,
      name: newName.trim(),
      category: newCategory,
    }, token);
    if (result?.place) {
      setPlaces(prev => [result.place, ...prev]);
    }
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

  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', position: 'relative', height: 400 }}>
      {/* Map container */}
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* Custom CSS for map theming */}
      <style>{`
        .daylab-tooltip {
          background: var(--dl-bg) !important;
          border: 1px solid var(--dl-border) !important;
          border-radius: 8px !important;
          box-shadow: var(--dl-shadow-sm) !important;
          color: var(--dl-strong) !important;
          padding: 4px 8px !important;
        }
        .daylab-tooltip::before {
          border-top-color: var(--dl-border) !important;
        }
        @keyframes mapPulse {
          0%, 100% { transform: scale(1); opacity: 0.2; }
          50% { transform: scale(1.8); opacity: 0; }
        }
        /* Tint the tiles to match DayLab palette */
        .leaflet-tile-pane {
          filter: saturate(0.3) sepia(0.15) ${isDark ? 'brightness(0.7)' : 'brightness(1.02)'};
        }
        .leaflet-control-zoom a {
          background: var(--dl-bg) !important;
          color: var(--dl-strong) !important;
          border-color: var(--dl-border) !important;
          font-family: ${mono} !important;
        }
        .leaflet-control-zoom a:hover {
          background: var(--dl-surface) !important;
        }
      `}</style>

      {/* Mode toggle — top left */}
      <div style={{
        position: 'absolute', top: 10, left: 10, zIndex: 1000,
        display: 'flex', gap: 2,
        background: 'var(--dl-bg)', borderRadius: 8,
        border: '1px solid var(--dl-border)',
        padding: 2,
      }}>
        {[
          { id: 'places', label: 'Places', icon: '📍' },
          { id: 'timeline', label: 'Timeline', icon: '🕰' },
        ].map(m => (
          <button key={m.id} onClick={() => { setMode(m.id); setAddingPlace(null); setSelectedPlace(null); }}
            style={{
              background: mode === m.id ? 'var(--dl-accent-10)' : 'none',
              border: 'none', borderRadius: 6,
              padding: '4px 10px', cursor: 'pointer',
              fontFamily: mono, fontSize: F.sm,
              letterSpacing: '0.04em',
              color: mode === m.id ? 'var(--dl-accent)' : 'var(--dl-middle)',
              transition: 'all 0.15s',
            }}>
            {m.label}
          </button>
        ))}
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

// Wrap in dynamic() to prevent SSR (Leaflet requires window)
const MapInnerNoSSR = dynamic(() => Promise.resolve(MapInner), { ssr: false });

export default function WorldMapCard({ token }) {
  return <MapInnerNoSSR token={token} />;
}
