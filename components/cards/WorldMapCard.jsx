"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { mono, F } from "@/lib/tokens";
import { api } from "@/lib/api";
import { getCachedLocation, DEFAULT_LOCATION } from "@/lib/weather";
import { useTheme } from "@/lib/theme";
import dynamic from "next/dynamic";
import { feature as topoFeature } from "topojson-client";

// ─── Pin color palette for user-created types ──────────────────────────────
const PIN_COLORS = [
  '#D08828', // amber (default)
  '#4A9A68', // green
  '#4878A8', // blue
  '#8860B8', // purple
  '#B04840', // red
  '#B88828', // gold
  '#6A8A6A', // sage
  '#888888', // grey
  '#CCCCCC', // white/light
  '#C17B4A', // copper
  '#6B8EB8', // steel blue
  '#A07AB0', // lavender
];

// ─── Tile URLs ──────────────────────────────────────────────────────────────
const TILES_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png';
const TILES_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

// ─── Boundary data for discovered regions ────────────────────────────────────
const COUNTRIES_TOPOJSON_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const US_STATES_TOPOJSON_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';
const ADMIN1_TOPOJSON_URL = '/admin1-provinces.topojson';
// Map user-friendly names → GeoJSON feature names
const COUNTRY_NAME_MAP = {
  'United States': 'United States of America',
  'USA': 'United States of America',
  'UK': 'United Kingdom',
  'England': 'United Kingdom',
  'South Korea': 'South Korea',
  'Turkiye': 'Turkey',
  'The Netherlands': 'Netherlands',
  'Czech Republic': 'Czechia',
  'Caribbean': null,
  'Europe': null,
  'Puerto Rico': 'Puerto Rico',
};

// ─── Area type detection (shared between search + map) ──────────────────────
const AREA_GEO_TYPES = new Set(['state', 'administrative', 'island', 'archipelago', 'territory', 'city', 'town', 'village', 'municipality', 'district', 'borough', 'county', 'country']);

