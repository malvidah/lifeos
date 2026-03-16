"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

// Strip HTML to plain text, removing chips and links
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<span[^>]*data-project-tag="([^"]*)"[^>]*>[^<]*<\/span>/g, '$1')
    .replace(/<span[^>]*data-note-link="([^"]*)"[^>]*>[^<]*<\/span>/g, '$1')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/p>\s*<p[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

// Format YYYY-MM-DD as readable date
function fmtDate(d) {
  if (!d) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [y, m, day] = d.split('-').map(Number);
  return `${months[m-1]} ${day}, ${y}`;
}

export default function SharedProjectPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/public/project/${token}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, [token]);

  if (error) {
    return (
      <div style={s.center}>
        <h1 style={s.heading}>Not Found</h1>
        <p style={s.sub}>This share link is invalid or has been revoked.</p>
      </div>
    );
  }

  if (!data) {
    return <div style={s.center}><p style={s.sub}>Loading...</p></div>;
  }

  const { project, journalEntries, taskEntries, notes } = data;
  const accent = project.color || '#888';

  // Group journal entries by date
  const journalByDate = {};
  for (const e of journalEntries) {
    (journalByDate[e.date] ||= []).push(e);
  }

  return (
    <div style={s.page}>
      {/* Header */}
      <header style={{ ...s.header, borderBottomColor: accent }}>
        <h1 style={{ ...s.projectName, color: accent }}>{project.name}</h1>
      </header>

      {/* Notes */}
      {notes?.length > 0 && (
        <section style={s.section}>
          <h2 style={s.sectionTitle}>Notes</h2>
          {notes.map((n, i) => {
            const title = n.title || 'Untitled';
            const body = stripHtml(n.content?.replace(/<h1[^>]*>.*?<\/h1>/s, '') || '');
            return (
              <div key={i} style={s.noteCard}>
                <div style={s.noteTitle}>{title}</div>
                {body && <div style={s.noteBody}>{body}</div>}
                {n.updated_at && (
                  <div style={s.noteMeta}>{fmtDate(n.updated_at.split('T')[0])}</div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* Journal entries */}
      {Object.keys(journalByDate).length > 0 && (
        <section style={s.section}>
          <h2 style={s.sectionTitle}>Journal</h2>
          {Object.entries(journalByDate).map(([date, entries]) => (
            <div key={date} style={s.dateGroup}>
              <div style={s.dateLabel}>{fmtDate(date)}</div>
              {entries.map((e, i) => (
                <div key={i} style={s.entry}>{stripHtml(e.content)}</div>
              ))}
            </div>
          ))}
        </section>
      )}

      {/* Tasks */}
      {taskEntries?.length > 0 && (
        <section style={s.section}>
          <h2 style={s.sectionTitle}>Tasks</h2>
          {taskEntries.map((t, i) => (
            <div key={i} style={s.taskRow}>
              <span style={{ ...s.taskStatus, color: t.done ? '#4a9' : '#888' }}>
                {t.done ? '\u2713' : '\u25CB'}
              </span>
              <span style={{
                textDecoration: t.done ? 'line-through' : 'none',
                opacity: t.done ? 0.6 : 1,
              }}>
                {stripHtml(t.text)}
              </span>
              {t.date && <span style={s.taskDate}>{fmtDate(t.date)}</span>}
            </div>
          ))}
        </section>
      )}

      {/* Footer */}
      <footer style={s.footer}>Powered by Day Lab</footer>
    </div>
  );
}

const s = {
  page: {
    maxWidth: 640, margin: '0 auto', padding: '32px 20px',
    fontFamily: 'Georgia, "Times New Roman", serif',
    color: '#2a2420', minHeight: '100vh', display: 'flex', flexDirection: 'column',
    background: '#faf8f4',
  },
  center: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    minHeight: '100vh', fontFamily: 'Georgia, serif', color: '#555', background: '#faf8f4',
  },
  heading: { fontSize: 20, fontWeight: 600, marginBottom: 8 },
  sub: { fontSize: 14, color: '#888' },
  header: {
    borderBottom: '2px solid', paddingBottom: 16, marginBottom: 32,
  },
  projectName: {
    fontSize: 22, fontWeight: 400, margin: 0, textTransform: 'uppercase',
    letterSpacing: '0.12em',
    fontFamily: "'SF Mono', 'Fira Code', ui-monospace, monospace",
  },
  section: { marginBottom: 36 },
  sectionTitle: {
    fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em',
    color: '#9a8e80', marginBottom: 16,
    fontFamily: "'SF Mono', 'Fira Code', ui-monospace, monospace",
  },
  // Notes
  noteCard: {
    marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #e8e4de',
  },
  noteTitle: {
    fontSize: 17, fontWeight: 600, marginBottom: 6, color: '#2a2420',
  },
  noteBody: {
    fontSize: 15, lineHeight: 1.7, color: '#4a4440', whiteSpace: 'pre-wrap',
  },
  noteMeta: {
    fontSize: 11, color: '#b0a898', marginTop: 8,
    fontFamily: "'SF Mono', 'Fira Code', ui-monospace, monospace",
  },
  // Journal
  dateGroup: { marginBottom: 16 },
  dateLabel: {
    fontSize: 11, fontWeight: 600, color: '#b0a898', marginBottom: 6,
    fontFamily: "'SF Mono', 'Fira Code', ui-monospace, monospace",
  },
  entry: { fontSize: 15, lineHeight: 1.7, marginBottom: 4, color: '#4a4440' },
  // Tasks
  taskRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    fontSize: 15, lineHeight: 1.7, marginBottom: 4,
  },
  taskStatus: { fontSize: 16, flexShrink: 0 },
  taskDate: {
    fontSize: 11, color: '#b0a898', marginLeft: 'auto',
    fontFamily: "'SF Mono', 'Fira Code', ui-monospace, monospace",
  },
  footer: {
    marginTop: 'auto', paddingTop: 40, textAlign: 'center',
    fontSize: 11, color: '#c0b8a8', letterSpacing: '0.08em',
    fontFamily: "'SF Mono', 'Fira Code', ui-monospace, monospace",
  },
};
