"use client";
import { useState, useEffect, useSyncExternalStore } from "react";

// ─── Plain getter for non-React code (api.js, offlineQueue.js) ──────────────
export function isOnline() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

// ─── Subscribe to reconnect (one-shot or persistent) ────────────────────────
export function onOnline(callback) {
  const handler = () => callback();
  window.addEventListener('online', handler);
  return () => window.removeEventListener('online', handler);
}

// ─── React hook ──────────────────────────────────────────────────────────────
const subscribe = (cb) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};
const getSnapshot = () => navigator.onLine;
const getServerSnapshot = () => true;

export function useOnlineStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
