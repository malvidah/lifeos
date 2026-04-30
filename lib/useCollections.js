'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export function useCollectionByName(name, token) {
  const [collection, setCollection] = useState(null);
  useEffect(() => {
    if (!name || !token) { setCollection(null); return; }
    let cancelled = false;
    (async () => {
      const [colRes, placesRes] = await Promise.all([
        api.get('/api/collections', token),
        api.get('/api/places', token),
      ]);
      if (cancelled) return;
      const match = (colRes?.collections || []).find(
        c => c.name?.toLowerCase() === name.toLowerCase()
      );
      if (!match) { setCollection(null); return; }
      const allPlaces = placesRes?.places || [];
      const placeIds = new Set(match.place_ids || []);
      const places = allPlaces
        .filter(p => placeIds.has(p.id) && p.lat != null && p.lng != null)
        .map(p => ({ name: p.name, lat: p.lat, lng: p.lng, color: p.color }));
      if (!cancelled) setCollection({ ...match, places });
    })();
    return () => { cancelled = true; };
  }, [name, token]);
  return collection;
}
