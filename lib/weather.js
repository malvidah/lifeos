// ─── Weather data + solar position for ambient background ────────────────────
// No API key required. Uses Open-Meteo (free, open-source).
// Solar position is pure math — no API needed for time-of-day gradients.

const CACHE = new Map();
const CACHE_TTL_CURRENT = 30 * 60 * 1000; // 30 min for today
const CACHE_TTL_PAST    = 24 * 60 * 60 * 1000; // 24h for past dates (won't change)

// ─── Solar position (pure math) ──────────────────────────────────────────────
// Returns sun altitude (0 = horizon, 90 = overhead, negative = below horizon)
// and a normalized "daylight fraction" from 0 (midnight) to 1 (solar noon).

export function getSunAltitude(date, lat, lng) {
  const d = date instanceof Date ? date : new Date(date);
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  // Use UTC hours + timezone offset so longitude-based solar noon works correctly
  const utcHour = d.getUTCHours() + d.getUTCMinutes() / 60;

  // Solar declination (simplified)
  const declination = -23.45 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
  const decRad = declination * Math.PI / 180;
  const latRad = lat * Math.PI / 180;

  // Hour angle (15 degrees per hour from solar noon in UTC)
  // Solar noon in UTC ≈ 12 - longitude/15
  const solarNoonUTC = 12 - lng / 15;
  const hourAngle = (utcHour - solarNoonUTC) * 15;
  const haRad = hourAngle * Math.PI / 180;

  // Solar altitude angle
  const sinAlt = Math.sin(latRad) * Math.sin(decRad) +
                 Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * 180 / Math.PI;

  return altitude;
}

// Returns { light: 0-1, rising: bool } for gradient interpolation.
// light = sun brightness (0 = deep night, 1 = full day)
// rising = true before solar noon, false after (distinguishes dawn from dusk)
export function getDayPhase(date, lat, lng) {
  const d = date instanceof Date ? date : new Date(date);
  const hour = d.getHours() + d.getMinutes() / 60;
  const alt = getSunAltitude(date, lat, lng);

  const light = alt < -12 ? 0
    : alt < 0 ? (alt + 12) / 12 * 0.3
    : alt < 8 ? 0.3 + (alt / 8) * 0.2
    : Math.min(1, 0.5 + (alt - 8) / 44 * 0.5);

  return { light, rising: hour <= 12 };
}

// ─── Weather condition mapping ───────────────────────────────────────────────
// Open-Meteo WMO weather codes → simple condition types

const WMO_MAP = {
  0: 'clear', 1: 'clear', 2: 'cloudy', 3: 'overcast',
  45: 'fog', 48: 'fog',
  51: 'drizzle', 53: 'drizzle', 55: 'drizzle',
  56: 'drizzle', 57: 'drizzle',
  61: 'rain', 63: 'rain', 65: 'rain',
  66: 'rain', 67: 'rain',
  71: 'snow', 73: 'snow', 75: 'snow', 77: 'snow',
  80: 'rain', 81: 'rain', 82: 'rain',
  85: 'snow', 86: 'snow',
  95: 'thunderstorm', 96: 'thunderstorm', 99: 'thunderstorm',
};

export function weatherCodeToCondition(code) {
  return WMO_MAP[code] ?? 'clear';
}

// ─── Gradient palettes ───────────────────────────────────────────────────────
// Each condition has gradients for different day phases.
// Format: [topColor, bottomColor] — the background is a vertical linear gradient.

const PALETTES = {
  clear: {
    night:   ['#0a0e1a', '#141825'],
    twilight:['#1a1530', '#2d2040'],
    dawn:    ['#2a1a2e', '#c47840'],
    day:     ['#8ab4d0', '#d4c8a8'],
    dusk:    ['#4a2838', '#d08848'],
  },
  cloudy: {
    night:   ['#0e1018', '#1a1c24'],
    twilight:['#1c1a28', '#2a2838'],
    dawn:    ['#3a3040', '#a08868'],
    day:     ['#8898a0', '#b8b0a0'],
    dusk:    ['#4a3840', '#a88068'],
  },
  overcast: {
    night:   ['#0c0e14', '#181a20'],
    twilight:['#1a1820', '#282830'],
    dawn:    ['#383840', '#888078'],
    day:     ['#787880', '#a0a098'],
    dusk:    ['#3a3438', '#887868'],
  },
  rain: {
    night:   ['#080a12', '#12141c'],
    twilight:['#141420', '#222230'],
    dawn:    ['#282830', '#686068'],
    day:     ['#586068', '#808890'],
    dusk:    ['#2a2430', '#686070'],
  },
  drizzle: {
    night:   ['#0a0c14', '#14161e'],
    twilight:['#161422', '#242832'],
    dawn:    ['#2a2830', '#787078'],
    day:     ['#6a7880', '#989898'],
    dusk:    ['#2c2630', '#706870'],
  },
  snow: {
    night:   ['#101418', '#1a2028'],
    twilight:['#1c2030', '#303848'],
    dawn:    ['#384050', '#8890a0'],
    day:     ['#90a0b8', '#c8c8d0'],
    dusk:    ['#384058', '#8888a0'],
  },
  fog: {
    night:   ['#0e1014', '#181c20'],
    twilight:['#1c1e24', '#2a2e34'],
    dawn:    ['#383c40', '#787878'],
    day:     ['#808888', '#a8a8a0'],
    dusk:    ['#343438', '#787070'],
  },
  thunderstorm: {
    night:   ['#060810', '#0e1018'],
    twilight:['#100e18', '#1c1a28'],
    dawn:    ['#201c28', '#484050'],
    day:     ['#404858', '#606870'],
    dusk:    ['#1c1820', '#484050'],
  },
};

