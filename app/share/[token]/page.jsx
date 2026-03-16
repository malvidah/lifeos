"use client";
import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import "@/components/theme/theme.css";

// Extract image URLs from HTML content (imageChip spans and imageBlock divs)
function extractImages(html) {
  if (!html) return [];
  const urls = [];
  // Inline image chips: <span data-image-chip="URL">
  const chipRe = /data-image-chip="([^"]+)"/g;
  let m;
  while ((m = chipRe.exec(html)) !== null) urls.push(m[1]);
  // Block images: <div data-imageblock="URL"> or [img:URL]
  const blockRe = /data-imageblock="([^"]+)"/g;
  while ((m = blockRe.exec(html)) !== null) urls.push(m[1]);
  const txtRe = /\[img:(https?:\/\/[^\]]+)\]/g;
  while ((m = txtRe.exec(html)) !== null) urls.push(m[1]);
  return [...new Set(urls)];
}

// Sanitize HTML: keep structure but strip image chips (rendered separately),
// interactive chips, and inline styles
function sanitizeHtml(html) {
  if (!html) return '';
  return html
    .replace(/<span[^>]*data-image-chip="[^"]*"[^>]*>[\s\S]*?<\/span>/g, '') // remove image chips
    .replace(/<div[^>]*data-imageblock="[^"]*"[^>]*>[\s\S]*?<\/div>/g, '') // remove image blocks
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
    .replace(/<span[^>]*data-image-chip="[^"]*"[^>]*>[\s\S]*?<\/span>/g, '')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

// ── Photo Strip + Slideshow ─────────────────────────────────────────────────

function PhotoStrip({ images, onSelect }) {
  if (!images.length) return null;
  return (
    <div style={{display:'flex',gap:6,overflowX:'auto',padding:'8px 0 12px',scrollbarWidth:'none'}}>
      {images.map((src, i) => (
        <div key={i} onClick={() => onSelect(i)} style={{
          width:80, height:80, borderRadius:8, overflow:'hidden', flexShrink:0, cursor:'pointer',
          border:'1px solid var(--dl-border)',
        }}>
          <img src={src} alt="" style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}
            onError={e => { e.target.style.display='none'; }}/>
        </div>
      ))}
    </div>
  );
}

function Slideshow({ images, index, onClose, onPrev, onNext }) {
  return (
    <div style={{position:'relative',background:'var(--dl-well)',borderRadius:12,overflow:'hidden',marginBottom:12}}>
      <div style={{aspectRatio:'4/3',display:'flex',alignItems:'center',justifyContent:'center'}}>
        <img src={images[index]} alt="" style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain',display:'block'}}
          onError={e => { e.target.alt='Image not available'; }}/>
      </div>
      {/* Navigation */}
      {images.length > 1 && (
        <>
          <button onClick={onPrev} style={navBtn('left')}>&#8249;</button>
          <button onClick={onNext} style={navBtn('right')}>&#8250;</button>
        </>
      )}
      <button onClick={onClose} style={{
        position:'absolute',top:8,right:8,background:'rgba(0,0,0,0.5)',color:'#fff',
        border:'none',borderRadius:'50%',width:28,height:28,cursor:'pointer',fontSize:16,
        display:'flex',alignItems:'center',justifyContent:'center',
      }}>&times;</button>
      {images.length > 1 && (
        <div style={{textAlign:'center',padding:'6px 0',fontSize:12,color:'var(--dl-middle)',
          fontFamily:"'SF Mono','Fira Code',ui-monospace,monospace"}}>
          {index + 1} / {images.length}
        </div>
      )}
    </div>
  );
}

function navBtn(side) {
  return {
    position:'absolute', top:'50%', [side]:8, transform:'translateY(-50%)',
    background:'rgba(0,0,0,0.4)', color:'#fff', border:'none', borderRadius:'50%',
    width:32, height:32, cursor:'pointer', fontSize:20, display:'flex',
    alignItems:'center', justifyContent:'center',
  };
}

// ── Photo section for a note ────────────────────────────────────────────────
function NotePhotos({ images }) {
  const [mode, setMode] = useState('strip'); // 'strip' | 'slideshow'
  const [idx, setIdx] = useState(0);
  if (!images.length) return null;

  if (mode === 'slideshow') {
    return (
      <Slideshow images={images} index={idx}
        onClose={() => setMode('strip')}
        onPrev={() => setIdx((idx - 1 + images.length) % images.length)}
        onNext={() => setIdx((idx + 1) % images.length)}
      />
    );
  }
  return <PhotoStrip images={images} onSelect={i => { setIdx(i); setMode('slideshow'); }}/>;
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function SharedProjectPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

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
        .note-content h1 { font-size: 13px; font-weight: 400; margin: 0 0 12px; color: var(--dl-strong); font-family: 'SF Mono','Fira Code',ui-monospace,monospace; text-transform: uppercase; letter-spacing: 0.08em; }
        .note-content p { font-size: 15px; line-height: 1.75; color: var(--dl-strong); margin: 0 0 8px; }
        .note-content em { font-style: normal; color: ${accent}; font-weight: 500; }
        .note-content ul, .note-content ol { padding-left: 20px; margin: 4px 0 8px; }
        .note-content li { font-size: 15px; line-height: 1.75; color: var(--dl-strong); }
        .note-content table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 15px; }
        .note-content th, .note-content td { padding: 6px 12px; text-align: left; vertical-align: top; border: 1px solid var(--dl-border); color: var(--dl-strong); line-height: 1.6; }
        .note-content th { font-weight: 600; background: var(--dl-surface); }
        @media print { .share-page { padding: 0; } .share-footer { display: none; } }
      `}</style>
      <div className="share-page" style={s.page}>
        <header style={s.header}>
          <div style={{...s.projectLabel, color: accent}}>{project.name}</div>
        </header>

        {hasNotes && notes.map((n, i) => {
          const images = extractImages(n.content);
          return (
            <section key={i} style={s.noteSection}>
              {images.length > 0 && <NotePhotos images={images}/>}
              <div className="note-content"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(n.content || '') }}
              />
              {n.updated_at && (
                <div style={s.datestamp}>{fmtDate(n.updated_at.split('T')[0])}</div>
              )}
            </section>
          );
        })}

        {hasJournal && (
          <section style={s.section}>
            <div style={s.sectionLabel}>Journal</div>
            {Object.entries(journalByDate).map(([date, entries]) => {
              const dayImages = entries.flatMap(e => extractImages(e.content));
              return (
                <div key={date} style={s.journalDay}>
                  <div style={s.datestamp}>{fmtDate(date)}</div>
                  {dayImages.length > 0 && <NotePhotos images={dayImages}/>}
                  {entries.map((e, i) => (
                    <div key={i} className="note-content"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(e.content || '') }}
                    />
                  ))}
                </div>
              );
            })}
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
