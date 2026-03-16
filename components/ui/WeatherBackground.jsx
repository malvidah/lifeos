"use client";
import { useState, useEffect, useRef } from "react";
import {
  getDayPhase, getWeatherGradient,
  getUserLocation, getCachedLocation, DEFAULT_LOCATION,
  fetchWeather,
} from "@/lib/weather";

// ─── WeatherBackground ──────────────────────────────────────────────────────
// Two stacked divs cross-fade via opacity (CSS can't transition gradients).
// Current gradient is always fully visible; previous fades out behind it.

export default function WeatherBackground({ date }) {
  const locRef = useRef(getCachedLocation() || DEFAULT_LOCATION);
  const [bg, setBg] = useState(null);       // current gradient string
  const [prevBg, setPrevBg] = useState(null); // previous (fading out)
  const conditionRef = useRef('clear');

  // Fetch user location once
  useEffect(() => {
    getUserLocation().then(loc => { if (loc) locRef.current = loc; });
  }, []);

  // Compute gradient from current time + weather condition
  function computeBg(cond) {
    const loc = locRef.current;
    const phase = getDayPhase(new Date(), loc.lat, loc.lng);
    const [top, bottom] = getWeatherGradient(cond || 'clear', phase);
    return `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`;
  }

  // When date changes, fetch weather and update gradient
  useEffect(() => {
    const loc = locRef.current;
    fetchWeather(date, loc.lat, loc.lng).then(w => {
      conditionRef.current = w?.condition || 'clear';
      const next = computeBg(conditionRef.current);
      setBg(prev => {
        if (prev) setPrevBg(prev); // stash old gradient for cross-fade
        return next;
      });
    });
  }, [date]); // eslint-disable-line

  // Live tick — update gradient every 60s for time-of-day shifts
  useEffect(() => {
    // Initial render
    setBg(computeBg(conditionRef.current));

    const id = setInterval(() => {
      const next = computeBg(conditionRef.current);
      setBg(prev => {
        if (prev && prev !== next) setPrevBg(prev);
        return next;
      });
    }, 60000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line

  // Clear prevBg after transition completes (2s)
  useEffect(() => {
    if (!prevBg) return;
    const id = setTimeout(() => setPrevBg(null), 2500);
    return () => clearTimeout(id);
  }, [prevBg]);

  if (!bg) return null;

  const layer = {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    pointerEvents: 'none',
  };

  return (
    <div aria-hidden="true" style={{position:'absolute',inset:0,zIndex:0,pointerEvents:'none',overflow:'hidden'}}>
      {/* New gradient — sits behind, always fully visible */}
      <div style={{...layer, background: bg}}/>
      {/* Previous gradient — sits on top, fades out to reveal new one */}
      {prevBg && (
        <div key={prevBg} style={{...layer, background: prevBg, animation: 'weatherFadeOut 2s ease forwards'}}/>
      )}
      <style>{`@keyframes weatherFadeOut { from { opacity: 1; } to { opacity: 0; } }`}</style>
    </div>
  );
}
