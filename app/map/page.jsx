"use client";
import dynamic from "next/dynamic";
const StandaloneShell = dynamic(() => import("@/components/StandaloneShell"), { ssr: false });
const WorldMapCard = dynamic(() => import("@/components/cards/WorldMapCard"), { ssr: false });

export default function MapPage() {
  return (
    <StandaloneShell label="Map">
      {({ token }) => (
        <div style={{ margin: '-16px', height: 'calc(100vh - 52px)' }}>
          <WorldMapCard token={token} />
        </div>
      )}
    </StandaloneShell>
  );
}
