"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import "@/components/theme/theme.css";

// Sanitize HTML: keep structure but strip interactive chips and inline styles
function sanitizeHtml(html) {
  if (!html) return '';
  return html
    .replace(/<span[^>]*data-project-tag="([^"]*)"[^>]*>[^<]*<\/span>/g, '<em>$1</em>')
    .replace(/<span[^>]*data-note-link="([^"]*)"[^>]*>[^<]*<\/span>/g, '<em>$1</em>')
    .replace(/ style="[^"]*"/g, '')
    .replace(/ data-[a-z-]+="[^"]*"/g, '')
    .replace(/&nbsp;/g, ' ');
}

function fmtDate(d) {
  if (!d) return '';
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const [y, m, day] = d.split('-').map(Number);
  return `${months[m-1]} ${day}, ${y}`;
}

function textOnly(html) {
  if (!html) return '';
  return html
    .replace(/<span[^>]*data-project-tag="[^"]*"[^>]*>[^<]*<\/span>/g, '')
    .replace(/<span[^>]*data-note-link="[^"]*"[^>]*>[^<]*<\/span>/g, '')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

export default function SharedProjectPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  // Detect system dark mode preference
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (dark) => document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    apply(mq.matches);
    const handler = (e) => apply(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

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
        <p style={{color:'var(--dl-middle)',fontSize:13,letterSpacing:'0.1em'}}>
          This share link is invalid or has been revoked.
        </p>
      </div>
    );
  }

  if (!data) {
    return <div style={s.center}><p style={{color:'var(--dl-middle)',fontSize:13,letterSpacing:'0.1em'}}>LOADING</p></div>;
  }

  const { project, journalEntries, taskEntries, notes } = data;
  const accent = project.color || 'var(--dl-accent)';

  const journalByDate = {};
  for (const e of journalEntries) { (journalByDate[e.date] ||= []).push(e); }
  const hasJournal = Object.keys(journalByDate).length > 0;
  const hasTasks = taskEntries?.length > 0;
  const hasNotes = notes?.length > 0;

  return (
    <>
      <style>{`
        .share-page { font-family: Georgia, 'Times New Roman', serif; }
        .share-page h1, .share-page h2, .share-page h3 { margin: 0; }
        .share-page p { margin: 0 0 0.5em; }
        .note-content h1 { font-size: 18px; font-weight: 600; margin: 0 0 12px; color: var(--dl-strong); font-family: 'SF Mono','Fira Code',ui-monospace,monospace; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 400; }
        .note-content p { font-size: 15px; line-height: 1.75; color: var(--dl-strong); margin: 0 0 8px; }
        .note-content em { font-style: normal; color: ${accent}; font-weight: 500; }
        .note-content ul, .note-content ol { padding-left: 20px; margin: 4px 0 8px; }
        .note-content li { font-size: 15px; line-height: 1.75; color: var(--dl-strong); }
        .note-content table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 15px; }
        .note-content th, .note-content td { padding: 6px 12px; text-align: left; vertical-align: top; border: 1px solid var(--dl-border); color: var(--dl-strong); line-height: 1.6; }
        .note-content th { font-weight: 600; background: var(--dl-surface); }
        .note-content tr:first-child th, .note-content tr:first-child td { border-top: 1px solid var(--dl-border); }
        @media print { .share-page { padding: 0; } .share-footer { display: none; } }
      `}</style>
      <div className="share-page" style={s.page}>
        <header style={s.header}>
          <div style={{...s.projectLabel, color: accent}}>{project.name}</div>
        </header>

        {hasNotes && notes.map((n, i) => (
          <section key={i} style={s.noteSection}>
            <div className="note-content"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(n.content || '') }}
            />
            {n.updated_at && (
              <div style={s.datestamp}>{fmtDate(n.updated_at.split('T')[0])}</div>
            )}
          </section>
        ))}

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

        {hasTasks && (
          <section style={s.section}>
            <div style={s.sectionLabel}>Tasks</div>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {taskEntries.map((t, i) => (
                <div key={i} style={s.taskRow}>
                  <span style={{
                    width:16, height:16, borderRadius:4, flexShrink:0,
                    border: t.done ? `1.5px solid ${accent}` : '1.5px solid var(--dl-border2)',
                    background: t.done ? accent : 'transparent',
                    display:'flex', alignItems:'center', justifyContent:'center',
                  }}>
                    {t.done && <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="var(--dl-bg)" strokeWidth="1.8" strokeLinecap="round"><polyline points="1.5,5 4,7.5 8.5,2"/></svg>}
                  </span>
                  <span style={{
                    fontSize:15, lineHeight:'1.5', color:'var(--dl-strong)',
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

        <footer className="share-footer" style={s.footer}>
          <span style={{color:'var(--dl-middle)'}}>Shared from</span>{' '}
          <span style={{color:accent,fontWeight:500}}>Day Lab</span>
        </footer>
      </div>
    </>
  );
}

const s = {
  page: {
    maxWidth: 620, margin: '0 auto', padding: '48px 24px 64px',
    minHeight: '100vh', background: 'var(--dl-bg)', color: 'var(--dl-strong)',
  },
  center: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: '100vh', background: 'var(--dl-bg)',
  },
  header: { marginBottom: 48 },
  projectLabel: {
    fontSize: 13, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase',
    fontFamily: "'SF Mono','Fira Code',ui-monospace,monospace",
  },
  noteSection: {
    marginBottom: 40, paddingBottom: 32, borderBottom: '1px solid var(--dl-border)',
  },
  section: { marginBottom: 40 },
  sectionLabel: {
    fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase',
    color: 'var(--dl-middle)', marginBottom: 20,
    fontFamily: "'SF Mono','Fira Code',ui-monospace,monospace",
  },
  datestamp: {
    fontSize: 12, color: 'var(--dl-middle)', marginTop: 8, marginBottom: 4,
    letterSpacing: '0.02em',
    fontFamily: "'SF Mono','Fira Code',ui-monospace,monospace",
  },
  journalDay: {
    marginBottom: 24, paddingBottom: 20, borderBottom: '1px solid var(--dl-border)',
  },
  taskRow: { display: 'flex', alignItems: 'flex-start', gap: 10 },
  footer: {
    marginTop: 64, paddingTop: 24, borderTop: '1px solid var(--dl-border)',
    textAlign: 'center', fontSize: 12, letterSpacing: '0.06em',
    fontFamily: "'SF Mono','Fira Code',ui-monospace,monospace",
  },
};
