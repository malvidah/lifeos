"use client";
import dynamic from "next/dynamic";
const StandaloneShell = dynamic(() => import("@/components/StandaloneShell"), { ssr: false });
const NotesCard = dynamic(() => import("@/components/widgets/NotesCard"), { ssr: false });

export default function NotesPage() {
  return (
    <StandaloneShell label="Notes">
      {({ token, userId }) => (
        <NotesCard token={token} userId={userId} collapsed={false} />
      )}
    </StandaloneShell>
  );
}
