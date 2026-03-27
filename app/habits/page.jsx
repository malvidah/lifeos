"use client";
import dynamic from "next/dynamic";
const StandaloneShell = dynamic(() => import("@/components/StandaloneShell"), { ssr: false });
const HabitsCard = dynamic(() => import("@/components/cards/HabitsCard"), { ssr: false });
const HabitFilterBtns = dynamic(() => import("@/components/cards/HabitsCard").then(m => ({ default: m.HabitFilterBtns })), { ssr: false });

import { useState } from "react";

export default function HabitsPage() {
  const [habitFilter, setHabitFilter] = useState('all');
  return (
    <StandaloneShell label="Habits">
      {({ token, userId, selected, setSelected }) => (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <HabitFilterBtns filter={habitFilter} setFilter={setHabitFilter} />
          </div>
          <HabitsCard date={selected} token={token} userId={userId} habitFilter={habitFilter} onSelectDate={setSelected} />
        </div>
      )}
    </StandaloneShell>
  );
}
