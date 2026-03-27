"use client";
import dynamic from "next/dynamic";
const StandaloneShell = dynamic(() => import("@/components/StandaloneShell"), { ssr: false });
const HabitsCard = dynamic(() => import("@/components/cards/HabitsCard"), { ssr: false });
const HabitFilterBtns = dynamic(() => import("@/components/cards/HabitsCard").then(m => ({ default: m.HabitFilterBtns })), { ssr: false });
const AddHabitBtn = dynamic(() => import("@/components/cards/HabitsCard").then(m => ({ default: m.AddHabitBtn })), { ssr: false });

import { useState } from "react";

export default function HabitsPage() {
  const [habitFilter, setHabitFilter] = useState('all');
  const [habitCreating, setHabitCreating] = useState(false);
  return (
    <StandaloneShell label="Habits">
      {({ token, userId, selected, setSelected }) => (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginBottom: 8 }}>
            <AddHabitBtn onClick={() => setHabitCreating(true)} />
            <HabitFilterBtns filter={habitFilter} setFilter={setHabitFilter} />
          </div>
          <HabitsCard date={selected} token={token} userId={userId} habitFilter={habitFilter} onSelectDate={setSelected} showCreateForm={habitCreating} onCreateDone={() => setHabitCreating(false)} />
        </div>
      )}
    </StandaloneShell>
  );
}