// Interpolate between two hex colors (t = 0-1)
function lerpColor(a, b, t) {
  const pa = [parseInt(a.slice(1,3),16), parseInt(a.slice(3,5),16), parseInt(a.slice(5,7),16)];
  const pb = [parseInt(b.slice(1,3),16), parseInt(b.slice(3,5),16), parseInt(b.slice(5,7),16)];
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${bl.toString(16).padStart(2,'0')}`;
}

// Get gradient colors for a given condition + { light, rising } phase
export function getWeatherGradient(condition, phase) {
  const pal = PALETTES[condition] || PALETTES.clear;
  const { light, rising } = typeof phase === 'object' ? phase : { light: phase, rising: true };

  // Map light level (0-1) to palette stops.
  // Morning uses dawn, afternoon uses dusk for the warm-color phase.
  const warmKey = rising ? 'dawn' : 'dusk';
  let fromKey, toKey, t;
  if (light < 0.1) {
    fromKey = 'night'; toKey = 'twilight'; t = light / 0.1;
  } else if (light < 0.3) {
    fromKey = 'twilight'; toKey = warmKey; t = (light - 0.1) / 0.2;
  } else if (light < 0.5) {
    fromKey = warmKey; toKey = 'day'; t = (light - 0.3) / 0.2;
  } else {
    fromKey = 'day'; toKey = 'day'; t = 0; // full daylight
  }

  t = Math.max(0, Math.min(1, t));
  const from = pal[fromKey];
  const to = pal[toKey];
  return [lerpColor(from[0], to[0], t), lerpColor(from[1], to[1], t)];
}

// ─── Location ────────────────────────────────────────────────────────────────

const LOC_KEY = 'daylab:geo';

export function getCachedLocation() {
  try {
    const s = localStorage.getItem(LOC_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

export async function getUserLocation() {
  const cached = getCachedLocation();
  if (cached) return cached;

  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        try { localStorage.setItem(LOC_KEY, JSON.stringify(loc)); } catch {}
        resolve(loc);
      },
      () => resolve(null),
      { timeout: 8000, maximumAge: 3600000 }
    );
  });
}

// Default: San Francisco (neutral latitude for decent gradients)
export const DEFAULT_LOCATION = { lat: 37.77, lng: -122.42 };

// ─── Weather API ─────────────────────────────────────────────────────────────

export async function fetchWeather(date, lat, lng) {
  const key = `${date}:${lat.toFixed(2)}:${lng.toFixed(2)}`;
  const cached = CACHE.get(key);
  const now = Date.now();
  if (cached && now - cached.ts < (date === todayStr() ? CACHE_TTL_CURRENT : CACHE_TTL_PAST)) {
    return cached.data;
  }

  try {
    const isToday = date === todayStr();
    const isFuture = date > todayStr();
    let url;
    if (isToday) {
      // Current real-time data
      url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=weather_code,temperature_2m&temperature_unit=fahrenheit&timezone=auto`;
    } else if (isFuture) {
      // Forecast for a specific future date
      url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&start_date=${date}&end_date=${date}&daily=weather_code,temperature_2m_max&temperature_unit=fahrenheit&timezone=auto`;
    } else {
      // Historical archive
      url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${date}&end_date=${date}&daily=weather_code,temperature_2m_max&temperature_unit=fahrenheit&timezone=auto`;
    }

    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();

    let code, temperature;
    if (isToday) {
      code = json.current?.weather_code ?? 0;
      temperature = json.current?.temperature_2m ?? null;
    } else {
      code = json.daily?.weather_code?.[0] ?? 0;
      temperature = json.daily?.temperature_2m_max?.[0] ?? null;
    }

    const data = { code, condition: weatherCodeToCondition(code), temperature };
    CACHE.set(key, { data, ts: now });
    return data;
  } catch {
    return null;
  }
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
