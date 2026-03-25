"use client";
import { useState, useEffect } from "react";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { getQueueLength } from "@/lib/offlineQueue";

// Wifi-off SVG icon (inline, 18px)
function WifiOffIcon({ size = 18, color = 'var(--dl-middle)' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23"/>
      <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
      <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
      <path d="M10.71 5.05A16 16 0 0 1 22.56 9"/>
      <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
      <line x1="12" y1="20" x2="12.01" y2="20"/>
    </svg>
  );
}

export function OfflineIndicator() {
  const online = useOnlineStatus();
  const [queueLen, setQueueLen] = useState(0);
  const [showReconnect, setShowReconnect] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    setQueueLen(getQueueLength());
    const handler = (e) => setQueueLen(e.detail?.length ?? 0);
    window.addEventListener('daylab:queue-change', handler);
    return () => window.removeEventListener('daylab:queue-change', handler);
  }, []);

  useEffect(() => {
    if (!online) {
      setWasOffline(true);
    } else if (wasOffline) {
      setShowReconnect(true);
      const t = setTimeout(() => { setShowReconnect(false); setWasOffline(false); }, 2500);
      return () => clearTimeout(t);
    }
  }, [online]); // eslint-disable-line

  if (online && !showReconnect) return null;

  const isReconnect = online && showReconnect;

  return (
    <div
      title={isReconnect ? 'Back online' : queueLen > 0 ? `${queueLen} change${queueLen !== 1 ? 's' : ''} queued` : 'Offline — changes saved locally'}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: isReconnect ? 0.4 : 0.7,
        transition: 'opacity 0.3s ease',
        animation: 'fadeIn 0.2s ease',
      }}
    >
      {isReconnect ? (
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--dl-green, #4A9A68)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
          <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
          <line x1="12" y1="20" x2="12.01" y2="20"/>
        </svg>
      ) : (
        <WifiOffIcon />
      )}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
