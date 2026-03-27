"use client";
import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { todayKey } from "@/lib/dates";
import { isValidDate } from "@/lib/validate";

// Read ?date=YYYY-MM-DD from URL; default to today.
function readDateFromUrl() {
  const p = new URLSearchParams(window.location.search).get('date');
  return (p && isValidDate(p)) ? p : todayKey();
}

// Shared auth + date state for standalone full-page routes.
// Returns { session, authReady, token, userId, selected, setSelected }.
export function useStandalonePage() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [selected, _setSelected] = useState(readDateFromUrl);

  // Sync date state with URL
  useEffect(() => {
    const onPop = () => _setSelected(readDateFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const setSelected = useCallback(valOrFn => {
    _setSelected(prev => {
      const next = typeof valOrFn === 'function' ? valOrFn(prev) : valOrFn;
      if (next === prev) return prev;
      const url = new URL(window.location.href);
      if (next === todayKey()) {
        url.searchParams.delete('date');
      } else {
        url.searchParams.set('date', next);
      }
      window.history.pushState({}, '', url);
      return next;
    });
  }, []);

  // Auth
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setAuthReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  return {
    session,
    authReady,
    token: session?.access_token ?? null,
    userId: session?.user?.id ?? null,
    selected,
    setSelected,
  };
}