// ─── Search bar (glassmorphic, location-biased) ─────────────────────────────
function MapSearch({ places, onSelect, onGeoSelect, isDark, mapInstance }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [geoResults, setGeoResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);
  const inputRef = useRef(null);

  // Filter saved places
  useEffect(() => {
    if (!query.trim()) { setResults([]); setGeoResults([]); return; }
    const q = query.toLowerCase();
    setResults(places.filter(p => p.name.toLowerCase().includes(q)).slice(0, 5));
  }, [query, places]);

  // Search via Photon (OSM-based, good POI search, native location bias)
  // Falls back to Nominatim if Photon returns nothing
  useEffect(() => {
    clearTimeout(timerRef.current);
    if (!query.trim() || query.length < 2) { setGeoResults([]); setSearching(false); return; }
    setSearching(true);
    timerRef.current = setTimeout(async () => {
      try {
        const map = mapInstance?.current;
        const loc = map ? map.getCenter() : (getCachedLocation() || DEFAULT_LOCATION);

        // Photon API — location-biased POI search (free, no key)
        const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=${loc.lat}&lon=${loc.lng}&limit=8`;
        const res = await fetch(photonUrl);
        if (res.ok) {
          const data = await res.json();
          const features = data?.features || [];
          if (features.length > 0) {
            setGeoResults(features.map(f => {
              const p = f.properties || {};
              const coords = f.geometry?.coordinates || [];
              const name = p.name || p.street || query;
              const area = p.city || p.district || p.county || p.state || '';
              const osmType = p.osm_value || p.type || '';
              return {
                name: name + (area ? `, ${area}` : ''),
                rawName: name,
                fullName: [name, p.street, p.city, p.state, p.country].filter(Boolean).join(', '),
                lat: coords[1],
                lng: coords[0],
                type: osmType,
                country: p.country || '',
                street: p.street || '',
                city: p.city || p.district || '',
                state: p.state || '',
                osmKey: p.osm_key || '',
              };
            }));
            setSearching(false);
            return;
          }
        }

        // Fallback: Nominatim for broader coverage
        const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&addressdetails=1`;
        const nomRes = await fetch(nomUrl, { headers: { 'User-Agent': 'DayLab/1.0' } });
        if (nomRes.ok) {
          const nomData = await nomRes.json();
          const withDist = nomData.map(d => {
            const dlat = parseFloat(d.lat) - loc.lat;
            const dlng = parseFloat(d.lon) - loc.lng;
            return { ...d, dist: Math.sqrt(dlat * dlat + dlng * dlng) };
          });
          withDist.sort((a, b) => a.dist - b.dist);
          setGeoResults(withDist.map(d => {
            const addr = d.address || {};
            const name = addr.amenity || addr.shop || addr.tourism || addr.leisure
              || addr.restaurant || addr.cafe || addr.building
              || d.display_name.split(',')[0];
            const area = addr.neighbourhood || addr.suburb || addr.city_district
              || addr.city || addr.town || '';
            return {
              name: name + (area ? `, ${area}` : ''),
              rawName: name,
              fullName: d.display_name,
              lat: parseFloat(d.lat),
              lng: parseFloat(d.lon),
              type: d.type,
              country: addr.country || '',
              state: addr.state || '',
            };
          }));
        }
      } catch {}
      setSearching(false);
    }, 350);
    return () => clearTimeout(timerRef.current);
  }, [query]); // eslint-disable-line

  const hasResults = results.length > 0 || geoResults.length > 0;
  const showDropdown = open && (hasResults || searching);

  return (
    <div style={{ position: 'relative', flex: 1 }}>
      {/* Glassmorphic search pill */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        backdropFilter: 'blur(20px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
        background: 'var(--dl-glass)',
        border: '1px solid var(--dl-glass-border)',
        borderRadius: 100,
        padding: '6px 14px',
        boxShadow: 'var(--dl-glass-shadow)',
        transition: 'box-shadow 0.18s ease',
      }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--dl-middle)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.6 }}>
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="Search nearby..."
          style={{
            flex: 1, background: 'none', border: 'none', outline: 'none',
            fontFamily: mono, fontSize: F.sm, color: 'var(--dl-strong)',
            letterSpacing: '0.03em',
            minWidth: 0,
          }}
        />
        {query && (
          <button onClick={() => { setQuery(''); setResults([]); setGeoResults([]); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--dl-middle)', fontSize: 14, lineHeight: 1 }}>
            &times;
          </button>
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6,
          backdropFilter: 'blur(20px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
          background: 'var(--dl-glass)',
          border: '1px solid var(--dl-glass-border)',
          borderRadius: 14,
          boxShadow: 'var(--dl-shadow)',
          maxHeight: 280, overflowY: 'auto', zIndex: 1001,
          padding: '4px 0',
        }}>
          {results.length > 0 && (
            <>
              <div style={{ padding: '6px 14px 2px', fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)', letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.6 }}>
                Your places
              </div>
              {results.map(p => (
                <button key={p.id}
                  onMouseDown={() => { onSelect(p); setQuery(''); setOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    background: 'none', border: 'none', padding: '8px 14px', cursor: 'pointer',
                    fontFamily: mono, fontSize: F.sm, color: 'var(--dl-strong)',
                    textAlign: 'left', transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--dl-glass-active)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color || 'var(--dl-accent)', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                </button>
              ))}
            </>
          )}
          {(geoResults.length > 0 || searching) && (
            <>
              {(results.length > 0) && <div style={{ height: 1, background: 'var(--dl-glass-border)', margin: '4px 12px' }} />}
              <div style={{ padding: '6px 14px 2px', fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)', letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.6 }}>
                {searching ? 'Searching...' : 'Nearby'}
              </div>
              {geoResults.map((r, i) => (
                <button key={i}
                  onMouseDown={() => { onGeoSelect(r); setQuery(''); setOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    background: 'none', border: 'none', padding: '8px 14px', cursor: 'pointer',
                    fontFamily: mono, fontSize: F.sm, color: 'var(--dl-strong)',
                    textAlign: 'left', transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--dl-glass-active)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  {AREA_GEO_TYPES.has(r.type) ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--dl-middle)" strokeWidth="2" style={{ flexShrink: 0, opacity: 0.55 }}>
                      <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/>
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--dl-middle)" strokeWidth="2" style={{ flexShrink: 0, opacity: 0.5 }}>
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                    </svg>
                  )}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Map Bottom Strip — collapsible container for carousel + info panels ─────
function MapBottomStrip({ collapsed, onToggle, children }) {
  // Check if there's any visible content in children
  const hasContent = !!children;
  if (!hasContent) return null;

  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 999,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      pointerEvents: 'none',
    }}>
      {/* Vignette fade — rises with the strip */}
      <div style={{
        width: '100%', height: collapsed ? 0 : 60,
        background: 'linear-gradient(to top, var(--dl-bg) 0%, transparent 100%)',
        pointerEvents: 'none',
        transition: 'height 0.25s ease, opacity 0.25s ease',
        opacity: collapsed ? 0 : 1,
      }} />
      {/* Chevron toggle */}
      <button onClick={onToggle} style={{
        pointerEvents: 'auto',
        background: 'var(--dl-glass)',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid var(--dl-glass-border)',
        borderRadius: '8px 8px 0 0',
        padding: '2px 16px 0',
        cursor: 'pointer',
        color: 'var(--dl-middle)',
        display: 'flex', alignItems: 'center',
        opacity: 0.7,
        transition: 'opacity 0.15s',
      }}
        onMouseEnter={e => e.currentTarget.style.opacity = '1'}
        onMouseLeave={e => e.currentTarget.style.opacity = '0.7'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {/* Content area */}
      <div style={{
        width: '100%',
        padding: '0 10px 10px',
        pointerEvents: 'auto',
        maxHeight: collapsed ? 0 : 200,
        overflow: 'hidden',
        transition: 'max-height 0.25s ease',
        boxSizing: 'border-box',
      }}>
        {children}
      </div>
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
  const [placeTypes, setPlaceTypes] = useState([]);
  const [locations, setLocations] = useState([]);
  const [mode, setMode] = useState('places');
  const [activeFilter, setActiveFilter] = useState(null); // null = show all, type name = filter
  const [addingPlace, setAddingPlace] = useState(null);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [creatingType, setCreatingType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [hoveredPlace, setHoveredPlace] = useState(null);
  const [leafletReady, setLeafletReady] = useState(false);
  const [discoveredCountries, setDiscoveredCountries] = useState([]);
  const [discoveredPlaces, setDiscoveredPlaces] = useState([]);
  const [selectedDiscovered, setSelectedDiscovered] = useState(null);
  const [previewGeo, setPreviewGeo] = useState(null); // search result preview before adding
  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  const [mapBounds, setMapBounds] = useState(null); // track visible bounds for carousel
  const discoveredLayerRef = useRef(null);
  const statesLayerRef = useRef(null);
  const geoJsonCacheRef = useRef(null);
  const statesGeoJsonCacheRef = useRef(null);
  const admin1CacheRef = useRef(null);
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
      keepBuffer: 8,
      updateWhenZooming: false, // don't load tiles mid-zoom animation
      updateWhenIdle: true,     // load after zoom settles
    }).addTo(map);

    // Single click deselects; double-click drops a pin
    map.on('click', () => {
      setSelectedPlace(null);
      setSelectedDiscovered(null);
      setPreviewGeo(null);
      setAddingPlace(null);
    });
    map.on('dblclick', (e) => {
      e.originalEvent.preventDefault();
      setSelectedPlace(null);
      setAddingPlace({ lat: e.latlng.lat, lng: e.latlng.lng });
      setNewName('');
      setNewType('');
      setNewNotes('');
    });
    // Disable default double-click zoom since we use it for pins
    map.doubleClickZoom.disable();

    mapInstance.current = map;
    // Track visible bounds for carousel
    const updateBounds = () => setMapBounds(map.getBounds());
    map.on('moveend', updateBounds);
    map.on('zoomend', updateBounds);
    updateBounds();
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
      keepBuffer: 8,
      updateWhenZooming: false,
      updateWhenIdle: true,
    }).addTo(mapInstance.current);
  }, [isDark]);

  // Render discovered country boundaries
  useEffect(() => {
    if (!mapInstance.current || !leafletReady || !discoveredCountries.length) {
      if (discoveredLayerRef.current) { discoveredLayerRef.current.remove(); discoveredLayerRef.current = null; }
      return;
    }
    const L = LRef.current;
    const map = mapInstance.current;

    const renderBoundaries = async () => {
      // Fetch TopoJSON + convert to GeoJSON, cache result
      if (!geoJsonCacheRef.current) {
        try {
          const res = await fetch(COUNTRIES_TOPOJSON_URL);
          const topo = await res.json();
          geoJsonCacheRef.current = topoFeature(topo, topo.objects.countries);
        } catch (err) { console.error('Failed to load country boundaries:', err); return; }
      }
      const geo = geoJsonCacheRef.current;

      // Build a set of normalized names to match
      const normalizedNames = new Set();
      discoveredCountries.forEach(name => {
        const mapped = COUNTRY_NAME_MAP.hasOwnProperty(name) ? COUNTRY_NAME_MAP[name] : name;
        if (mapped) normalizedNames.add(mapped.toLowerCase());
      });

      // Filter features to discovered countries
      const filtered = {
        type: 'FeatureCollection',
        features: geo.features.filter(f => {
          const name = (f.properties?.name || '');
          if (normalizedNames.has(name.toLowerCase())) return true;
          for (const dn of normalizedNames) {
            if (name.toLowerCase().includes(dn) || dn.includes(name.toLowerCase())) return true;
          }
          return false;
        }),
      };

      // Remove old layer
      if (discoveredLayerRef.current) { discoveredLayerRef.current.remove(); }

      // Visible fill, no outline stroke — clickable to select
      // Canvas renderer with large padding for smooth zoom (no redraw flash)
      const renderer = L.canvas({ padding: 1.0 });
      discoveredLayerRef.current = L.geoJSON(filtered, {
        renderer,
        style: {
          color: 'transparent',
          weight: 0,
          fillColor: isDark ? '#8A7A60' : '#9A8A68',
          fillOpacity: isDark ? 0.08 : 0.10,
        },
        onEachFeature: (feature, layer) => {
          layer.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            const fname = (feature.properties?.name || '');
            // Find matching country in discovered list
            const match = discoveredCountries.find(c => {
              const mapped = COUNTRY_NAME_MAP.hasOwnProperty(c) ? COUNTRY_NAME_MAP[c] : c;
              return mapped && (mapped.toLowerCase() === fname.toLowerCase() || fname.toLowerCase().includes(mapped.toLowerCase()) || mapped.toLowerCase().includes(fname.toLowerCase()));
            });
            if (match) {
              setSelectedDiscovered(match);
              setSelectedPlace(null);
              setAddingPlace(null);
            }
          });
        },
      }).addTo(map);

      // Send to back so pins render on top
      discoveredLayerRef.current.bringToBack();

      // Adjust opacity based on zoom — brighter when zoomed out
      const updateOpacity = () => {
        if (!discoveredLayerRef.current) return;
        const z = map.getZoom();
        const opacity = z <= 3 ? (isDark ? 0.14 : 0.16) : z <= 5 ? (isDark ? 0.09 : 0.11) : z <= 8 ? (isDark ? 0.05 : 0.06) : (isDark ? 0.03 : 0.04);
        discoveredLayerRef.current.setStyle({ fillOpacity: opacity });
      };
      updateOpacity();
      map.on('zoomend', updateOpacity);
      // Store cleanup ref
      discoveredLayerRef.current._zoomHandler = updateOpacity;
    };

    renderBoundaries();
    return () => {
      if (discoveredLayerRef.current?._zoomHandler) {
        map.off('zoomend', discoveredLayerRef.current._zoomHandler);
      }
    };
  }, [discoveredCountries, leafletReady, isDark]);

  // Render discovered state/province boundaries (global admin-1 + US states high-res)
  // Provinces are highlighted if: explicitly discovered OR contain a discovered city
  useEffect(() => {
    if (!mapInstance.current || !leafletReady || !discoveredPlaces.length) {
      if (statesLayerRef.current) { statesLayerRef.current.remove(); statesLayerRef.current = null; }
      return;
    }
    const L = LRef.current;
    const map = mapInstance.current;

    // Point-in-polygon (ray casting) for matching cities to provinces
    const pointInRing = (point, ring) => {
      let inside = false;
      const [px, py] = point;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    const pointInPolygon = (point, geometry) => {
      if (!geometry) return false;
      const { type, coordinates } = geometry;
      if (type === 'Polygon') return coordinates.some(ring => pointInRing(point, ring));
      if (type === 'MultiPolygon') return coordinates.some(poly => poly.some(ring => pointInRing(point, ring)));
      return false;
    };

    const renderStates = async () => {
      // Collect explicitly discovered state names
      const stateType = new Set(['state', 'administrative', 'territory', 'district']);
      const stateNames = new Set(
        discoveredPlaces.filter(p => stateType.has(p.type)).map(p => p.name.toLowerCase())
      );

      // Collect discovered cities with coordinates (for point-in-polygon matching)
      const cities = discoveredPlaces.filter(p => p.lat && p.lng && !stateType.has(p.type) && p.type !== 'country');

      // Load global admin-1 TopoJSON (1.6MB, cached)
      if (!admin1CacheRef.current) {
        try {
          const res = await fetch(ADMIN1_TOPOJSON_URL);
          const topo = await res.json();
          admin1CacheRef.current = topoFeature(topo, topo.objects.admin1);
        } catch { /* admin-1 data unavailable */ }
      }

      let allFeatures = [];
      if (admin1CacheRef.current) {
        allFeatures = admin1CacheRef.current.features.filter(f => {
          const name = (f.properties?.name || '').toLowerCase();
          // Match by explicit state name
          if (stateNames.has(name)) return true;
          // Match by city containment — check if any discovered city falls within this province
          const country = (f.properties?.admin || '').toLowerCase();
          const countryCities = cities.filter(c => (c.country || '').toLowerCase() === country);
          return countryCities.some(c => pointInPolygon([c.lng, c.lat], f.geometry));
        });
      }

      // Also check US high-res atlas for US states (sharper boundaries)
      const usDiscovered = discoveredPlaces.filter(p =>
        p.country === 'United States' || p.country === 'USA'
      );
      const usStateNames = new Set(usDiscovered.filter(p => stateType.has(p.type)).map(p => p.name.toLowerCase()));
      const usCities = usDiscovered.filter(p => p.lat && p.lng && !stateType.has(p.type) && p.type !== 'country');

      if (usStateNames.size > 0 || usCities.length > 0) {
        if (!statesGeoJsonCacheRef.current) {
          try {
            const res = await fetch(US_STATES_TOPOJSON_URL);
            const topo = await res.json();
            statesGeoJsonCacheRef.current = topoFeature(topo, topo.objects.states);
          } catch { /* US states unavailable */ }
        }
        if (statesGeoJsonCacheRef.current) {
          // Find matching US state features (by name or city containment)
          const matchedUSNames = new Set();
          const usFeatures = statesGeoJsonCacheRef.current.features.filter(f => {
            const name = (f.properties?.name || '').toLowerCase();
            if (usStateNames.has(name)) { matchedUSNames.add(name); return true; }
            if (usCities.some(c => pointInPolygon([c.lng, c.lat], f.geometry))) { matchedUSNames.add(name); return true; }
            return false;
          });
          // Replace low-res admin-1 US features with high-res versions
          allFeatures = allFeatures.filter(f => {
            const name = (f.properties?.name || '').toLowerCase();
            return !matchedUSNames.has(name);
          });
          allFeatures.push(...usFeatures);
        }
      }

      if (allFeatures.length === 0) { if (statesLayerRef.current) { statesLayerRef.current.remove(); statesLayerRef.current = null; } return; }

      const filtered = { type: 'FeatureCollection', features: allFeatures };

      if (statesLayerRef.current) statesLayerRef.current.remove();

      if (filtered.features.length > 0) {
        const renderer = L.canvas({ padding: 1.0 });
        statesLayerRef.current = L.geoJSON(filtered, {
          renderer,
          style: {
            color: 'transparent',
            weight: 0,
            fillColor: isDark ? '#8A7A60' : '#9A8A68',
            fillOpacity: isDark ? 0.08 : 0.10,
          },
          interactive: false,
        }).addTo(map);
        statesLayerRef.current.bringToBack();

        const updateOpacity = () => {
          if (!statesLayerRef.current) return;
          const z = map.getZoom();
          const opacity = z <= 3 ? (isDark ? 0.14 : 0.16) : z <= 5 ? (isDark ? 0.09 : 0.11) : z <= 8 ? (isDark ? 0.05 : 0.06) : (isDark ? 0.03 : 0.04);
          statesLayerRef.current.setStyle({ fillOpacity: opacity });
        };
        updateOpacity();
        map.on('zoomend', updateOpacity);
        statesLayerRef.current._zoomHandler = updateOpacity;
      }
    };

    renderStates();
    return () => {
      if (statesLayerRef.current?._zoomHandler) {
        map.off('zoomend', statesLayerRef.current._zoomHandler);
      }
    };
  }, [discoveredPlaces, leafletReady, isDark]);

  // (Discovered place markers removed — polygon shading is sufficient)

  // Preview pin at clicked location
  const previewMarkerRef = useRef(null);
  useEffect(() => {
    if (!mapInstance.current || !leafletReady) return;
    const L = LRef.current;
    if (previewMarkerRef.current) { previewMarkerRef.current.remove(); previewMarkerRef.current = null; }
    if (!addingPlace) return;
    const accentColor = isDark ? '#D08828' : '#B87018';
    const icon = L.divIcon({
      className: '',
      html: `<div style="position:relative;width:24px;height:24px;">
        <div style="position:absolute;inset:0;border-radius:50%;background:${accentColor};opacity:0.15;"></div>
        <div style="position:absolute;top:6px;left:6px;width:12px;height:12px;border-radius:50%;background:${accentColor};border:2px solid ${isDark ? '#111' : '#fff'};box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>
      </div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
    previewMarkerRef.current = L.marker([addingPlace.lat, addingPlace.lng], { icon, interactive: false }).addTo(mapInstance.current);
  }, [addingPlace, leafletReady, isDark]);

  // Fetch places + types
  useEffect(() => {
    if (!token) return;
    api.get('/api/places', token).then(d => {
      const all = d?.places ?? [];
      const seen = new Set();
      setPlaces(all.filter(p => {
        const key = `${p.name}|${p.lat}|${p.lng}`;
        return seen.has(key) ? false : (seen.add(key), true);
      }));
    });
    api.get('/api/place-types', token).then(d => setPlaceTypes(d?.types ?? []));
    api.get('/api/discovered', token).then(d => {
      setDiscoveredCountries(d?.countries ?? []);
      setDiscoveredPlaces(d?.discovered ?? []);
    });
  }, [token]);

  // Listen for place chip clicks from editors — fly to the place on map
  useEffect(() => {
    const handler = (e) => {
      const name = e.detail?.name;
      if (!name || !mapInstance.current) return;
      const place = places.find(p => p.name.toLowerCase() === name.toLowerCase());
      if (place) {
        mapInstance.current.flyTo([place.lat, place.lng], 16, { duration: 0.8 });
        setSelectedPlace(place);
        setMode('places');
      }
    };
    window.addEventListener('daylab:go-to-place', handler);
    return () => window.removeEventListener('daylab:go-to-place', handler);
  }, [places]); // eslint-disable-line

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

    // Helper: get pin color from place type
    const typeColor = (cat) => {
      const t = placeTypes.find(pt => pt.name.toLowerCase() === (cat || '').toLowerCase());
      return t?.color || (isDark ? '#D08828' : '#B87018');
    };

    const filtered = activeFilter
      ? places.filter(p => (p.category || '').toLowerCase() === activeFilter.toLowerCase())
      : places;

    filtered.forEach(place => {
      const color = place.color || typeColor(place.category);
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
        setHoveredPlace(null);
        setAddingPlace(null);
      });
      marker.on('mouseover', () => {
        if (!selectedPlace || selectedPlace.id !== place.id) setHoveredPlace(place);
      });
      marker.on('mouseout', () => setHoveredPlace(null));
      markersRef.current.push(marker);
    });
  }, [places, placeTypes, mode, activeFilter, leafletReady, isDark, selectedPlace]); // eslint-disable-line

  // Current location state — updated by locate button or cached
  const [userLoc, setUserLoc] = useState(() => getCachedLocation());
  const [locating, setLocating] = useState(false);

  // Locate me — request geolocation, fly to position
  // Try without high accuracy first (fast Wi-Fi/IP lookup), fall back to high accuracy
  const locateMe = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    const onSuccess = (pos) => {
      const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      try { localStorage.setItem('daylab:geo', JSON.stringify(loc)); } catch {}
      setUserLoc(loc);
      setLocating(false);
      if (mapInstance.current) {
        mapInstance.current.flyTo([loc.lat, loc.lng], 15, { duration: 0.8 });
      }
    };
    const onError = () => {
      // Fast lookup failed — try high accuracy as fallback
      navigator.geolocation.getCurrentPosition(
        onSuccess,
        () => setLocating(false),
        { timeout: 15000, enableHighAccuracy: true, maximumAge: 300000 }
      );
    };
    navigator.geolocation.getCurrentPosition(
      onSuccess,
      onError,
      { timeout: 5000, enableHighAccuracy: false, maximumAge: 300000 }
    );
  }, []);

  // Render current location marker
  useEffect(() => {
    if (!mapInstance.current || !leafletReady) return;
    const L = LRef.current;
    if (currentLocMarker.current) { currentLocMarker.current.remove(); currentLocMarker.current = null; }
    if (!userLoc) return;
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
    currentLocMarker.current = L.marker([userLoc.lat, userLoc.lng], { icon, interactive: false }).addTo(mapInstance.current);
  }, [userLoc, leafletReady, isDark, mode]);

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

  // Save new place (or discovered area)
  const savePlace = useCallback(async () => {
    if (!addingPlace || !newName.trim() || !token) return;

    if (addingPlace.isArea) {
      // Save as discovered area — cascade city → state → country
      const country = addingPlace.geoCountry || newName.trim();
      const geoType = addingPlace.geoType || 'city';
      const existingNames = new Set(discoveredPlaces.map(p => p.name.toLowerCase()));
      const toSave = [];

      if (!existingNames.has(newName.trim().toLowerCase())) {
        toSave.push({ name: newName.trim(), country, type: geoType, lat: addingPlace.lat, lng: addingPlace.lng });
      }
      if (geoType === 'city' && addingPlace.geoState && !existingNames.has(addingPlace.geoState.toLowerCase())) {
        toSave.push({ name: addingPlace.geoState, country, type: 'state', lat: addingPlace.lat, lng: addingPlace.lng });
      }
      if (geoType !== 'country' && country && !existingNames.has(country.toLowerCase())) {
        toSave.push({ name: country, country, type: 'country', lat: null, lng: null });
      }

      const newPlaces = [];
      for (const item of toSave) {
        const result = await api.post('/api/discovered', item, token);
        if (result?.place) newPlaces.push(result.place);
      }
      if (newPlaces.length > 0) {
        setDiscoveredPlaces(prev => [...prev, ...newPlaces]);
        setDiscoveredCountries(prev => {
          const all = new Set([...prev, ...newPlaces.map(p => p.country)]);
          return [...all];
        });
      }
    } else {
      const result = await api.post('/api/places', {
        lat: addingPlace.lat, lng: addingPlace.lng,
        name: newName.trim(), category: newType || 'pin',
        notes: newNotes.trim() || null,
      }, token);
      if (result?.place) setPlaces(prev => {
        const without = prev.filter(p => p.id !== result.place.id);
        return [result.place, ...without];
      });
    }
    lastGeoRef.current = null;
    setAddingPlace(null);
    setNewName('');
    setNewType('');
    setNewNotes('');
  }, [addingPlace, newName, newType, newNotes, token]);

  // Create new type — auto-assigns next color from palette
  const createType = useCallback(async (name) => {
    const trimmed = (name || newTypeName).trim();
    if (!trimmed || !token) return;
    // Auto-pick the next unused color from the palette
    const usedColors = new Set(placeTypes.map(t => t.color));
    const autoColor = PIN_COLORS.find(c => !usedColors.has(c)) || PIN_COLORS[placeTypes.length % PIN_COLORS.length];
    const result = await api.post('/api/place-types', {
      name: trimmed,
      color: autoColor,
    }, token);
    if (result?.type) {
      setPlaceTypes(prev => [...prev, result.type]);
      setNewType(result.type.name);
    }
    setCreatingType(false);
    setNewTypeName('');
  }, [newTypeName, placeTypes, token]);

  // Delete discovered area (removes all entries for that country)
  const deleteDiscovered = useCallback(async (countryName) => {
    if (!token || !countryName) return;
    await api.post(`/api/discovered?deleteCountry=${encodeURIComponent(countryName)}`, {}, token);
    setDiscoveredPlaces(prev => prev.filter(p => p.country !== countryName));
    setDiscoveredCountries(prev => prev.filter(c => c !== countryName));
  }, [token]);

  const reDiscoverCountry = useCallback(async (countryName) => {
    if (!token || !countryName) return;
    const result = await api.post('/api/discovered', { name: countryName, country: countryName, type: 'country' }, token);
    if (result?.place) {
      setDiscoveredPlaces(prev => [...prev, result.place]);
      setDiscoveredCountries(prev => prev.includes(countryName) ? prev : [...prev, countryName]);
    }
  }, [token]);

  // Edit place
  const [editingPlace, setEditingPlace] = useState(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const startEdit = useCallback((place) => {
    setEditingPlace(place);
    setEditName(place.name);
    setEditType(place.category || '');
    setEditNotes(place.notes || '');
    setSelectedPlace(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingPlace || !editName.trim() || !token) return;
    const oldId = editingPlace.id;
    // Delete old and recreate (simple approach since we don't have PATCH)
    await api.post(`/api/places?delete=${oldId}`, {}, token);
    const result = await api.post('/api/places', {
      lat: editingPlace.lat, lng: editingPlace.lng,
      name: editName.trim(), category: editType || 'pin',
      notes: editNotes.trim() || null,
    }, token);
    if (result?.place) {
      setPlaces(prev => {
        const without = prev.filter(p => p.id !== oldId && p.id !== result.place.id);
        return [...without, result.place];
      });
    }
    setEditingPlace(null);
  }, [editingPlace, editName, editType, editNotes, token]);

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

  // Track last geo search result for area detection
  const lastGeoRef = useRef(null);

  // Navigate to a geocoded result — just fly there, don't add a pin
  const BIG_COUNTRIES = new Set(['united states', 'united states of america', 'china', 'russia', 'canada', 'australia', 'brazil', 'india', 'argentina', 'europe', 'africa', 'asia']);
  const goToGeo = useCallback((result) => {
    if (!mapInstance.current) return;
    const isArea = AREA_GEO_TYPES.has(result.type);
    const isBigCountry = result.type === 'country' && BIG_COUNTRIES.has((result.rawName || result.name || '').toLowerCase());
    const zoom = isBigCountry ? 4 : isArea ? 10 : 16;
    mapInstance.current.flyTo([result.lat, result.lng], zoom, { duration: 0.8 });
    lastGeoRef.current = result;
    setPreviewGeo({ ...result, isArea });
    setAddingPlace(null);
    setSelectedPlace(null);
    setSelectedDiscovered(null);
  }, []);

  // Convert preview to add-place form, pre-filled
  const addFromPreview = useCallback(() => {
    if (!previewGeo) return;
    const g = previewGeo;
    // Guess category from OSM type/key
    const t = (g.type || '').toLowerCase();
    const k = (g.osmKey || '').toLowerCase();
    let guess = '';
    if (['restaurant', 'fast_food', 'food_court', 'bbq'].includes(t) || k === 'restaurant') guess = 'Food';
    else if (['cafe', 'ice_cream', 'bakery', 'confectionery', 'pastry'].includes(t) || k === 'cafe') guess = 'Cafes & Desserts';
    else if (['bar', 'pub', 'biergarten', 'nightclub', 'music_venue', 'theatre', 'cinema', 'arts_centre'].includes(t)) guess = 'Bars & Events';
    else if (['park', 'garden', 'nature_reserve', 'beach', 'swimming_pool', 'sports_centre', 'pitch', 'water_park', 'golf_course'].includes(t) || k === 'leisure') guess = 'Outdoor & Exercise';
    else if (['shop', 'supermarket', 'mall', 'marketplace', 'clothes', 'books', 'department_store'].includes(t) || k === 'shop') guess = 'Stores';
    else if (['museum', 'gallery', 'artwork', 'attraction', 'viewpoint', 'monument', 'memorial', 'castle', 'ruins', 'zoo', 'aquarium', 'theme_park'].includes(t) || k === 'tourism' || k === 'historic') guess = 'Experiences';

    setAddingPlace({ lat: g.lat, lng: g.lng });
    setNewName(g.rawName || g.name.split(',')[0]);
    setNewType(guess);
    setNewNotes(g.fullName || '');
    setPreviewGeo(null);
  }, [previewGeo]);

  // Save area directly from preview card — cascades city → state → country
  const saveAreaFromPreview = useCallback(async () => {
    if (!previewGeo || !token) return;
    const g = previewGeo;
    const name = g.rawName || g.name.split(',')[0];
    const country = g.country || name;
    const geoType = g.type === 'country' ? 'country' : (['state', 'administrative'].includes(g.type) ? 'state' : 'city');

    // Build cascade: city → state/province → country (skip duplicates)
    const toSave = [];
    const existingNames = new Set(discoveredPlaces.map(p => p.name.toLowerCase()));

    // 1. The item itself
    if (!existingNames.has(name.toLowerCase())) {
      toSave.push({ name, country, type: geoType, lat: g.lat, lng: g.lng });
    }
    // 2. State/province (if this is a city and we know the state)
    if (geoType === 'city' && g.state && !existingNames.has(g.state.toLowerCase())) {
      toSave.push({ name: g.state, country, type: 'state', lat: g.lat, lng: g.lng });
    }
    // 3. Country (if not already discovered)
    if (geoType !== 'country' && country && !existingNames.has(country.toLowerCase())) {
      toSave.push({ name: country, country, type: 'country', lat: null, lng: null });
    }

    const newPlaces = [];
    for (const item of toSave) {
      const result = await api.post('/api/discovered', item, token);
      if (result?.place) newPlaces.push(result.place);
    }

    if (newPlaces.length > 0) {
      setDiscoveredPlaces(prev => [...prev, ...newPlaces]);
      setDiscoveredCountries(prev => {
        const all = new Set([...prev, ...newPlaces.map(p => p.country)]);
        return [...all];
      });

      // Animate: expanding circle from the saved location
      if (mapInstance.current && LRef.current) {
        const L = LRef.current;
        const fillColor = isDark ? '#8A7A60' : '#9A8A68';
        const anim = L.divIcon({
          className: '',
          html: `<div style="
            width: 200px; height: 200px; border-radius: 50%;
            background: ${fillColor};
            animation: discoverExpand 0.8s ease-out forwards;
          "></div>`,
          iconSize: [200, 200],
          iconAnchor: [100, 100],
        });
        const marker = L.marker([g.lat, g.lng], { icon: anim, interactive: false }).addTo(mapInstance.current);
        setTimeout(() => marker.remove(), 900);
      }
    }
    lastGeoRef.current = null;
    setPreviewGeo(null);
  }, [previewGeo, token, isDark, discoveredPlaces]);

  // + button: add pin at map center (detect area from last search)
  const addAtCenter = useCallback(() => {
    if (!mapInstance.current) return;
    const c = mapInstance.current.getCenter();
    const geo = lastGeoRef.current;
    const isArea = geo && AREA_GEO_TYPES.has(geo.type);
    if (isArea) {
      const geoType = geo.type === 'country' ? 'country' : (['state', 'administrative'].includes(geo.type) ? 'state' : 'city');
      setAddingPlace({ lat: geo.lat, lng: geo.lng, isArea: true, geoName: geo.rawName || geo.name, geoCountry: geo.country || geo.rawName || geo.name, geoType });
      setNewName(geo.rawName || geo.name);
    } else {
      setAddingPlace({ lat: c.lat, lng: c.lng });
      setNewName('');
    }
    setNewType('');
    setNewNotes('');
    setSelectedPlace(null);
  }, []);

  // ─── Carousel: visible places in current map bounds ──────────────────────
  const carouselRef = useRef(null);
  const dragRef = useRef({ down: false, startX: 0, scrollLeft: 0, moved: false });

  // Static geographic sort using Morton code (Z-order curve).
  // Interleaves lat/lng bits so nearby places on the map are adjacent in the list.
  // This never changes on pan/zoom, so cards don't re-render.
  const visiblePlaces = useMemo(() => {
    if (mode !== 'places') return [];
    // Convert lat/lng to 16-bit unsigned ints, then interleave for a Z-order key
    const mortonKey = (lat, lng) => {
      const x = Math.round(((lng || 0) + 180) / 360 * 0xFFFF) & 0xFFFF;
      const y = Math.round(((lat || 0) + 90) / 180 * 0xFFFF) & 0xFFFF;
      let z = 0;
      for (let i = 15; i >= 0; i--) {
        z = z * 4 + ((x >> i) & 1) * 2 + ((y >> i) & 1);
      }
      return z;
    };
    return places
      .filter(p => {
        if (activeFilter && (p.category || '').toLowerCase() !== activeFilter.toLowerCase()) return false;
        return true;
      })
      .map(p => ({ ...p, _z: mortonKey(p.lat, p.lng) }))
      .sort((a, b) => a._z - b._z);
  }, [places, mode, activeFilter]);

  // Scroll carousel to nearest card — used on pan settle, filter change, and initial load
  const scrollToNearest = useCallback((smooth = true) => {
    const map = mapInstance.current;
    if (!map || !carouselRef.current || !visiblePlaces.length) return;
    const center = map.getCenter();
    let nearest = visiblePlaces[0], bestDist = Infinity;
    for (const p of visiblePlaces) {
      const d = (p.lat - center.lat) ** 2 + (p.lng - center.lng) ** 2;
      if (d < bestDist) { bestDist = d; nearest = p; }
    }
    const container = carouselRef.current;
    const el = container.querySelector(`[data-place-id="${nearest.id}"]`);
    if (!el) return;
    const scrollTarget = el.offsetLeft - (container.clientWidth / 2) + (el.offsetWidth / 2);
    container.scrollTo({ left: scrollTarget, behavior: smooth ? 'smooth' : 'instant' });
  }, [visiblePlaces]);

  // Scroll selected card to center of carousel
  useEffect(() => {
    if (!selectedPlace || !carouselRef.current) return;
    const container = carouselRef.current;
    const el = container.querySelector(`[data-place-id="${selectedPlace.id}"]`);
    if (!el) return;
    const scrollTarget = el.offsetLeft - (container.clientWidth / 2) + (el.offsetWidth / 2);
    container.scrollTo({ left: scrollTarget, behavior: 'smooth' });
  }, [selectedPlace]);

  // Auto-scroll to nearest on filter change and initial load
  useEffect(() => {
    if (selectedPlace) return;
    // Small delay so DOM has rendered the cards
    const t = setTimeout(() => scrollToNearest(false), 100);
    return () => clearTimeout(t);
  }, [visiblePlaces]); // eslint-disable-line

  // Auto-scroll carousel to nearest card when map stops moving
  const idleScrollRef = useRef(null);
  useEffect(() => {
    if (!mapBounds || !carouselRef.current || !visiblePlaces.length || selectedPlace) return;
    clearTimeout(idleScrollRef.current);
    idleScrollRef.current = setTimeout(() => scrollToNearest(true), 600);
    return () => clearTimeout(idleScrollRef.current);
  }, [mapBounds]); // eslint-disable-line

  // Background color to match tiles while loading
  const bgColor = 'var(--dl-bg)';

  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', position: 'relative', height: 520, background: bgColor, userSelect: 'none', WebkitUserSelect: 'none' }}>
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
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes mapPulse {
          0%, 100% { transform: scale(1); opacity: 0.2; }
          50% { transform: scale(1.8); opacity: 0; }
        }
        @keyframes discoverExpand {
          0% { transform: scale(0); opacity: 0.3; }
          60% { transform: scale(1.2); opacity: 0.15; }
          100% { transform: scale(1); opacity: 0; }
        }
        .leaflet-tile-pane {
          filter: ${isDark
            ? 'saturate(0.2) sepia(0.15) brightness(0.7)'
            : 'grayscale(1) sepia(0.55) saturate(0.6) brightness(0.92) contrast(1.05)'
          };
        }
        .leaflet-fade-anim .leaflet-tile { opacity: 0; transition: opacity 0.2s; }
        .leaflet-fade-anim .leaflet-tile-loaded { opacity: 1; }
        /* Match tile background to container so no white flash */
        .leaflet-container { background: ${bgColor} !important; }
        .leaflet-control-zoom {
          border: none !important;
          box-shadow: none !important;
        }
        .leaflet-control-zoom a {
          background: var(--dl-glass) !important;
          backdrop-filter: blur(20px) saturate(1.4) !important;
          -webkit-backdrop-filter: blur(20px) saturate(1.4) !important;
          color: var(--dl-highlight) !important;
          border: 1px solid var(--dl-glass-border) !important;
          font-family: ${mono} !important;
          box-shadow: var(--dl-glass-shadow) !important;
        }
        .leaflet-control-zoom a:hover { background: var(--dl-glass-active) !important; color: var(--dl-strong) !important; }
      `}</style>

      {/* Locate me button — above zoom controls, bottom right */}
      <button onClick={locateMe} title="Find my location"
        style={{
          position: 'absolute', bottom: 80, right: 10, zIndex: 1000,
          width: 30, height: 30,
          background: 'var(--dl-glass)',
          backdropFilter: 'blur(20px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
          border: '1px solid var(--dl-glass-border)',
          borderRadius: 4, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: locating ? 'var(--dl-accent)' : 'var(--dl-highlight)',
          boxShadow: 'var(--dl-glass-shadow)',
          transition: 'color 0.15s',
        }}>
        {locating ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
            <circle cx="12" cy="12" r="10"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
          </svg>
        )}
      </button>

      {/* Top bar: mode toggle (left) + search pill (center) + add button (right) */}
      <div style={{
        position: 'absolute', top: 10, left: 10, right: 10, zIndex: 1000,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {/* Mode toggle — glassmorphic pill */}
        <div style={{
          display: 'flex', gap: 1,
          backdropFilter: 'blur(20px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
          background: 'var(--dl-glass)',
          border: '1px solid var(--dl-glass-border)',
          borderRadius: 100, padding: 3, flexShrink: 0,
          boxShadow: 'var(--dl-glass-shadow)',
        }}>
          <button onClick={() => { setMode('places'); setAddingPlace(null); setSelectedPlace(null); }}
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
          <button onClick={() => { setMode('timeline'); setAddingPlace(null); setSelectedPlace(null); }}
            title="Location timeline"
            style={{
              background: mode === 'timeline' ? 'var(--dl-accent-15)' : 'none',
              border: 'none', borderRadius: 100, padding: '5px 8px', cursor: 'pointer',
              color: mode === 'timeline' ? 'var(--dl-accent)' : 'var(--dl-middle)',
              display: 'flex', alignItems: 'center', transition: 'all 0.15s',
            }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </button>
        </div>

        {/* Search pill */}
        <MapSearch places={places} onSelect={goToPlace} onGeoSelect={goToGeo} isDark={isDark} mapInstance={mapInstance} />

        {/* + Add pin button — glassmorphic */}
        {mode === 'places' && (
          <button onClick={addAtCenter}
            title="Add a pin"
            style={{
              backdropFilter: 'blur(20px) saturate(1.4)',
              WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
              background: 'var(--dl-glass)',
              border: '1px solid var(--dl-glass-border)',
              borderRadius: 100, padding: '6px 8px', cursor: 'pointer',
              color: 'var(--dl-accent)', display: 'flex', alignItems: 'center',
              flexShrink: 0, boxShadow: 'var(--dl-glass-shadow)',
              transition: 'all 0.15s',
            }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        )}
      </div>

      {/* Type filter pills — below top bar */}
      {mode === 'places' && placeTypes.length > 0 && (
        <div style={{
          position: 'absolute', top: 50, left: 10, right: 10, zIndex: 999,
          display: 'flex', gap: 4, flexWrap: 'wrap',
        }}>
          <button onClick={() => setActiveFilter(null)}
            style={{
              backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
              background: !activeFilter ? 'var(--dl-accent-20)' : 'var(--dl-glass)',
              border: `1px solid ${!activeFilter ? 'var(--dl-accent)' : 'var(--dl-glass-border)'}`,
              borderRadius: 100, padding: '3px 10px', cursor: 'pointer',
              fontFamily: mono, fontSize: 10, letterSpacing: '0.06em',
              color: !activeFilter ? 'var(--dl-accent)' : 'var(--dl-middle)',
              textTransform: 'uppercase',
            }}>
            All
          </button>
          {placeTypes.map(t => (
            <button key={t.id} onClick={() => setActiveFilter(activeFilter === t.name ? null : t.name)}
              style={{
                backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
                background: activeFilter === t.name ? t.color + '33' : 'var(--dl-glass)',
                border: `1px solid ${activeFilter === t.name ? t.color : 'var(--dl-glass-border)'}`,
                borderRadius: 100, padding: '3px 10px', cursor: 'pointer',
                fontFamily: mono, fontSize: 10, letterSpacing: '0.06em',
                color: activeFilter === t.name ? t.color : 'var(--dl-middle)',
                textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4,
              }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
              {t.name}
            </button>
          ))}
        </div>
      )}

      {/* ─── Map Bottom Strip ─── */}
      <MapBottomStrip collapsed={bottomCollapsed} onToggle={() => setBottomCollapsed(c => !c)}>

      {/* Place carousel */}
      {visiblePlaces.length > 0 && !addingPlace && !editingPlace && !previewGeo && !selectedDiscovered && (
        <div style={{ pointerEvents: 'none' }}>
          <div ref={carouselRef}
            onMouseDown={e => {
              const d = dragRef.current;
              d.down = true; d.moved = false;
              d.startX = e.clientX;
              d.scrollLeft = carouselRef.current.scrollLeft;
            }}
            onMouseMove={e => {
              const d = dragRef.current;
              if (!d.down) return;
              e.preventDefault();
              const dx = e.clientX - d.startX;
              if (Math.abs(dx) > 5) d.moved = true;
              carouselRef.current.scrollLeft = d.scrollLeft - dx;
            }}
            onMouseUp={() => { dragRef.current.down = false; }}
            onMouseLeave={() => { dragRef.current.down = false; }}
            style={{
            display: 'flex', gap: 8, padding: '0 10px',
            overflowX: 'auto', overflowY: 'hidden',
            scrollbarWidth: 'none', msOverflowStyle: 'none',
            pointerEvents: 'auto', userSelect: 'none', WebkitUserSelect: 'none',
            cursor: 'grab',
          }}>
            {visiblePlaces.map(place => {
              const isSelected = selectedPlace?.id === place.id;
              const isHovered = hoveredPlace?.id === place.id;
              const typeObj = placeTypes.find(pt => pt.name.toLowerCase() === (place.category || '').toLowerCase());
              const color = place.color || typeObj?.color || 'var(--dl-accent)';
              return (
                <div
                  key={place.id}
                  data-place-id={place.id}
                  onClick={() => {
                    if (dragRef.current.moved) { dragRef.current.moved = false; return; }
                    setSelectedPlace(isSelected ? null : place);
                    if (!isSelected && mapInstance.current) {
                      mapInstance.current.panTo([place.lat, place.lng], { animate: true, duration: 0.4 });
                    }
                  }}
                  onMouseEnter={() => setHoveredPlace(place)}
                  onMouseLeave={() => setHoveredPlace(null)}
                  style={{
                    flexShrink: 0, width: 110, height: 100,
                    backdropFilter: 'blur(20px) saturate(1.4)',
                    WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
                    background: 'var(--dl-glass)', borderRadius: 12, padding: 10,
                    border: `1.5px solid ${isSelected ? color : color + '40'}`,
                    boxShadow: 'var(--dl-glass-shadow)',
                    cursor: 'pointer', transition: 'border-color 0.15s, opacity 0.15s',
                    opacity: isSelected ? 1 : isHovered ? 0.95 : 0.85,
                    display: 'flex', flexDirection: 'column',
                  }}
                >
                  {/* Name — primary */}
                  <div style={{
                    fontFamily: mono, fontSize: 11, fontWeight: 600,
                    color: 'var(--dl-strong)', letterSpacing: '0.02em', lineHeight: 1.3,
                    overflow: 'hidden', display: '-webkit-box',
                    WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                  }}>
                    {place.name}
                  </div>
                  {/* Description */}
                  {place.notes && (
                    <div style={{
                      fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)', marginTop: 4,
                      overflow: 'hidden', display: '-webkit-box',
                      WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.3,
                      flex: 1,
                    }}>
                      {place.notes}
                    </div>
                  )}
                  {!place.notes && <div style={{ flex: 1 }} />}
                  {/* Edit/Delete icons — bottom right, selected only */}
                  {isSelected && (
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button onClick={e => { e.stopPropagation(); startEdit(place); }} title="Edit"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--dl-highlight)', display: 'flex' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <button onClick={e => { e.stopPropagation(); deletePlace(place.id); }} title="Delete"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--dl-red)', display: 'flex' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add-place popup */}
      {addingPlace && mode === 'places' && !editingPlace && (
        <div
          onKeyDown={e => { if (e.key === 'Enter' && !creatingType && newName.trim()) savePlace(); }}
          style={{
            margin: '0 2px',
            background: 'var(--dl-bg)', borderRadius: 10,
            border: '1px solid var(--dl-border)',
            padding: '10px 14px',
            boxShadow: 'var(--dl-shadow)',
          }}>
          {addingPlace.isArea && (
            <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--dl-accent)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
              Mark as discovered area
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: addingPlace.isArea ? 0 : 8 }}>
            <input autoFocus value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') savePlace(); if (e.key === 'Escape') setAddingPlace(null); }}
              placeholder={addingPlace.isArea ? 'Area name...' : 'Name this place...'}
              style={{ flex: 1, background: 'var(--dl-well)', border: '1px solid var(--dl-border)', borderRadius: 6, padding: '6px 10px', fontFamily: mono, fontSize: F.sm, color: 'var(--dl-strong)', outline: 'none', letterSpacing: '0.03em' }}
            />
            <button onClick={savePlace} style={{ background: 'var(--dl-accent)', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontFamily: mono, fontSize: F.sm, fontWeight: 600, color: '#fff', letterSpacing: '0.04em' }}>Save</button>
            <button onClick={() => { setAddingPlace(null); lastGeoRef.current = null; }} style={{ background: 'none', border: '1px solid var(--dl-border)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontFamily: mono, fontSize: F.sm, color: 'var(--dl-middle)' }}>&times;</button>
          </div>
          {!addingPlace.isArea && (
            <>
              <input value={newNotes} onChange={e => setNewNotes(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') savePlace(); if (e.key === 'Escape') setAddingPlace(null); }}
                placeholder="Description (optional)"
                style={{ width: '100%', background: 'var(--dl-well)', border: '1px solid var(--dl-border)', borderRadius: 6, padding: '5px 10px', marginBottom: 8, fontFamily: mono, fontSize: F.sm - 1, color: 'var(--dl-strong)', outline: 'none', letterSpacing: '0.03em', boxSizing: 'border-box' }}
              />
              {/* Type selector */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                {placeTypes.map(t => (
                  <button key={t.id} onClick={() => setNewType(newType === t.name ? '' : t.name)}
                    style={{
                      background: newType === t.name ? t.color + '22' : 'var(--dl-well)',
                      border: `1px solid ${newType === t.name ? t.color : 'var(--dl-border)'}`,
                      borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
                      fontSize: 11, color: newType === t.name ? t.color : 'var(--dl-strong)',
                      fontFamily: mono, letterSpacing: '0.04em',
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.color }} />
                    {t.name}
                  </button>
                ))}
                {/* New type — inline input, Enter creates with auto-color */}
                {creatingType ? (
                  <input autoFocus value={newTypeName} onChange={e => setNewTypeName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && newTypeName.trim()) createType(); if (e.key === 'Escape') setCreatingType(false); }}
                    onBlur={() => { if (newTypeName.trim()) createType(); else setCreatingType(false); }}
                    placeholder="Label name…"
                    style={{ width: 100, background: 'var(--dl-well)', border: '1px solid var(--dl-border)', borderRadius: 6, padding: '3px 8px', fontFamily: mono, fontSize: 11, color: 'var(--dl-strong)', outline: 'none', letterSpacing: '0.04em' }}
                  />
                ) : (
                  <button onClick={() => setCreatingType(true)}
                    style={{ background: 'none', border: '1px dashed var(--dl-border)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 11, color: 'var(--dl-middle)', fontFamily: mono, letterSpacing: '0.04em' }}>
                    + Label
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Edit place panel — glassmorphic bottom bar */}
      {editingPlace && (
        <div
          onKeyDown={e => { if (e.key === 'Enter') { saveEdit(); setEditingPlace(null); } if (e.key === 'Escape') setEditingPlace(null); }}
          style={{
            position: 'absolute', bottom: 12, left: 12, right: 12, zIndex: 1000,
            backdropFilter: 'blur(20px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
            background: 'var(--dl-glass)',
            border: '1px solid var(--dl-glass-border)',
            borderRadius: 14,
            padding: '12px 16px',
            boxShadow: 'var(--dl-shadow)',
          }}>
          {/* Header row: label + save/cancel */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Edit place
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => { saveEdit(); setEditingPlace(null); }}
                style={{ background: 'var(--dl-accent)', border: 'none', borderRadius: 6, padding: '5px 14px', cursor: 'pointer', fontFamily: mono, fontSize: F.sm, fontWeight: 600, color: '#fff', letterSpacing: '0.04em' }}>
                Save
              </button>
              <button onClick={() => setEditingPlace(null)}
                style={{ background: 'none', border: '1px solid var(--dl-glass-border)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontFamily: mono, fontSize: F.sm, color: 'var(--dl-middle)' }}>
                &times;
              </button>
            </div>
          </div>
          {/* Name input */}
          <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
            placeholder="Place name"
            style={{ width: '100%', background: 'var(--dl-well)', border: '1px solid var(--dl-border)', borderRadius: 8, padding: '8px 12px', marginBottom: 8, fontFamily: mono, fontSize: F.sm, color: 'var(--dl-strong)', outline: 'none', letterSpacing: '0.03em', boxSizing: 'border-box' }}
          />
          {/* Description input */}
          <input value={editNotes} onChange={e => setEditNotes(e.target.value)}
            placeholder="Description (optional)"
            style={{ width: '100%', background: 'var(--dl-well)', border: '1px solid var(--dl-border)', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontFamily: mono, fontSize: F.sm - 1, color: 'var(--dl-strong)', outline: 'none', letterSpacing: '0.03em', boxSizing: 'border-box' }}
          />
          {/* Type selector — full labeled pills */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {placeTypes.map(t => (
              <button key={t.id} onClick={() => setEditType(editType === t.name ? '' : t.name)}
                style={{
                  background: editType === t.name ? t.color + '22' : 'var(--dl-well)',
                  border: `1.5px solid ${editType === t.name ? t.color : 'var(--dl-border)'}`,
                  borderRadius: 100, padding: '4px 12px', cursor: 'pointer',
                  fontFamily: mono, fontSize: 11, letterSpacing: '0.04em',
                  color: editType === t.name ? t.color : 'var(--dl-highlight)',
                  display: 'flex', alignItems: 'center', gap: 5,
                  transition: 'all 0.12s',
                }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search result preview card */}
      {previewGeo && mode === 'places' && !addingPlace && !editingPlace && !selectedPlace && (
        <div style={{
          margin: '0 2px',
          background: 'var(--dl-overlay)',
          backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          borderRadius: 10,
          border: '1px solid var(--dl-overlay-border)',
          padding: '10px 14px',
          boxShadow: 'var(--dl-overlay-shadow)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', minWidth: 0 }}>
              {previewGeo.isArea ? (() => {
                const pn = (previewGeo.rawName || previewGeo.name.split(',')[0]).trim().toLowerCase();
                const disc = discoveredPlaces.some(p => p.name.trim().toLowerCase() === pn || pn.includes(p.name.trim().toLowerCase()));
                return (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill={disc ? 'var(--dl-accent)' : 'none'} stroke={disc ? 'var(--dl-accent)' : 'var(--dl-middle)'} strokeWidth="2" style={{ flexShrink: 0, opacity: disc ? 0.7 : 0.6 }}>
                    <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/>
                  </svg>
                );
              })() : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--dl-middle)" strokeWidth="2" style={{ flexShrink: 0, opacity: 0.5 }}>
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                </svg>
              )}
              <span style={{ fontFamily: mono, fontSize: F.md, fontWeight: 600, color: 'var(--dl-strong)', letterSpacing: '0.03em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {previewGeo.rawName || previewGeo.name.split(',')[0]}
              </span>
              {previewGeo.type && (() => {
                const pName = (previewGeo.rawName || previewGeo.name.split(',')[0]).trim().toLowerCase();
                const isDiscovered = previewGeo.isArea && discoveredPlaces.some(p => p.name.trim().toLowerCase() === pName || pName.includes(p.name.trim().toLowerCase()));
                return (
                  <span style={{ fontFamily: mono, fontSize: 10, color: isDiscovered ? 'var(--dl-accent)' : 'var(--dl-middle)', letterSpacing: '0.06em', textTransform: 'uppercase', flexShrink: 0 }}>
                    {isDiscovered ? 'discovered' : previewGeo.isArea ? (previewGeo.type === 'city' || previewGeo.type === 'town' ? 'city' : previewGeo.type) : previewGeo.type}
                  </span>
                );
              })()}
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {previewGeo.isArea ? (() => {
                const previewName = (previewGeo.rawName || previewGeo.name.split(',')[0]).trim().toLowerCase();
                const existing = discoveredPlaces.find(p => p.name.trim().toLowerCase() === previewName || previewName.includes(p.name.trim().toLowerCase()));
                return existing ? (
                  <button onClick={async () => {
                    if (!token) return;
                    await api.post(`/api/discovered?delete=${existing.id}`, {}, token);
                    setDiscoveredPlaces(prev => prev.filter(p => p.id !== existing.id));
                    const country = existing.country;
                    const stillHasCountry = discoveredPlaces.some(p => p.id !== existing.id && p.country === country);
                    if (!stillHasCountry) setDiscoveredCountries(prev => prev.filter(c => c !== country));
                  }}
                    style={{ background: 'none', border: '1px solid var(--dl-border)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontFamily: mono, fontSize: F.sm - 1, fontWeight: 600, color: 'var(--dl-red)', letterSpacing: '0.04em' }}>
                    Remove
                  </button>
                ) : (
                  <button onClick={saveAreaFromPreview}
                    style={{ background: 'var(--dl-accent)', border: 'none', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontFamily: mono, fontSize: F.sm - 1, fontWeight: 600, color: '#fff', letterSpacing: '0.04em' }}>
                    Mark discovered
                  </button>
                );
              })() : (
                <button onClick={addFromPreview}
                  style={{ background: 'var(--dl-accent)', border: 'none', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontFamily: mono, fontSize: F.sm - 1, fontWeight: 600, color: '#fff', letterSpacing: '0.04em' }}>
                  + Save pin
                </button>
              )}
              <button onClick={() => setPreviewGeo(null)}
                style={{ background: 'none', border: '1px solid var(--dl-border)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontFamily: mono, fontSize: F.sm, color: 'var(--dl-middle)' }}>
                &times;
              </button>
            </div>
          </div>
          {previewGeo.fullName && (
            <div style={{ fontFamily: mono, fontSize: F.sm, color: 'var(--dl-middle)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {previewGeo.fullName}
            </div>
          )}
        </div>
      )}

      {/* Selected discovered area */}
      {selectedDiscovered && mode === 'places' && !editingPlace && !addingPlace && (() => {
        const isDisc = discoveredCountries.includes(selectedDiscovered);
        return (
        <div style={{
          margin: '0 2px',
          background: 'var(--dl-overlay)',
          backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          borderRadius: 10,
          border: '1px solid var(--dl-overlay-border)',
          padding: '10px 14px',
          boxShadow: 'var(--dl-overlay-shadow)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: mono, fontSize: F.md, fontWeight: 600, color: 'var(--dl-strong)', letterSpacing: '0.03em' }}>
                {selectedDiscovered}
              </span>
              {isDisc && (
                <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  discovered
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {isDisc ? (
                <button onClick={() => deleteDiscovered(selectedDiscovered)}
                  style={{ background: 'none', border: '1px solid var(--dl-border)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontFamily: mono, fontSize: F.sm - 1, fontWeight: 600, color: 'var(--dl-red)', letterSpacing: '0.04em' }}>
                  Remove
                </button>
              ) : (
                <button onClick={() => reDiscoverCountry(selectedDiscovered)}
                  style={{ background: 'var(--dl-accent)', border: 'none', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontFamily: mono, fontSize: F.sm - 1, fontWeight: 600, color: '#fff', letterSpacing: '0.04em' }}>
                  Mark discovered
                </button>
              )}
              <button onClick={() => setSelectedDiscovered(null)}
                style={{ background: 'none', border: '1px solid var(--dl-border)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontFamily: mono, fontSize: F.sm, color: 'var(--dl-middle)' }}>
                &times;
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      </MapBottomStrip>
      {/* No separate tooltip or selected popup — carousel handles all place interactions */}
    </div>
  );
}

const MapInnerNoSSR = dynamic(() => Promise.resolve(MapInner), { ssr: false });

export default function WorldMapCard({ token }) {
  return <MapInnerNoSSR token={token} />;
}
