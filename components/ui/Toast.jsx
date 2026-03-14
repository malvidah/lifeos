"use client";
import { useState, useEffect, useCallback } from "react";
import { mono, F } from "@/lib/tokens";

// Show a toast from anywhere: window.dispatchEvent(new CustomEvent('daylab:toast', { detail: { message, type } }))
// type: 'error' | 'info' (default: 'info')

export function showToast(message, type = 'error') {
  window.dispatchEvent(new CustomEvent('daylab:toast', { detail: { message, type } }));
}

export function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((e) => {
    const { message, type = 'error' } = e.detail || {};
    if (!message) return;
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  useEffect(() => {
    window.addEventListener('daylab:toast', addToast);
    return () => window.removeEventListener('daylab:toast', addToast);
  }, [addToast]);

  if (!toasts.length) return null;

  return (
    <div style={{
      position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
      zIndex: 10000, display: 'flex', flexDirection: 'column', gap: 8,
      pointerEvents: 'none',
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          fontFamily: mono, fontSize: F.sm,
          padding: '8px 16px', borderRadius: 8,
          background: t.type === 'error' ? 'rgba(200,60,60,0.9)' : 'rgba(60,60,60,0.9)',
          color: '#fff', pointerEvents: 'auto',
          animation: 'fadeInDown 0.2s ease',
          boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
        }}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
