"use client";
import { useState, useEffect, useRef, useCallback, useContext, useMemo, Fragment } from "react";
import { mono, serif, F, R, projectColor } from "@/lib/tokens";
import { useDbSave } from "@/lib/db";
import { NoteContext, ProjectNamesContext, NavigationContext } from "@/lib/contexts";
import { RichLine, Shimmer, SourceBadge } from "../ui/primitives.jsx";
import { estimateNutrition, uploadImageFile } from "@/lib/images";
import { DayLabEditor } from "../Editor.jsx";

// Extract image URLs from journal content (stored as [img:url])
function extractImages(content) {
  if (!content) return [];
  const urls = [];
  const re = /\[img:(https?:\/\/[^\]]+)\]/g;
  let m;
  while ((m = re.exec(content)) !== null) urls.push(m[1]);
  // Also match HTML imageblock format
  const htmlRe = /data-imageblock="([^"]+)"/g;
  while ((m = htmlRe.exec(content)) !== null) urls.push(m[1]);
  return [...new Set(urls)];
}

// ── Photo Grid ────────────────────────────────────────────────────────────────
function PhotoGrid({ images, onRemove }) {
  const [viewIdx, setViewIdx] = useState(null);
  if (!images.length) return null;

  if (viewIdx != null) {
    return <Lightbox images={images} index={viewIdx} onClose={() => setViewIdx(null)} />;
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: images.length === 1 ? '1fr' : 'repeat(auto-fill, minmax(100px, 1fr))',
      gap: 4, marginBottom: 8,
    }}>
      {images.map((url, i) => (
        <button
          key={url}
          onClick={() => setViewIdx(i)}
          style={{
            background: 'var(--dl-well)', border: 'none', borderRadius: 8,
            overflow: 'hidden', cursor: 'pointer', padding: 0, position: 'relative',
            aspectRatio: images.length === 1 ? 'auto' : '1',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >
          <img src={url} alt="" loading="lazy" style={{
            width: '100%',
            height: images.length === 1 ? 'auto' : '100%',
            maxHeight: images.length === 1 ? 280 : undefined,
            objectFit: images.length === 1 ? 'contain' : 'cover',
            display: 'block', borderRadius: 8,
          }} />
        </button>
      ))}
    </div>
  );
}

// ── Lightbox ──────────────────────────────────────────────────────────────────
function Lightbox({ images, index, onClose }) {
  const [idx, setIdx] = useState(index);
  const touchStart = useRef(null);
  const prev = () => setIdx(i => (i - 1 + images.length) % images.length);
  const next = () => setIdx(i => (i + 1) % images.length);

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
      <div
        style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: 'var(--dl-well)', cursor: 'pointer' }}
        onTouchStart={e => { touchStart.current = e.touches[0].clientX; }}
        onTouchEnd={e => {
          if (touchStart.current == null) return;
          const diff = e.changedTouches[0].clientX - touchStart.current;
          if (Math.abs(diff) > 50) { diff > 0 ? prev() : next(); }
          touchStart.current = null;
        }}
        onClick={next}
      >
        <img src={images[idx]} alt="" style={{ width: '100%', maxHeight: 420, objectFit: 'contain', display: 'block' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
        <span style={{ fontFamily: mono, fontSize: F.sm, color: 'var(--dl-middle)', letterSpacing: '0.06em' }}>
          {idx + 1} / {images.length}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {images.length > 1 && (
            <>
              <LbBtn onClick={e => { e.stopPropagation(); prev(); }}>‹</LbBtn>
              <LbBtn onClick={e => { e.stopPropagation(); next(); }}>›</LbBtn>
            </>
          )}
          <LbBtn onClick={e => { e.stopPropagation(); onClose(); }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </LbBtn>
        </div>
      </div>
    </div>
  );
}

function LbBtn({ onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: 'var(--dl-glass-active)', border: 'none', borderRadius: 100,
      width: 26, height: 26, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--dl-strong)', fontFamily: mono, fontSize: 13, transition: 'background 0.15s',
    }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--dl-border2)'}
      onMouseLeave={e => e.currentTarget.style.background = 'var(--dl-glass-active)'}
    >{children}</button>
  );
}

// ── Drop Zone Overlay ─────────────────────────────────────────────────────────
function DropZone({ uploading }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 12, padding: '32px 16px', minHeight: 120,
      border: '2px dashed var(--dl-border2)', borderRadius: 12,
      background: 'var(--dl-well)',
      animation: uploading ? 'none' : undefined,
    }}>
      {uploading ? (
        <>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--dl-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ animation: 'pulse 1.2s ease-in-out infinite' }}>
            <circle cx="12" cy="12" r="10" strokeOpacity="0.3"/>
            <path d="M12 6v6l4 2" />
          </svg>
          <span style={{ fontFamily: serif, fontSize: F.md, color: 'var(--dl-middle)' }}>
            Uploading...
          </span>
          <style>{`@keyframes pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }`}</style>
        </>
      ) : (
        <>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--dl-highlight)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <span style={{ fontFamily: serif, fontSize: F.md, color: 'var(--dl-middle)' }}>
            Drop photos here
          </span>
        </>
      )}
    </div>
  );
}

