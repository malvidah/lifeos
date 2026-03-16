"use client";
import { useState, useEffect, useRef } from "react";
import {
  getDayPhase, getWeatherGradient,
  getUserLocation, getCachedLocation, DEFAULT_LOCATION,
  fetchWeather,
} from "@/lib/weather";

// Compute a CSS gradient string from weather condition + current time
function makeBg(condition, lat, lng) {
  const phase = getDayPhase(new Date(), lat, lng);
  const [top, bottom] = getWeatherGradient(condition || 'clear', phase);
  return `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`;
}

export default function WeatherBackground({ date }) {
  const locRef = useRef(getCachedLocation() || DEFAULT_LOCATION);
  const [bg, setBg] = useState(() => makeBg('clear', locRef.current.lat, locRef.current.lng));
  const [fadingBg, setFadingBg] = useState(null);
  const condRef = useRef('clear');
  const fadeTimer = useRef(null);

  // Fetch location once
  useEffect(() => {
    getUserLocation().then(loc => {
      if (loc) {
        locRef.current = loc;
        setBg(makeBg(condRef.current, loc.lat, loc.lng));
      }
    });
  }, []);

  // When date changes → fetch weather → update gradient with cross-fade
  useEffect(() => {
    let cancelled = false;
    const loc = locRef.current;

    fetchWeather(date, loc.lat, loc.lng)
      .then(w => {
        if (cancelled) return;
        const cond = w?.condition || 'clear';
        condRef.current = cond;
        const next = makeBg(cond, loc.lat, loc.lng);

        // Cross-fade: stash current bg as fading layer, set new bg
        setBg(prev => {
          setFadingBg(prev);
          return next;
        });
      })
      .catch(() => {
        if (cancelled) return;
        // No weather data — use clear with current time
        const next = makeBg('clear', loc.lat, loc.lng);
        setBg(prev => { setFadingBg(prev); return next; });
      });

    return () => { cancelled = true; };
  }, [date]);

  // Live tick — update for time-of-day shifts every 60s
  useEffect(() => {
    const id = setInterval(() => {
      const loc = locRef.current;
      const next = makeBg(condRef.current, loc.lat, loc.lng);
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
