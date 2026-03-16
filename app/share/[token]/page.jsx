"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

// Sanitize HTML: keep structure (p, h1, br, ul, li) but strip interactive chips
// to plain text and remove inline styles
function sanitizeHtml(html) {
  if (!html) return '';
  return html
    // Convert project chips to plain uppercase text
    .replace(/<span[^>]*data-project-tag="([^"]*)"[^>]*>[^<]*<\/span>/g, '<em>$1</em>')
    // Convert note links to plain text
    .replace(/<span[^>]*data-note-link="([^"]*)"[^>]*>[^<]*<\/span>/g, '<em>$1</em>')
    // Strip inline styles from remaining elements
    .replace(/ style="[^"]*"/g, '')
    // Clean up data attributes
    .replace(/ data-[a-z-]+="[^"]*"/g, '')
    // Decode common entities
    .replace(/&nbsp;/g, ' ');
}

// Format YYYY-MM-DD as readable date
function fmtDate(d) {
  if (!d) return '';
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const [y, m, day] = d.split('-').map(Number);
  return `${months[m-1]} ${day}, ${y}`;
}

// Strip all HTML for task text
function textOnly(html) {
  if (!html) return '';
  return html
    .replace(/<span[^>]*data-project-tag="([^"]*)"[^>]*>[^<]*<\/span>/g, '')
    .replace(/<span[^>]*data-note-link="([^"]*)"[^>]*>[^<]*<\/span>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
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
        <p style={s.errorText}>This share link is invalid or has been revoked.</p>
      </div>
    );
  }

  if (!data) {
    return <div style={s.center}><p style={{color:'#9a9080',fontSize:13,letterSpacing:'0.1em'}}>LOADING</p></div>;
  }

  const { project, journalEntries, taskEntries, notes } = data;
  const accent = project.color || '#C17B4A';

  // Group journal entries by date
  const journalByDate = {};
  for (const e of journalEntries) {
    (journalByDate[e.date] ||= []).push(e);
  }
  const hasJournal = Object.keys(journalByDate).length > 0;
  const hasTasks = taskEntries?.length > 0;
  const hasNotes = notes?.length > 0;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');
        .share-page { font-family: 'Inter', -apple-system, sans-serif; }
        .share-page h1, .share-page h2, .share-page h3 { margin: 0; }
        .share-page p { margin: 0 0 0.5em; }
        .note-content h1 { font-size: 18px; font-weight: 600; margin: 0 0 12px; color: #1a1a1a; }
        .note-content p { font-size: 15px; line-height: 1.75; color: #3a3530; margin: 0 0 8px; }
        .note-content em { font-style: normal; color: ${accent}; font-weight: 500; }
        .note-content ul, .note-content ol { padding-left: 20px; margin: 4px 0 8px; }
        .note-content li { font-size: 15px; line-height: 1.75; color: #3a3530; }
        @media print { .share-page { padding: 0; } .share-footer { display: none; } }
      `}</style>
      <div className="share-page" style={s.page}>
        {/* Minimal header */}
        <header style={s.header}>
          <div style={{...s.projectLabel, color: accent}}>{project.name}</div>
        </header>

        {/* Notes — rendered as rich HTML */}
        {hasNotes && notes.map((n, i) => (
          <section key={i} style={s.noteSection}>
            <div
              className="note-content"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(n.content || '') }}
            />
            {n.updated_at && (
              <div style={s.datestamp}>{fmtDate(n.updated_at.split('T')[0])}</div>
            )}
          </section>
        ))}

        {/* Journal entries */}
        {hasJournal && (
          <section style={s.section}>
            <div style={s.sectionLabel}>Journal</div>
            {Object.entries(journalByDate).map(([date, entries]) => (
              <div key={date} style={s.journalDay}>
                <div style={s.datestamp}>{fmtDate(date)}</div>
                {entries.map((e, i) => (
                  <div key={i} className="note-content"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(e.content || '') }}
                  />
                ))}
              </div>
            ))}
          </section>
        )}

        {/* Tasks */}
        {hasTasks && (
          <section style={s.section}>
            <div style={s.sectionLabel}>Tasks</div>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {taskEntries.map((t, i) => (
                <div key={i} style={s.taskRow}>
                  <span style={{
                    width:18, height:18, borderRadius:4, flexShrink:0,
                    border: t.done ? `1.5px solid ${accent}` : '1.5px solid #c8c0b0',
                    background: t.done ? accent : 'transparent',
                    display:'flex', alignItems:'center', justifyContent:'center',
                  }}>
                    {t.done && <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"><polyline points="1.5,5 4,7.5 8.5,2"/></svg>}
                  </span>
                  <span style={{
                    fontSize:15, lineHeight:'1.5', color:'#3a3530',
                    textDecoration: t.done ? 'line-through' : 'none',
                    opacity: t.done ? 0.5 : 1,
                  }}>
                    {textOnly(t.text)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Footer */}
        <footer className="share-footer" style={s.footer}>
          <span style={{color:'#c0b8a8'}}>Shared from</span>{' '}
          <span style={{color:accent,fontWeight:500}}>Day Lab</span>
        </footer>
      </div>
    </>
  );
}

const s = {
  page: {
    maxWidth: 620,
    margin: '0 auto',
    padding: '48px 24px 64px',
    minHeight: '100vh',
    background: '#faf9f6',
    color: '#1a1a1a',
  },
  center: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: '100vh', background: '#faf9f6',
  },
  errorText: {
    fontSize: 14, color: '#9a9080', letterSpacing: '0.05em',
  },
  header: {
    marginBottom: 48,
  },
  projectLabel: {
    fontSize: 13, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase',
  },
  noteSection: {
    marginBottom: 40,
    paddingBottom: 32,
    borderBottom: '1px solid #ece8e0',
  },
  section: {
    marginBottom: 40,
  },
  sectionLabel: {
    fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase',
    color: '#b0a898', marginBottom: 20,
  },
  datestamp: {
    fontSize: 12, color: '#b0a898', marginTop: 8, marginBottom: 4,
    letterSpacing: '0.02em',
  },
  journalDay: {
    marginBottom: 24,
    paddingBottom: 20,
    borderBottom: '1px solid #f0ece6',
  },
  taskRow: {
    display: 'flex', alignItems: 'flex-start', gap: 10,
  },
  footer: {
    marginTop: 64, paddingTop: 24,
    borderTop: '1px solid #ece8e0',
    textAlign: 'center',
    fontSize: 12, letterSpacing: '0.06em',
  },
};
