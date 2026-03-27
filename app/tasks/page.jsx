"use client";
import dynamic from "next/dynamic";
const StandaloneShell = dynamic(() => import("@/components/StandaloneShell"), { ssr: false });
const Tasks = dynamic(() => import("@/components/widgets/Tasks"), { ssr: false });
const TaskFilterBtns = dynamic(() => import("@/components/widgets/Tasks").then(m => ({ default: m.TaskFilterBtns })), { ssr: false });

import { useState } from "react";

export default function TasksPage() {
  const [taskFilter, setTaskFilter] = useState('all');
  return (
    <StandaloneShell label="Tasks">
      {({ token, userId, selected }) => (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <TaskFilterBtns filter={taskFilter} setFilter={setTaskFilter} />
          </div>
          <Tasks date={selected} token={token} userId={userId} taskFilter={taskFilter} />
        </div>
      )}
    </StandaloneShell>
  );
}
