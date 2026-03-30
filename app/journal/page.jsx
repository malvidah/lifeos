"use client";
import dynamic from "next/dynamic";
const StandaloneShell = dynamic(() => import("@/components/StandaloneShell"), { ssr: false });
const JournalEditor = dynamic(() => import("@/components/widgets/JournalEditor").then(m => ({ default: m.JournalEditor })), { ssr: false });
const JournalModeToggle = dynamic(() => import("@/components/widgets/JournalEditor").then(m => ({ default: m.JournalModeToggle })), { ssr: false });

import { useJournalMode } from "@/lib/hooks";

export default function JournalPage() {
  const [journalMode, setJournalMode] = useJournalMode();
  return (
    <StandaloneShell label="Journal">
      {({ token, userId, selected }) => (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <JournalModeToggle mode={journalMode} setMode={setJournalMode} />
          </div>
          <JournalEditor date={selected} token={token} userId={userId} journalMode={journalMode} />
        </div>
      )}
    </StandaloneShell>
  );
}
