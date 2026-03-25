"use client";
import { useState, useEffect } from "react";
import { mono, F } from "@/lib/tokens";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { getQueueLength } from "@/lib/offlineQueue";

export function OfflineBanner() {
  const online = useOnlineStatus();
  const [queueLen, setQueueLen] = useState(0);
  const [showReconnect, setShowReconnect] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  // Track queue length changes
  useEffect(() => {
    setQueueLen(getQueueLength());
    const handler = (e) => setQueueLen(e.detail?.length ?? 0);
    window.addEventListener('daylab:queue-change', handler);
    return () => window.removeEventListener('daylab:queue-change', handler);
  }, []);

  // Track offline→online transitions
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
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10001,
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      height: 28,
      background: isReconnect ? 'rgba(60,140,80,0.92)' : 'rgba(60,60,60,0.92)',
      backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
      fontFamily: mono, fontSize: F.sm, color: '#fff', letterSpacing: 0.3,
      animation: 'slideDown 0.2s ease',
    }}>
      {isReconnect
        ? 'Back online'
        : queueLen > 0
          ? `Offline — ${queueLen} change${queueLen !== 1 ? 's' : ''} queued`
          : 'Offline — changes saved locally'
      }
      <style>{`
        @keyframes slideDown {
          from { transform: translateY(-100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
