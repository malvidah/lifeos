"use client";

export default function PageDots({ count, active, onDotClick }) {
  if (count <= 1) return null;
  return (
    <div style={{
      display: 'flex', justifyContent: 'center', gap: 6,
      padding: '8px 0', position: 'sticky', bottom: 0,
      zIndex: 10,
    }}>
      {Array.from({ length: count }, (_, i) => (
        <button key={i} onClick={() => onDotClick(i)} style={{
          width: 6, height: 6, borderRadius: '50%',
          background: i === active ? 'var(--dl-accent)' : 'var(--dl-border2)',
          border: 'none', padding: 0, cursor: 'pointer',
          transition: 'background 0.2s',
        }} />
      ))}
    </div>
  );
}
