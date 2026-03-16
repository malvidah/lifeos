"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  getDayPhase, getWeatherGradient,
  getUserLocation, getCachedLocation, DEFAULT_LOCATION,
  fetchWeather,
} from "@/lib/weather";

// ─── WeatherBackground ──────────────────────────────────────────────────────
// Ambient gradient that adapts to time of day + weather conditions.
// Uses two stacked layers for smooth cross-fade (CSS can't transition gradients).

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function WeatherBackground({ date, theme }) {
  const [condition, setCondition] = useState('clear');
  // Two gradient layers for cross-fade: active and outgoing
  const [layers, setLayers] = useState([null, null]); // [bottom, top]
  const [topVisible, setTopVisible] = useState(true);
  const locRef = useRef(getCachedLocation() || DEFAULT_LOCATION);
  const frameRef = useRef(null);
  const activeLayer = useRef(0); // which layer (0 or 1) is currently on top

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
      setCondition(w?.condition || 'clear');
    });
  }, [date]);

  // Compute gradient — always uses current real time so the app feels alive.
  // Weather condition changes per selected date, but time of day is always "now".
  const computeGradient = useCallback(() => {
    const loc = locRef.current;
    // Always use real current time — app should reflect the actual moment
    const phase = getDayPhase(new Date(), loc.lat, loc.lng);
    const [top, bottom] = getWeatherGradient(condition, phase);
    return `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`;
  }, [condition]);

  // Cross-fade: when gradient changes, push new gradient to the inactive layer
  // and fade it in over the active layer
  useEffect(() => {
    let active = true;

    function tick() {
      if (!active) return;
      const bg = computeGradient();
      // Put the new gradient on the inactive layer, then make it visible
      setLayers(prev => {
        const next = [...prev];
        const target = activeLayer.current === 0 ? 1 : 0;
        next[target] = bg;
        return next;
      });
      // Flip: make the new layer visible (triggers CSS opacity transition)
      setTimeout(() => {
        if (!active) return;
        activeLayer.current = activeLayer.current === 0 ? 1 : 0;
        setTopVisible(activeLayer.current === 1);
      }, 50); // small delay so the layer has the new gradient before fading in

      frameRef.current = setTimeout(tick, 60000); // update every minute
    }

    tick();
    return () => { active = false; clearTimeout(frameRef.current); };
  }, [computeGradient]);

  // On date change (condition changes), immediately recompute
  useEffect(() => {
    const bg = computeGradient();
    setLayers(prev => {
      const next = [...prev];
      const target = activeLayer.current === 0 ? 1 : 0;
      next[target] = bg;
      return next;
    });
    setTimeout(() => {
      activeLayer.current = activeLayer.current === 0 ? 1 : 0;
      setTopVisible(activeLayer.current === 1);
    }, 50);
  }, [condition]); // eslint-disable-line

  const base = {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    pointerEvents: 'none',
    transition: 'opacity 2s ease',
  };

  return (
    <div aria-hidden="true" style={{position:'absolute',top:0,left:0,right:0,bottom:0,zIndex:0,pointerEvents:'none',overflow:'hidden'}}>
      {/* Layer 0 */}
      <div style={{
        ...base,
        background: layers[0] || 'transparent',
        opacity: topVisible ? 0 : 1,
      }}/>
      {/* Layer 1 */}
      <div style={{
        ...base,
        background: layers[1] || 'transparent',
        opacity: topVisible ? 1 : 0,
      }}/>
    </div>
  );
}
