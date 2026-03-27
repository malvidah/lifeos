"use client";
import dynamic from "next/dynamic";
import { useState, useEffect } from "react";
const StandaloneShell = dynamic(() => import("@/components/StandaloneShell"), { ssr: false });
const CalendarCard = dynamic(() => import("@/components/cards/CalendarCard"), { ssr: false });

export default function CalendarPage() {
  const [calView, setCalView] = useState('day');
  return (
    <StandaloneShell label="Calendar">
      {({ token, selected, setSelected }) => (
        <CalendarInner token={token} selected={selected} setSelected={setSelected} calView={calView} setCalView={setCalView} />
      )}
    </StandaloneShell>
  );
}

function CalendarInner({ token, selected, setSelected, calView, setCalView }) {
  const [events, setEvents] = useState({});
  const { api } = require("@/lib/api");
  const { toKey, shift } = require("@/lib/dates");

  useEffect(() => {
    if (!token) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const start = toKey(shift(new Date(), -30));
    const end = toKey(shift(new Date(), 60));
    api.get(`/api/calendar?start=${start}&end=${end}&tz=${encodeURIComponent(tz)}`, token)
      .then(d => { if (d?.events) setEvents(prev => ({ ...prev, ...d.events })); })
      .catch(() => {});
  }, [token]);

  return (
    <CalendarCard
      selected={selected} onSelect={setSelected}
      events={events} setEvents={setEvents}
      healthDots={{}}
      token={token} collapsed={false}
      calView={calView} onCalViewChange={setCalView}
    />
  );
}
