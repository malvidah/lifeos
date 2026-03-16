"use client";
import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import "@/components/theme/theme.css";
import { serif, mono, F, projectColor } from "@/lib/tokens";
import { Card } from "@/components/ui/primitives.jsx";
import { extractImages, PhotoStrip, Slideshow } from "@/components/widgets/JournalEditor.jsx";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [y, m, day] = d.split('-').map(Number);
  return `${months[m - 1]} ${day}`;
}

<<<<<<< HEAD
// Sanitize HTML for display: strip image chips (shown in PhotoStrip), replace
// project/note chips with styled spans, remove inline styles and data attrs.
function sanitizeHtml(html) {
  if (!html) return '';
  let s = html;
  // 1. Remove image chips/blocks (rendered separately in PhotoStrip)
  s = s.replace(/<span[^>]*data-image-chip="[^"]*"[^>]*>[\s\S]*?<\/span>/g, '');
  s = s.replace(/<div[^>]*data-imageblock="[^"]*"[^>]*>[\s\S]*?<\/div>/g, '');
  // 2. Strip inline styles and data attrs FIRST
  s = s.replace(/ style="[^"]*"/g, '');
  s = s.replace(/ data-(?!project-tag|note-link)[a-z-]+="[^"]*"/g, '');
  // 3. Replace project tags → styled chip (after styles are stripped)
  s = s.replace(/<span[^>]*data-project-tag="([^"]*)"[^>]*>[^<]*<\/span>/g, (_, name) => {
    const col = projectColor(name);
    return `<span class="share-chip" style="color:${col};background:${col}22">${name}</span>`;
  });
  // 4. Replace note links → styled chip
  s = s.replace(/<span[^>]*data-note-link="([^"]*)"[^>]*>[^<]*<\/span>/g,
    '<span class="share-chip" style="color:var(--dl-accent);background:var(--dl-accent-10)">$1</span>');
  s = s.replace(/&nbsp;/g, ' ');
  return s;
}

// Strip HTML + plain-text chip syntax ({project} and [note]) from task text
function textOnly(text) {
  if (!text) return '';
  return text
    .replace(/<span[^>]*data-project-tag="[^"]*"[^>]*>[^<]*<\/span>/g, '')
    .replace(/<span[^>]*data-note-link="[^"]*"[^>]*>[^<]*<\/span>/g, '')
    .replace(/<span[^>]*data-image-chip="[^"]*"[^>]*>[\s\S]*?<\/span>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{[a-z0-9][a-z0-9 ]*[a-z0-9]\}|\{[a-z0-9]\}/g, '') // {project tags}
    .replace(/\[[^\]]+\]/g, '') // [note links]
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ').trim();
}

// ── Note Photos ──────────────────────────────────────────────────────────────

