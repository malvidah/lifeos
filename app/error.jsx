"use client";

export default function GlobalError({ error, reset }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh', gap: 16,
      fontFamily: '"SF Mono", "Fira Code", ui-monospace, monospace',
      color: '#999', background: 'var(--dl-bg, #111110)',
    }}>
      <p style={{ fontSize: 14 }}>Something went wrong.</p>
      <button
        onClick={reset}
        style={{
          background: 'none', border: '1px solid #555', borderRadius: 6,
          padding: '8px 20px', cursor: 'pointer', color: '#ccc',
          fontFamily: 'inherit', fontSize: 13,
        }}
      >Try again</button>
    </div>
  );
}
