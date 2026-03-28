"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { GoalsViewToggle } from "@/components/cards/GoalsCard";
const StandaloneShell = dynamic(() => import("@/components/StandaloneShell"), { ssr: false });
const GoalsCard = dynamic(() => import("@/components/cards/GoalsCard"), { ssr: false });

export default function GoalsPage() {
  const [viewMode, setViewMode] = useState('kanban');
  return (
    <StandaloneShell label="Goals">
      {({ token, selected }) => (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <GoalsViewToggle mode={viewMode} setMode={setViewMode} />
          </div>
          <GoalsCard token={token} date={selected} viewMode={viewMode} />
        </div>
      )}
    </StandaloneShell>
  );
}
