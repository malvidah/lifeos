"use client";
import dynamic from "next/dynamic";
import { useState, useEffect } from "react";
const StandaloneShell = dynamic(() => import("@/components/StandaloneShell"), { ssr: false });
const MapCard = dynamic(() => import("@/components/cards/MapCard").then(m => ({ default: m.MapCard })), { ssr: false });

export default function ProjectsPage() {
  return (
    <StandaloneShell label="Projects">
      {({ token, selected }) => (
        <ProjectsInner token={token} date={selected} />
      )}
    </StandaloneShell>
  );
}

function ProjectsInner({ token, date }) {
  const [graphData, setGraphData] = useState(null);
  const { api } = require("@/lib/api");

  useEffect(() => {
    if (!token) return;
    api.get('/api/all-tags', token).then(d => {
      if (!d) return;
      setGraphData({
        allTags: d.tags || [],
        connections: d.connections || [],
        recency: d.recency || {},
        entryCounts: d.entryCounts || {},
        completedTasks: d.completedTasks || {},
        habits: d.habits || [],
      });
    });
  }, [token]);

  if (!graphData) return null;

  return (
    <div style={{ margin: '-16px', height: 'calc(100vh - 52px)' }}>
      <MapCard
        allTags={graphData.allTags}
        connections={graphData.connections}
        recency={graphData.recency}
        entryCounts={graphData.entryCounts}
        completedTasks={graphData.completedTasks}
        habits={graphData.habits}
        healthDots={{}}
        onSelectProject={() => {}}
        date={date}
        token={token}
      />
    </div>
  );
}
