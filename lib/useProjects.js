"use client";
// ─── useProjects ──────────────────────────────────────────────────────────────
// Client-side hook that fetches and caches project metadata from /api/projects.
// Returns a projects map keyed by name for O(1) lookups, plus mutation helpers.
//
// Usage:
//   const { projects, getColor, upsertProject, refreshProjects } = useProjects(token);
//   const color = getColor('myproject');     // DB color or hash fallback
//   await upsertProject({ name: 'myproject', color: '#C17B4A' });

import { useState, useEffect, useCallback, useRef } from "react";
import { projectColor as hashColor } from "@/lib/tokens";
import { api } from "@/lib/api";

// Module-level cache so the list persists across component mounts
let CACHE = null; // null = not loaded; Map<name, projectObj> when loaded

export function useProjects(token) {
  const [projectsMap, setProjectsMap] = useState(() => CACHE ? new Map(CACHE) : null);
  const loadedRef = useRef(!!CACHE);

  // Initial load
  useEffect(() => {
    if (!token || loadedRef.current) return;
    loadedRef.current = true;
    api.get('/api/projects', token).then(res => {
      if (!res?.projects) return;
      const map = new Map(res.projects.map(p => [p.name, p]));
      CACHE = map;
      setProjectsMap(new Map(map));
    }).catch(() => {
      setProjectsMap(new Map());
    });
  }, [token]); // eslint-disable-line

  // Get color for a project — DB override first, then hash fallback
  const getColor = useCallback((name) => {
    const p = projectsMap?.get(name?.toLowerCase());
    return p?.color || hashColor(name || '');
  }, [projectsMap]);

  // Upsert a project (create or update metadata)
  const upsertProject = useCallback(async (fields) => {
    if (!token || !fields?.name) return null;
    const res = await api.post('/api/projects', fields, token);
    if (!res?.project) return null;
    const p = res.project;
    setProjectsMap(prev => {
      const next = new Map(prev || []);
      next.set(p.name, p);
      CACHE = next;
      return next;
    });
    return p;
  }, [token]);

  // Patch specific fields on an existing project
  const updateProject = useCallback(async (name, fields) => {
    if (!token || !name) return null;
    const res = await api.patch('/api/projects', { name, ...fields }, token);
    if (!res?.project) return null;
    const p = res.project;
    setProjectsMap(prev => {
      const next = new Map(prev || []);
      next.set(p.name, p);
      CACHE = next;
      return next;
    });
    return p;
  }, [token]);

  // Force-refresh from server
  const refreshProjects = useCallback(() => {
    if (!token) return;
    loadedRef.current = false;
    CACHE = null;
    setProjectsMap(null);
    // Trigger reload
    loadedRef.current = false;
    api.get('/api/projects', token).then(res => {
      if (!res?.projects) return;
      const map = new Map(res.projects.map(p => [p.name, p]));
      CACHE = map;
      loadedRef.current = true;
      setProjectsMap(new Map(map));
    });
  }, [token]);

  return {
    projects: projectsMap,          // Map<name, {id, name, color, notes, status, last_active}>
    loaded: projectsMap !== null,
    getColor,
    upsertProject,
    updateProject,
    refreshProjects,
  };
}

// Invalidate the module-level cache (call after logout or user switch)
export function clearProjectsCache() {
  CACHE = null;
}
