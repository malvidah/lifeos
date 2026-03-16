"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

// ─── Public share page ──────────────────────────────────────────────────────
// Read-only view of a shared project. No auth required.

export default function SharedProjectPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/public/project/${token}`)
      .then(r => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setData)
      .catch(() => setError(true));
  }, [token]);

  if (error) {
    return (
      <div style={styles.center}>
        <h1 style={styles.heading}>Not Found</h1>
        <p style={styles.sub}>This share link is invalid or has been revoked.</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={styles.center}>
        <p style={styles.sub}>Loading...</p>
      </div>
    );
  }

  const { project, journalEntries, taskEntries } = data;
  const accent = project.color || '#888';

  // Group journal entries by date
  const journalByDate = {};
  for (const e of journalEntries) {
    (journalByDate[e.date] ||= []).push(e);
  }

  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={{ ...styles.header, borderBottomColor: accent }}>
        <h1 style={{ ...styles.projectName, color: accent }}>
          {project.name}
        </h1>
      </header>

      {/* Journal entries */}
      {Object.keys(journalByDate).length > 0 && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Journal</h2>
          {Object.entries(journalByDate).map(([date, entries]) => (
            <div key={date} style={styles.dateGroup}>
              <div style={styles.dateLabel}>{date}</div>
              {entries.map((e, i) => (
                <div key={i} style={styles.entry}>
                  {e.type && <span style={{ ...styles.typeBadge, background: accent + '22', color: accent }}>{e.type}</span>}
                  <span>{e.content}</span>
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      {/* Tasks */}
      {taskEntries.length > 0 && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Tasks</h2>
          {taskEntries.map((t, i) => (
            <div key={i} style={styles.taskRow}>
              <span style={{
                ...styles.taskStatus,
                color: t.status === 'done' ? '#4a9' : '#888',
              }}>
                {t.status === 'done' ? '\u2713' : '\u25CB'}
              </span>
              <span style={{
                textDecoration: t.status === 'done' ? 'line-through' : 'none',
                opacity: t.status === 'done' ? 0.6 : 1,
              }}>
                {t.title}
              </span>
              {t.date && <span style={styles.taskDate}>{t.date}</span>}
            </div>
          ))}
        </section>
      )}

      {/* Footer */}
      <footer style={styles.footer}>
        Powered by Day Lab
      </footer>
    </div>
  );
}

const styles = {
  page: {
    maxWidth: 640,
    margin: '0 auto',
    padding: '24px 16px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#222',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
  },
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#555',
  },
  heading: {
    fontSize: 20,
    fontWeight: 600,
    marginBottom: 8,
  },
  sub: {
    fontSize: 14,
    color: '#888',
  },
  header: {
    borderBottom: '2px solid',
    paddingBottom: 12,
    marginBottom: 24,
  },
  projectName: {
    fontSize: 24,
    fontWeight: 700,
    margin: 0,
    textTransform: 'capitalize',
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#888',
    marginBottom: 12,
  },
  dateGroup: {
    marginBottom: 16,
  },
  dateLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: '#aaa',
    marginBottom: 6,
  },
  entry: {
    fontSize: 14,
    lineHeight: 1.6,
    marginBottom: 4,
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
  },
  typeBadge: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    borderRadius: 4,
    padding: '1px 6px',
    flexShrink: 0,
  },
  taskRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
    lineHeight: 1.6,
    marginBottom: 4,
  },
  taskStatus: {
    fontSize: 16,
    flexShrink: 0,
  },
  taskDate: {
    fontSize: 11,
    color: '#aaa',
    marginLeft: 'auto',
  },
  footer: {
    marginTop: 'auto',
    paddingTop: 32,
    textAlign: 'center',
    fontSize: 12,
    color: '#bbb',
    letterSpacing: '0.05em',
  },
};
