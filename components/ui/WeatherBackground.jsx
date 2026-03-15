"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  getSunAltitude, getDayPhase, getWeatherGradient,
  getUserLocation, getCachedLocation, DEFAULT_LOCATION,
  fetchWeather,
} from "@/lib/weather";

// ─── WeatherBackground ──────────────────────────────────────────────────────
// Renders a full-screen gradient background that adapts to:
//   1. Time of day (solar position — updates live)
//   2. Weather conditions (via Open-Meteo API)
//   3. Selected date (past dates use historical weather, pinned to midday)
//
// Designed to be subtle and ambient — this isn't a weather app, it's a mood.

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function WeatherBackground({ date, theme }) {
  const [gradient, setGradient] = useState(null);
  const [condition, setCondition] = useState('clear');
  const locRef = useRef(getCachedLocation() || DEFAULT_LOCATION);
  const frameRef = useRef(null);
  const prevGradientRef = useRef(null);

  // Fetch user location once
  useEffect(() => {
    getUserLocation().then(loc => {
      if (loc) locRef.current = loc;
    });
  }, []);

  // Fetch weather for the selected date
  useEffect(() => {
    const loc = locRef.current;
    fetchWeather(date, loc.lat, loc.lng).then(w => {
      if (w) setCondition(w.condition);
      else setCondition('clear'); // fallback
    });
  }, [date]);

  // Compute gradient — live updates for today, static for past dates
  const computeGradient = useCallback(() => {
    const loc = locRef.current;
    const isToday = date === todayStr();

    let phase;
    if (isToday) {
      // Live: use current real time
      phase = getDayPhase(new Date(), loc.lat, loc.lng);
    } else {
      // Past/future: pin to midday for that date's weather
      const midday = new Date(date + 'T12:00:00');
      phase = getDayPhase(midday, loc.lat, loc.lng);
    }

    const [top, bottom] = getWeatherGradient(condition, phase);

    // Apply theme influence: dark mode darkens the gradient, light mode brightens
    // This keeps the gradient harmonious with card colors
    return { top, bottom };
  }, [date, condition]);

  // Animation loop — updates gradient smoothly
  useEffect(() => {
    let active = true;

    function tick() {
      if (!active) return;
      const g = computeGradient();
      setGradient(g);
      // Only animate live for today (time changes); past dates are static
      if (date === todayStr()) {
        frameRef.current = setTimeout(tick, 60000); // update every minute
      }
    }

    tick();
    return () => { active = false; clearTimeout(frameRef.current); };
  }, [computeGradient, date]);

  if (!gradient) return null;

  // Smooth transition between gradients
  const bg = `linear-gradient(180deg, ${gradient.top} 0%, ${gradient.bottom} 100%)`;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 0,
        background: bg,
        transition: 'background 2s ease',
        pointerEvents: 'none',
      }}
    />
  );
}