// ── JournalEditor ─────────────────────────────────────────────────────────────
export function JournalEditor({date,userId,token}) {
  const {value, setValue, loaded, markDirty} = useDbSave(date, 'journal', '', token, userId);
  const { notes: ctxNotes } = useContext(NoteContext);
  const ctxProjects = useContext(ProjectNamesContext);
  const { navigateToProject, navigateToNote } = useContext(NavigationContext);

  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dragCounter = useRef(0);
  const containerRef = useRef(null);

  const images = useMemo(() => extractImages(value), [value]);

  // Helper: append an image to the journal value
  const addImage = useCallback((url) => {
    setValue(prev => {
      const imgBlock = `[img:${url}]`;
      // Don't add duplicate
      if (prev && prev.includes(imgBlock)) return prev;
      return (prev || '') + '\n' + imgBlock;
    }, { undoLabel: 'Add photo' });
  }, [setValue]);

  // Handle file drop on the journal container
  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragging(false);

    const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
    if (!files.length || !token) return;

    setUploading(true);
    try {
      const urls = await Promise.all(files.map(f => uploadImageFile(f, token)));
      urls.filter(Boolean).forEach(url => addImage(url));
    } finally {
      setUploading(false);
    }
  }, [token, addImage]);

  // Track drag enter/leave on the container (not individual children)
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer?.types?.includes('Files')) setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) { dragCounter.current = 0; setDragging(false); }
  }, []);

  const handleDragOver = useCallback((e) => { e.preventDefault(); }, []);

  if (!loaded) return (
    <div style={{display:'flex',flexDirection:'column',gap:10,padding:'4px 0'}}>
      <Shimmer width="80%" height={14}/>
      <Shimmer width="60%" height={14}/>
      <Shimmer width="70%" height={14}/>
    </div>
  );

  return (
    <div
      ref={containerRef}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <PhotoGrid images={images} />
      {(dragging || uploading) ? (
        <DropZone uploading={uploading} />
      ) : (
        <DayLabEditor
          value={value || ''}
          onBlur={html => setValue(html, {undoLabel: 'Edit notes'})}
          onUpdate={html => markDirty(html)}
          onImageUpload={file => uploadImageFile(file, token)}
          noteNames={ctxNotes}
          projectNames={ctxProjects}
          onProjectClick={name => navigateToProject(name)}
          onNoteClick={name => navigateToNote(name)}
          placeholder="What's on your mind? Use / for commands."
          textColor={"var(--dl-strong)"}
          mutedColor={"var(--dl-middle)"}
          color={"var(--dl-accent)"}
          hideInlineImages
          style={{minHeight: 80, width: '100%'}}
        />
      )}
    </div>
  );
}

// ─── RowList ─────────────────────────────────────────────────────────────────
// Single multi-line editor where each paragraph = one item.
// syncedRows: live from API, rendered read-only above the editor.
// AI estimates for synced rows persist to DB under type+"_kcal" key.

