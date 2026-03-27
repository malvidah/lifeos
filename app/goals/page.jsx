"use client";
import dynamic from "next/dynamic";
const StandaloneShell = dynamic(() => import("@/components/StandaloneShell"), { ssr: false });
const GoalsCard = dynamic(() => import("@/components/cards/GoalsCard"), { ssr: false });

export default function GoalsPage() {
  return (
    <StandaloneShell label="Goals">
      {({ token, selected }) => (
        <GoalsCard token={token} date={selected} />
      )}
    </StandaloneShell>
  );
}
