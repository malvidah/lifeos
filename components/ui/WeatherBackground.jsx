"use client";
import { useState, useEffect, useRef } from "react";
import {
  getDayPhase, getWeatherGradient,
  getUserLocation, getCachedLocation, DEFAULT_LOCATION,
  fetchWeather,
} from "@/lib/weather";

// Compute a CSS gradient string from weather condition + time of day.
// For today: uses real current time. For other dates: uses solar noon (brightest).
function makeBg(condition, lat, lng, date) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const timeRef = (date && date !== todayStr)
    ? new Date(date + 'T12:00:00') // noon for past/future dates
    : today;
  const phase = getDayPhase(timeRef, lat, lng);
  const [top, bottom] = getWeatherGradient(condition || 'clear', phase);
  return `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`;
}

export default function WeatherBackground({ date }) {
  const dateRef = useRef(date);
  dateRef.current = date;
  const locRef = useRef(getCachedLocation() || DEFAULT_LOCATION);
  if (!locRef.current) locRef.current = DEFAULT_LOCATION;
  const [bg, setBg] = useState(() => makeBg('clear', locRef.current.lat, locRef.current.lng, date));
  const [fadingBg, setFadingBg] = useState(null);
  const condRef = useRef('clear');
  const fadeTimer = useRef(null);

  // Fetch location once
  useEffect(() => {
    getUserLocation().then(loc => {
      if (loc) {
        locRef.current = loc;
        setBg(makeBg(condRef.current, loc.lat, loc.lng, date));
      }
    });
  }, []);

  // When date changes → fetch weather → update gradient with cross-fade
  useEffect(() => {
    let cancelled = false;
    const loc = locRef.current || DEFAULT_LOCATION;

    fetchWeather(date, loc.lat, loc.lng)
      .then(w => {
        if (cancelled) return;
        const cond = w?.condition || 'clear';
        condRef.current = cond;
        const next = makeBg(cond, loc.lat, loc.lng, date);

        // Cross-fade: stash current bg as fading layer, set new bg
        setBg(prev => {
          setFadingBg(prev);
          return next;
        });
      })
      .catch(() => {
        if (cancelled) return;
        // No weather data — use clear with current time
        const next = makeBg('clear', loc.lat, loc.lng, date);
        setBg(prev => { setFadingBg(prev); return next; });
      });

    return () => { cancelled = true; };
  }, [date]);

  // Live tick — update for time-of-day shifts every 60s
  useEffect(() => {
    const id = setInterval(() => {
      const loc = locRef.current || DEFAULT_LOCATION;
      const next = makeBg(condRef.current, loc.lat, loc.lng, dateRef.current);
      setBg(next); // no cross-fade for subtle time shifts
    }, 60000);
    return () => clearInterval(id);
  }, []);

  // Clear fading layer after animation completes
  useEffect(() => {
    if (!fadingBg) return;
    clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => setFadingBg(null), 2200);
    return () => clearTimeout(fadeTimer.current);
  }, [fadingBg]);

  const layer = {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    pointerEvents: 'none',
  };

  return (
    <div aria-hidden="true" style={{position:'absolute',inset:0,zIndex:0,pointerEvents:'none',overflow:'hidden'}}>
      {/* New gradient — always at bottom, fully visible */}
      <div style={{...layer, background: bg}}/>
      {/* Old gradient — fades out on top to reveal new one */}
      {fadingBg && (
        <div key={fadingBg} style={{
          ...layer,
          background: fadingBg,
          animation: 'weatherFadeOut 2s ease forwards',
        }}/>
      )}
      <style>{`@keyframes weatherFadeOut { from { opacity: 1; } to { opacity: 0; } }`}</style>
    </div>
  );
}