function htmlToLines(html) {
  if (!html || typeof html !== 'string') return [];
  return html.split(/<\/p>\s*<p[^>]*>|<br\s*\/?>/)
    .map(s => s.replace(/<[^>]*>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim())
    .filter(Boolean);
}

function linesToHtml(lines) {
  return lines.map(l => `<p>${l.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</p>`).join('');
}

function rowsToHtml(rows) {
  const lines = (rows || []).filter(r => r.text?.trim()).map(r => r.text);
  return lines.length ? linesToHtml(lines) : '';
}

export function RowList({date,type,placeholder,promptFn,prefix,color,token,userId,syncedRows=[],showProtein=false}) {
  const {value:rows, setValue:setRows, loaded} = useDbSave(date, type, [], token, userId);
  const {value:savedEstimates, setValue:setSavedEstimates, loaded:estimatesLoaded} = useDbSave(date, type+"_kcal", {}, token, userId);
  const estimating = useRef(new Set());
  const failed = useRef(new Set());
  const [tick, setTick] = useState(0);

  const safe = Array.isArray(rows) ? rows : [];
  const estMap = (estimatesLoaded && savedEstimates && typeof savedEstimates === "object") ? savedEstimates : {};

  // Build a lookup from text → row data for preserving kcal/protein across edits
  const rowByText = useRef(new Map());
  useEffect(() => {
    const m = new Map();
    for (const r of safe) { if (r.text?.trim()) m.set(r.text.trim(), r); }
    rowByText.current = m;
  }, [safe]);

  // Merge saved AI estimates into synced rows
  const merged = syncedRows.map(r => {
    const saved = estMap[r.id];
    const kcal = r.kcal || (typeof saved === "object" ? saved?.kcal : saved) || null;
    const protein = r.protein || (typeof saved === "object" ? saved?.protein : null) || null;
    return {...r, kcal, protein};
  });
  const totalKcal = [...safe, ...merged].reduce((s,r) => s + (r.kcal||0), 0);
  const totalProtein = showProtein ? [...safe, ...merged].reduce((s,r) => s + (r.protein||0), 0) : 0;

  // Estimate for manual rows with no kcal
  useEffect(() => {
    if (!token || !loaded) return;
    safe
      .filter(r => r.text?.trim() && !r.kcal && !estimating.current.has(r.text) && !failed.current.has(r.text))
      .forEach(row => {
        estimating.current.add(row.text);
        estimateNutrition(promptFn(row.text), token).then(result => {
          estimating.current.delete(row.text);
          if (result) setRows(prev => (Array.isArray(prev)?prev:[]).map(r =>
            r.text===row.text ? {...r, kcal:result.kcal||null, protein:result.protein||null} : r));
          else failed.current.add(row.text);
          setTick(t => t + 1);
        });
      });
  }, [safe.map(r=>r.text).join("\n"), loaded, token]); // eslint-disable-line

  // Estimate for synced rows with no native calories
  useEffect(() => {
    if (!token || !loaded || !estimatesLoaded) return;
    merged
      .filter(r => !r.kcal && r.text && !estimating.current.has(r.id) && !failed.current.has(r.id))
      .forEach(row => {
        estimating.current.add(row.id);
        estimateNutrition(promptFn(row.text), token).then(result => {
          estimating.current.delete(row.id);
          if (result) setSavedEstimates(prev => ({...(typeof prev==="object"&&prev?prev:{}), [row.id]:result}));
          else failed.current.add(row.id);
          setTick(t => t + 1);
        });
      });
  }, [syncedRows, loaded, estimatesLoaded, token]); // eslint-disable-line

  // Auto-fill missing protein
  useEffect(() => {
    if (!showProtein || !token || !loaded) return;
    safe
      .filter(r => r.text?.trim() && r.kcal && !r.protein && !estimating.current.has(r.text+"_p") && !failed.current.has(r.text+"_p"))
      .forEach(row => {
        estimating.current.add(row.text+"_p");
        estimateNutrition(promptFn(row.text), token).then(result => {
          estimating.current.delete(row.text+"_p");
          if (result?.protein) {
            setRows(prev => (Array.isArray(prev)?prev:[]).map(r =>
              r.text===row.text ? {...r, protein:result.protein, kcal:result.kcal||r.kcal} : r));
          } else failed.current.add(row.text+"_p");
          setTick(t => t + 1);
        });
      });
  }, [loaded, token, showProtein]); // eslint-disable-line

  // Convert editor HTML → rows array, preserving kcal for unchanged lines
  function parseEditorHtml(html) {
    const lines = htmlToLines(html);
    const usedTexts = new Set();
    return lines.map(text => {
      const existing = rowByText.current.get(text);
      if (existing && !usedTexts.has(text)) {
        usedTexts.add(text);
        return existing;
      }
      return { id: Date.now() + Math.random(), text, kcal: null, protein: null };
    });
  }
  function handleBlur(html) { setRows(parseEditorHtml(html)); }
  const updateTimer = useRef(null);
  function handleUpdate(html) {
    clearTimeout(updateTimer.current);
    updateTimer.current = setTimeout(() => setRows(parseEditorHtml(html)), 400);
  }

  if (!loaded) return (
    <div style={{display:"flex",flexDirection:"column",gap:8,padding:"4px 0"}}>
      <Shimmer width="75%" height={13}/>
      <Shimmer width="55%" height={13}/>
      <Shimmer width="65%" height={13}/>
    </div>
  );

  // Per-line stats for the stats column
  const manualLines = safe.filter(r => r.text?.trim());
  const chipBase = {fontFamily:mono, fontSize:F.sm, letterSpacing:"0.04em", flexShrink:0,
    borderRadius:4, padding:"2px 8px", whiteSpace:"nowrap"};
  const PROT_W = 50, ENRG_W = 72;
  const statStyle = {display:"flex",alignItems:"center",justifyContent:"center",height:28};
  const colProtein = {fontFamily:mono, fontSize:F.sm, color:"var(--dl-blue)", width:PROT_W, textAlign:"center", whiteSpace:"nowrap"};
  const colKcal = {fontFamily:mono, fontSize:F.sm, color:"var(--dl-orange)", width:ENRG_W, textAlign:"center", whiteSpace:"nowrap"};
  const colMuted = {fontFamily:mono, fontSize:F.sm, color:"var(--dl-highlight)", textAlign:"center", whiteSpace:"nowrap"};
  const rowStyle = {display:"flex", alignItems:"center", gap:0, padding:"3px 0", minHeight:28};

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
      <div style={{flex:1,overflowY:"auto",minHeight:0}}>
        {/* Synced rows (read-only) */}
        {merged.map(row => (
          <div key={row.id} style={rowStyle}>
            <span style={{lineHeight:1.7,flex:1,minWidth:0}}>
              <RichLine text={row.text}/>
            </span>
            <SourceBadge source={row.source}/>
            {showProtein && (
              <span style={row.protein ? colProtein : {...colMuted,width:PROT_W}}>
                {estimating.current.has(row.id) ? "…" : row.protein ? `${row.protein}g` : "—"}
              </span>
            )}
            <span style={row.kcal ? colKcal : {...colMuted,width:ENRG_W}}>
              {estimating.current.has(row.id) ? "…" : row.kcal ? `${row.kcal}kcal` : "—"}
            </span>
          </div>
        ))}
        {/* Manual entries — single multi-line editor + stats column */}
        <div style={{display:"flex",gap:0}}>
          <DayLabEditor
            value={rowsToHtml(safe)}
            onBlur={handleBlur}
            onUpdate={handleUpdate}
            placeholder={merged.length === 0 ? placeholder : ""}
            textColor={"var(--dl-strong)"}
            mutedColor={"var(--dl-middle)"}
            color={"var(--dl-accent)"}
            style={{flex:1,padding:0,minHeight:28}}
          />
          {manualLines.length > 0 && (
            <div style={{flexShrink:0,display:"flex",flexDirection:"column"}}>
              {manualLines.map((row,i) => (
                <div key={i} style={{...statStyle,gap:0}}>
                  {showProtein && (
                    <span style={row.protein ? colProtein : {...colMuted,width:PROT_W}}>
                      {estimating.current.has(row.text) ? "…" : row.protein ? `${row.protein}g` : "—"}
                    </span>
                  )}
                  <span style={row.kcal ? colKcal : {...colMuted,width:ENRG_W}}>
                    {estimating.current.has(row.text) ? "…" : row.kcal ? `${row.kcal}kcal` : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {(totalKcal > 0 || totalProtein > 0) && (
        <div style={{flexShrink:0,paddingTop:6,display:"flex",alignItems:"center",gap:0,borderTop:"1px solid var(--dl-border)"}}>
          <div style={{flex:1}}/>
          {showProtein && (
            <div style={{width:PROT_W,display:"flex",justifyContent:"center"}}>
              {totalProtein > 0 && <span style={{...chipBase,background:"var(--dl-blue-13)",color:"var(--dl-blue)"}}>{totalProtein}g</span>}
            </div>
          )}
          <div style={{width:ENRG_W,display:"flex",justifyContent:"center"}}>
            {totalKcal > 0 && <span style={{...chipBase,background:"var(--dl-orange-13)",color:"var(--dl-orange)"}}>{totalKcal}kcal</span>}
          </div>
        </div>
      )}
    </div>
  );
}


export function Meals({date,token,userId}) { return <RowList date={date} type="meals" token={token} userId={userId} placeholder="What did you eat?" promptFn={t=>`Estimate calories and protein for this meal: "${t}". Assume a typical single-serving portion unless a quantity is specified. Be accurate — don't round to convenient numbers. Examples: "avocado toast" → {"kcal":280,"protein":8}, "chicken breast with rice" → {"kcal":480,"protein":42}, "greek yogurt with berries" → {"kcal":180,"protein":15}. Return ONLY JSON: {"kcal":number,"protein":number}`} prefix="" color={"var(--dl-accent)"} showProtein/>; }

export function AddJournalLine({ project, onAdd, placeholder }) {
  const col = project && project !== '__everything__' ? projectColor(project) : "var(--dl-accent)";
  const ctxProjects = useContext(ProjectNamesContext);
  const ctxNotes    = useContext(NoteContext);
  const { navigateToProject, navigateToNote } = useContext(NavigationContext);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '2px 0' }}>
      <DayLabEditor
        singleLine
        placeholder={placeholder || 'Add an entry…'}
        projectNames={ctxProjects}
        noteNames={ctxNotes.notes}
        textColor={"var(--dl-strong)"}
        mutedColor={"var(--dl-middle)"}
        color={col}
        style={{ flex: 1, padding: 0 }}
        onProjectClick={name => navigateToProject(name)}
        onNoteClick={name => navigateToNote(name)}
        onEnterCommit={text => { if (text.trim()) onAdd(text.trim()); }}
        onBlur={text => { if (text.trim()) onAdd(text.trim()); }}
      />
    </div>
  );
}