function NotePhotos({ images }) {
  const [lightbox, setLightbox] = useState(null);
  if (!images.length) return null;
  if (lightbox != null) {
    return <Slideshow images={images} index={lightbox} onClose={() => setLightbox(null)} />;
  }
  return <PhotoStrip images={images} onViewImage={i => setLightbox(i)} />;
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function SharedProjectPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [activeNoteIdx, setActiveNoteIdx] = useState(0);

  // Apply system theme
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

  const { project, journalEntries, taskEntries, notes } = data || {};
  const accent = project?.color || (project?.name ? projectColor(project.name) : 'var(--dl-accent)');

  // Group journal by date — hooks must be called unconditionally
  const journalByDate = useMemo(() => {
    if (!journalEntries?.length) return [];
    const map = {};
    journalEntries.forEach(e => { (map[e.date] ||= []).push(e); });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [journalEntries]);

  // Group tasks by date
  const openTasks = (taskEntries || []).filter(t => !t.done);
  const tasksByDate = useMemo(() => {
    if (!taskEntries?.length) return [];
    const map = {};
    taskEntries.forEach(t => { (map[t.date] ||= []).push(t); });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [taskEntries]);

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--dl-bg)' }}>
        <p style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.1em', color: 'var(--dl-middle)' }}>
          This share link is invalid or has been revoked.
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--dl-bg)' }}>
        <p style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.1em', color: 'var(--dl-middle)' }}>LOADING</p>
      </div>
    );
  }

  const hasNotes = notes?.length > 0;
  const hasTasks = taskEntries?.length > 0;
  const hasJournal = journalByDate.length > 0;

  const activeNote = hasNotes ? notes[activeNoteIdx] || notes[0] : null;
  const activeNoteImages = activeNote ? extractImages(activeNote.content) : [];

  // Extract note title from HTML h1 or first line
  function noteName(note) {
    const c = note?.content || '';
    const m = c.match(/<h1[^>]*>(.*?)<\/h1>/s);
    return m ? m[1].replace(/<[^>]+>/g, '').trim() || 'Untitled' : 'Untitled';
  }

  return (
    <>
      <style>{`
        .share-note-content h1 { font-family: ${mono}; font-size: 0.8em; font-weight: 400; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 4px; padding: 0; color: var(--dl-strong); }
        .share-note-content p { margin: 0; padding: 0; font-family: ${serif}; font-size: ${F.md}px; line-height: 1.7; color: var(--dl-strong); }
        .share-note-content table { border-collapse: collapse; width: 100%; margin: 8px 0; }
        .share-note-content th, .share-note-content td { border-bottom: 1px solid var(--dl-border); padding: 6px 10px; text-align: left; vertical-align: top; font-size: inherit; line-height: 1.5; }
        .share-note-content th { font-family: ${mono}; font-size: 0.85em; letter-spacing: 0.04em; color: var(--dl-highlight); font-weight: 400; text-transform: uppercase; border-bottom: 1px solid var(--dl-border2); }
        .share-note-content td { color: var(--dl-strong); }
        .share-note-content tr:last-child td { border-bottom: none; }
        .share-chip { display:inline; font-family:${mono}; font-size:0.8em; letter-spacing:0.06em; padding:1px 6px; border-radius:999px; text-transform:uppercase; white-space:nowrap; }
      `}</style>

      <div style={{ maxWidth: 620, margin: '0 auto', padding: '16px 12px 200px', minHeight: '100vh', background: 'var(--dl-bg)' }}>
        {/* Header — matches ProjectView header style */}
        <div style={{
          padding: '10px 0 14px',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{
            fontFamily: mono, fontSize: 10, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: accent, fontWeight: 600,
          }}>{project.name}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* ── Notes Card ───────────────────────────────────────────── */}
          {hasNotes && (
            <Card label="Notes" color="var(--dl-highlight)" autoHeight>
              <div style={{ display: 'flex', minHeight: 220 }}>
                {/* Note list sidebar */}
                {notes.length > 1 && (
                  <>
                    <div style={{ width: 164, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto', maxHeight: 440, paddingRight: 2 }}>
                      {notes.map((note, i) => (
                        <button
                          key={i}
                          onClick={() => setActiveNoteIdx(i)}
                          style={{
                            background: i === activeNoteIdx ? 'var(--dl-well)' : 'transparent',
                            border: 'none', padding: '6px 8px', textAlign: 'left', cursor: 'pointer',
                            fontFamily: mono, fontSize: F.sm, letterSpacing: '0.08em', textTransform: 'uppercase',
                            color: i === activeNoteIdx ? 'var(--dl-strong)' : 'var(--dl-highlight)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            lineHeight: 1.5, borderRadius: 6, transition: 'background 0.1s',
                          }}
                        >{noteName(note)}</button>
                      ))}
                    </div>

                    {/* Divider */}
                    <div style={{ width: 1, flexShrink: 0, background: 'var(--dl-border)' }} />
                  </>
                )}

                {/* Note content */}
                <div style={{ flex: 1, minWidth: 0, paddingLeft: notes.length > 1 ? 10 : 0 }}>
                  {activeNoteImages.length > 0 && (
                    <NotePhotos images={activeNoteImages} />
                  )}
                  <div
                    className="share-note-content"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(activeNote?.content || '') }}
                  />
                </div>
              </div>
            </Card>
          )}

          {/* ── Tasks Card ───────────────────────────────────────────── */}
          {hasTasks && (
            <Card
              label={`Tasks · ${openTasks.length} open`}
              color="var(--dl-blue)" autoHeight
            >
              <div>
                {tasksByDate.map(([date, tasks], dateIdx) => (
                  <div key={date}>
                    <div style={{
                      fontFamily: mono, fontSize: 10,
                      color: 'var(--dl-highlight)',
                      letterSpacing: '0.06em', textTransform: 'uppercase',
                      marginTop: dateIdx === 0 ? 0 : 4, marginBottom: 6,
                    }}>{fmtDate(date)}</div>
                    {tasks.map((t, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '3px 0' }}>
                        <span style={{
                          width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 3,
                          border: t.done ? `1.5px solid var(--dl-blue)` : '1.5px solid var(--dl-border2)',
                          background: t.done ? 'var(--dl-blue)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {t.done && <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="var(--dl-bg)" strokeWidth="1.8" strokeLinecap="round"><polyline points="1.5,5 4,7.5 8.5,2"/></svg>}
                        </span>
                        <span style={{
                          fontFamily: serif, fontSize: F.md, lineHeight: '1.7', color: 'var(--dl-strong)',
                          textDecoration: t.done ? 'line-through' : 'none',
                          opacity: t.done ? 0.5 : 1,
                        }}>{textOnly(t.text)}</span>
                      </div>
                    ))}
                    <div style={{ borderTop: '1px solid var(--dl-border)', marginTop: 12, marginBottom: 4 }} />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── Journal Card ─────────────────────────────────────────── */}
          {hasJournal && (
            <Card
              label={`Journal · ${journalEntries.length}`}
              color="var(--dl-accent)" autoHeight
            >
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {journalByDate.map(([date, entries], dateIdx) => {
                  const dayImages = entries.flatMap(e => extractImages(e.content));
                  return (
                    <div key={date}>
                      <div style={{
                        fontFamily: mono, fontSize: 10,
                        color: 'var(--dl-highlight)',
                        letterSpacing: '0.06em', textTransform: 'uppercase',
                        marginTop: dateIdx === 0 ? 0 : 4, marginBottom: 8,
                      }}>{fmtDate(date)}</div>
                      {dayImages.length > 0 && <NotePhotos images={dayImages} />}
                      {entries.map((e, i) => (
                        <div key={i}
                          className="share-note-content"
                          style={{ padding: '2px 0' }}
                          dangerouslySetInnerHTML={{ __html: sanitizeHtml(e.content || '') }}
                        />
                      ))}
                      <div style={{ borderTop: '1px solid var(--dl-border)', marginTop: 16, marginBottom: 4 }} />
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

        </div>

        {/* Footer */}
        <div style={{
          marginTop: 48, paddingTop: 16, borderTop: '1px solid var(--dl-border)',
          textAlign: 'center', fontFamily: mono, fontSize: 11, letterSpacing: '0.06em',
        }}>
          <span style={{ color: 'var(--dl-middle)' }}>Shared from </span>
          <span style={{ color: accent }}>Day Lab</span>
        </div>
      </div>
    </>
  );
}
