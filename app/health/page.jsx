"use client";
import dynamic from "next/dynamic";
const StandaloneShell = dynamic(() => import("@/components/StandaloneShell"), { ssr: false });
const HealthCard = dynamic(() => import("@/components/cards/HealthCard"), { ssr: false });

export default function HealthPage() {
  return (
    <StandaloneShell label="Health">
      {({ token, userId, selected }) => (
        <HealthCard date={selected} token={token} userId={userId} collapsed={false} />
      )}
    </StandaloneShell>
  );
}
