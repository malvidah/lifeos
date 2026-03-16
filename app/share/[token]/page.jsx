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

// Hash a project name to a deterministic color (same as the app's projectColor)
const PROJECT_PALETTE = ['#C17B4A','#7A9E6E','#6B8EB8','#A07AB0','#B08050','#5E9E8A','#B06878','#8A8A50'];
function projectColor(name) {
  let h = 0;
  for (let i = 0; i < (name||'').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PROJECT_PALETTE[h % PROJECT_PALETTE.length];
}

// Sanitize HTML: keep structure, render chips as styled inline elements,
// strip image chips (rendered separately in PhotoStrip/Slideshow)
function sanitizeHtml(html) {
  if (!html) return '';
  let s = html;
  // 1. Remove image chips/blocks (rendered separately)
  s = s.replace(/<span[^>]*data-image-chip="[^"]*"[^>]*>[\s\S]*?<\/span>/g, '');
  s = s.replace(/<div[^>]*data-imageblock="[^"]*"[^>]*>[\s\S]*?<\/div>/g, '');
  // 2. Strip inline styles and data attrs FIRST (before adding chip styles)
  // Preserve data-project-tag and data-note-link for step 3
  s = s.replace(/ style="[^"]*"/g, '');
  s = s.replace(/ data-(?!project-tag|note-link)[a-z-]+="[^"]*"/g, '');
  // 3. Replace project chips → styled pill with inline color
  s = s.replace(/<span[^>]*data-project-tag="([^"]*)"[^>]*>[^<]*<\/span>/g, (_, name) => {
    const col = projectColor(name);
    return `<span class="chip-project" style="color:${col};background:${col}22">${name.toUpperCase()}</span>`;
  });
  // 4. Replace note chips → styled square chip
  s = s.replace(/<span[^>]*data-note-link="([^"]*)"[^>]*>[^<]*<\/span>/g, (_, name) => {
    return `<span class="chip-note">${name}</span>`;
  });
  s = s.replace(/&nbsp;/g, ' ');
  return s;
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

// ── Photo Strip + Slideshow (matches app style) ─────────────────────────────

function PubPhotoStrip({ images, onSelect }) {
  if (!images.length) return null;
  return (
    <div style={{display:'flex',gap:4,overflowX:'auto',marginBottom:12,borderRadius:10,scrollbarWidth:'none',WebkitOverflowScrolling:'touch',userSelect:'none'}}>
      {images.map((src, i) => (
        <div key={i} onClick={() => onSelect(i)} style={{
          width:140, height:140, borderRadius:10, overflow:'hidden', flexShrink:0, cursor:'pointer',
          background:'var(--dl-well)',
        }}>
          <img src={src} alt="" style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}
            onError={e => { e.target.style.display='none'; }}/>
        </div>
      ))}
    </div>
  );
}

function PubSlideshow({ images, index, onClose }) {
  const [idx, setIdx] = useState(index);
  const prev = () => setIdx(i => (i - 1 + images.length) % images.length);
  const next = () => setIdx(i => (i + 1) % images.length);
  const mono = "'SF Mono','Fira Code',ui-monospace,monospace";

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div style={{marginBottom:12,position:'relative',borderRadius:10,overflow:'hidden',background:'var(--dl-well)'}}>
      <img src={images[idx]} alt="" style={{width:'100%',aspectRatio:'4/3',objectFit:'contain',display:'block'}}
        onError={e => { e.target.alt='Image not available'; }}/>

      {/* Left chevron */}
      {images.length > 1 && (
        <div onClick={prev} style={{
          position:'absolute',left:0,top:0,bottom:0,width:48,
          display:'flex',alignItems:'center',justifyContent:'center',
          cursor:'pointer',color:'rgba(255,255,255,0.5)',
        }}
          onMouseEnter={e => e.currentTarget.style.color='#fff'}
          onMouseLeave={e => e.currentTarget.style.color='rgba(255,255,255,0.5)'}
        ><span style={{fontSize:22,fontFamily:mono,textShadow:'0 1px 6px rgba(0,0,0,0.5)'}}>‹</span></div>
      )}
      {/* Right chevron */}
      {images.length > 1 && (
        <div onClick={next} style={{
          position:'absolute',right:0,top:0,bottom:0,width:48,
          display:'flex',alignItems:'center',justifyContent:'center',
          cursor:'pointer',color:'rgba(255,255,255,0.5)',
        }}
          onMouseEnter={e => e.currentTarget.style.color='#fff'}
          onMouseLeave={e => e.currentTarget.style.color='rgba(255,255,255,0.5)'}
        ><span style={{fontSize:22,fontFamily:mono,textShadow:'0 1px 6px rgba(0,0,0,0.5)'}}>›</span></div>
      )}
      {/* Close X */}
      <button onClick={onClose} style={{
        position:'absolute',top:8,right:8,zIndex:2,
        background:'rgba(0,0,0,0.4)',border:'none',borderRadius:100,
        width:28,height:28,cursor:'pointer',
        display:'flex',alignItems:'center',justifyContent:'center',
        color:'rgba(255,255,255,0.6)',
      }}
        onMouseEnter={e=>{e.currentTarget.style.color='#fff';e.currentTarget.style.background='rgba(0,0,0,0.6)';}}
        onMouseLeave={e=>{e.currentTarget.style.color='rgba(255,255,255,0.6)';e.currentTarget.style.background='rgba(0,0,0,0.4)';}}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      {/* Dots */}
      {images.length > 1 && (
        <div style={{position:'absolute',bottom:8,left:'50%',transform:'translateX(-50%)',display:'flex',gap:6}}>
          {images.map((_, i) => (
            <div key={i} onClick={() => setIdx(i)} style={{
              width:6,height:6,borderRadius:'50%',cursor:'pointer',
              background:i===idx?'#fff':'rgba(255,255,255,0.35)',
            }}/>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Photo section for a note ────────────────────────────────────────────────
function NotePhotos({ images, defaultMode = 'slideshow' }) {
  const [mode, setMode] = useState(defaultMode);
  const [idx, setIdx] = useState(0);
  if (!images.length) return null;

  if (mode === 'slideshow') {
    return <PubSlideshow images={images} index={idx} onClose={() => setMode('strip')} />;
  }
  return <PubPhotoStrip images={images} onSelect={i => { setIdx(i); setMode('slideshow'); }}/>;
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

  const { project, journalEntries, taskEntries, notes, photoMode } = data;
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
        .chip-project { display:inline-block; vertical-align:middle; border-radius:999px; padding:1px 7px; font-family:'SF Mono','Fira Code',ui-monospace,monospace; font-size:11px; letter-spacing:0.08em; line-height:1.65; text-transform:uppercase; white-space:nowrap; }
        .chip-note { display:inline-block; vertical-align:middle; color:var(--dl-strong); background:var(--dl-border); border-radius:4px; padding:1px 7px; font-family:'SF Mono','Fira Code',ui-monospace,monospace; font-size:11px; letter-spacing:0.08em; line-height:1.65; text-transform:uppercase; white-space:nowrap; }
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
              {images.length > 0 && <NotePhotos images={images} defaultMode={photoMode}/>}
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
                  {dayImages.length > 0 && <NotePhotos images={dayImages} defaultMode={photoMode}/>}
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
