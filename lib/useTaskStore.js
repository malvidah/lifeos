"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";

// ─── Row-level task store ────────────────────────────────────────────────────
// Replaces useDbSave for tasks. Each task is an independent row managed via
// targeted API calls (PATCH, POST, DELETE). No more full-replace.

export function useTaskStore(date, token, userId) {
  const [tasks, setTasks] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const pendingEdits = useRef({}); // { [taskId]: { timer, patch } }

  // ── Load tasks from server ─────────────────────────────────────────────
  useEffect(() => {
    if (!token || !userId || !date) return;
    let cancelled = false;

    api.get(`/api/tasks?date=${date}`, token).then(d => {
      if (cancelled) return;
      setTasks(d?.tasks ?? []);
      setLoaded(true);
    }).catch(() => {
      if (!cancelled) setLoaded(true);
    });

    return () => { cancelled = true; };
  }, [date, token, userId]);

  // ── Flush pending edits on unmount / date change ───────────────────────
  useEffect(() => {
    return () => {
      Object.values(pendingEdits.current).forEach(({ timer }) => clearTimeout(timer));
    };
  }, [date]);

  // ── Add a new task ─────────────────────────────────────────────────────
  const addTask = useCallback(async (text, extra = {}) => {
    if (!token || !text?.trim()) return null;
    const maxPos = tasks.reduce((m, t) => Math.max(m, t.position ?? 0), -1);
    const tempId = `temp-${Date.now()}`;

    // Parse due_date from text tokens like @2026-04-10
    const dateMatch = text.match(/@(\d{4}-\d{2}-\d{2})/);
    const due_date = extra.due_date || (dateMatch ? dateMatch[1] : null);

    // Parse project tags from text tokens like {big think}
    const projectTags = extra.project_tags || [];
    const tagMatches = text.matchAll(/\{([^}]+)\}/g);
    for (const m of tagMatches) {
      const tag = m[1].toLowerCase();
      if (!projectTags.includes(tag)) projectTags.push(tag);
    }

    // Optimistic add
    const optimistic = {
      id: tempId, date, text, html: '', done: false,
      due_date,
      project_tags: projectTags,
      note_tags: extra.note_tags || [],
      position: maxPos + 1,
      _source: 'own', _editable: true,
    };
    setTasks(prev => [...prev, optimistic]);

    // Server create
    const result = await api.post('/api/tasks', {
      date, text,
      done: false,
      due_date,
      project_tags: projectTags,
      note_tags: extra.note_tags || [],
      position: maxPos + 1,
    }, token);

    if (result?.task) {
      // Replace temp with real
      setTasks(prev => prev.map(t => t.id === tempId ? { ...result.task, _source: 'own', _editable: true } : t));
      return result.task;
    } else {
      // Revert
      setTasks(prev => prev.filter(t => t.id !== tempId));
      return null;
    }
  }, [token, date, tasks]);

  // ── Update a task (debounced per-task) ──────────────────────────────────
  const updateTask = useCallback((id, patch) => {
    if (!token || !id) return;

    // Optimistic update
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));

    // Cancel previous debounce for this task
    if (pendingEdits.current[id]) {
      clearTimeout(pendingEdits.current[id].timer);
    }

    // Debounce 500ms per task
    pendingEdits.current[id] = {
      patch,
      timer: setTimeout(async () => {
        delete pendingEdits.current[id];
        await api.patch('/api/tasks', { id, ...patch }, token);
      }, 500),
    };
  }, [token]);

  // ── Toggle task done ───────────────────────────────────────────────────
  const toggleTask = useCallback(async (id) => {
    if (!token) return;
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    // Recurring task: use complete-recurring endpoint
    if (task._source === 'recurring') {
      const result = await api.post('/api/tasks/complete-recurring', {
        template_id: id, date,
      }, token);
      if (result?.task) {
        // Add completion row, mark the virtual recurring as done locally
        setTasks(prev => prev.map(t =>
          t.id === id ? { ...t, done: true } : t
        ));
      }
      return;
    }

    // Regular task: toggle done via PATCH
    const newDone = !task.done;
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, done: newDone, completed_at: newDone ? new Date().toISOString().slice(0, 10) : null } : t
    ));
    await api.patch('/api/tasks', {
      id,
      done: newDone,
      completed_at: newDone ? new Date().toISOString().slice(0, 10) : null,
    }, token);
  }, [token, tasks, date]);

  // ── Delete a task ──────────────────────────────────────────────────────
  const deleteTask = useCallback(async (id) => {
    if (!token) return;
    // Optimistic remove
    setTasks(prev => prev.filter(t => t.id !== id));
    await api.delete(`/api/tasks?id=${id}`, token);
  }, [token]);

  // ── Reorder tasks ──────────────────────────────────────────────────────
  const reorderTasks = useCallback(async (orderedIds) => {
    if (!token) return;
    const updates = orderedIds.map((id, i) => ({ id, position: i }));

    // Optimistic reorder
    setTasks(prev => {
      const byId = Object.fromEntries(prev.map(t => [t.id, t]));
      return orderedIds.map((id, i) => ({ ...byId[id], position: i })).filter(Boolean);
    });

    await api.post('/api/tasks/reorder', { updates }, token);
  }, [token]);

  return { tasks, loaded, addTask, updateTask, toggleTask, deleteTask, reorderTasks };
}
