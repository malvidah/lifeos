"use client";
import { useState, useEffect, useRef, useCallback, useContext, useMemo, Fragment } from "react";
import { mono, serif, F, R, projectColor } from "@/lib/tokens";
import { useDbSave } from "@/lib/db";
import { NoteContext, ProjectNamesContext, NavigationContext } from "@/lib/contexts";
import { RichLine, Shimmer, SourceBadge } from "../ui/primitives.jsx";
import { estimateNutrition, uploadImageFile } from "@/lib/images";
import { DayLabEditor } from "../Editor.jsx";

// Extract image URLs from journal content
function extractImages(content) {
  if (!content) return [];
  const urls = [];
  // [img:url] text format
  const txtRe = /\[img:(https?:\/\/[^\]]+)\]/g;
  let m;
  while ((m = txtRe.exec(content)) !== null) urls.push(m[1]);
  // HTML imageblock format
  const htmlRe = /data-imageblock="([^"]+)"/g;
  while ((m = htmlRe.exec(content)) !== null) urls.push(m[1]);
  return [...new Set(urls)];
}

// ── Photo Strip ───────────────────────────────────────────────────────────────
// Horizontal scroll row of filled rounded squares. Click to open slideshow.
function PhotoStrip({ images, onViewImage }) {
  if (!images.length) return null;
  // Height: ~half the card width. Using a fixed-ish height that feels compact.
  const SIZE = 140;
  return (
    <div style={{
      display: 'flex', gap: 4, overflowX: 'auto', overflowY: 'hidden',
      marginBottom: 6, borderRadius: 10,
      scrollbarWidth: 'none', msOverflowStyle: 'none',
      WebkitOverflowScrolling: 'touch',
    }}>
      {images.map((url, i) => (
        <div
          key={url}
          onClick={() => onViewImage(i)}
          style={{
            width: images.length === 1 ? '100%' : SIZE,
            height: SIZE, flexShrink: 0,
            borderRadius: 10, overflow: 'hidden',
            cursor: 'pointer', background: 'var(--dl-well)',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >
          <img src={url} alt="" loading="lazy" style={{
            width: '100%', height: '100%', objectFit: 'cover', display: 'block',
          }} />
        </div>
      ))}
    </div>
  );
}

// ── Slideshow ─────────────────────────────────────────────────────────────────
// Wide rectangle with chevrons, dots, and X to close.
function Slideshow({ images, index, onClose }) {
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
    <div style={{ marginBottom: 6, position: 'relative', borderRadius: 10, overflow: 'hidden', background: 'var(--dl-well)' }}
      onTouchStart={e => { touchStart.current = e.touches[0].clientX; }}
      onTouchEnd={e => {
        if (touchStart.current == null) return;
        const diff = e.changedTouches[0].clientX - touchStart.current;
        if (Math.abs(diff) > 50) { diff > 0 ? prev() : next(); }
        touchStart.current = null;
      }}
    >
      <img src={images[idx]} alt="" style={{ width: '100%', aspectRatio: '16/10', objectFit: 'contain', display: 'block' }} />

      {/* Left chevron */}
      {images.length > 1 && (
        <div onClick={prev} style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: 48,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: 'rgba(255,255,255,0.5)', transition: 'color 0.15s',
        }}
          onMouseEnter={e => e.currentTarget.style.color = '#fff'}
          onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'}
        >
          <span style={{ fontSize: 22, fontFamily: mono, textShadow: '0 1px 6px rgba(0,0,0,0.5)' }}>‹</span>
        </div>
      )}

      {/* Right chevron — stops below the X button area */}
      {images.length > 1 && (
        <div onClick={next} style={{
          position: 'absolute', right: 0, top: 40, bottom: 0, width: 48,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: 'rgba(255,255,255,0.5)', transition: 'color 0.15s',
        }}
          onMouseEnter={e => e.currentTarget.style.color = '#fff'}
          onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'}
        >
          <span style={{ fontSize: 22, fontFamily: mono, textShadow: '0 1px 6px rgba(0,0,0,0.5)' }}>›</span>
        </div>
      )}

      {/* Close X — top right, above chevrons */}
      <button onClick={e => { e.stopPropagation(); onClose(); }} style={{
        position: 'absolute', top: 8, right: 8, zIndex: 2,
        background: 'rgba(0,0,0,0.4)', border: 'none', borderRadius: 100,
        width: 28, height: 28, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'rgba(255,255,255,0.6)', transition: 'color 0.15s, background 0.15s',
      }}
        onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(0,0,0,0.6)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; e.currentTarget.style.background = 'rgba(0,0,0,0.4)'; }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>

      {/* Dots */}
      {images.length > 1 && (
        <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6 }}>
          {images.map((_, i) => (
            <div key={i} onClick={() => setIdx(i)} style={{
              width: 6, height: 6, borderRadius: '50%', cursor: 'pointer',
              background: i === idx ? '#fff' : 'rgba(255,255,255,0.35)',
              transition: 'background 0.2s',
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Drop Zone ─────────────────────────────────────────────────────────────────
function DropZone({ uploading }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: 80, padding: '24px 0', opacity: 0.5,
    }}>
      <span style={{
        fontFamily: mono, fontSize: F.sm, letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: uploading ? 'var(--dl-accent)' : 'var(--dl-middle)',
      }}>
        {uploading ? 'uploading…' : 'drop photos'}
      </span>
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
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const dragCounter = useRef(0);

  const images = useMemo(() => extractImages(value), [value]);

  // Append image to journal content (as imageblock HTML for persistence)
  const addImage = useCallback((url) => {
    setValue(prev => {
      if (prev && prev.includes(url)) return prev;
      const imgHtml = `<div data-imageblock="${url}" style="margin:4px 0;line-height:0"><img src="${url}" style="max-width:100%;border-radius:8px;display:block" /></div>`;
      return (prev || '') + imgHtml;
    }, { undoLabel: 'Add photo' });
  }, [setValue]);

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
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {lightboxIdx != null ? (
        <Slideshow images={images} index={lightboxIdx} onClose={() => setLightboxIdx(null)} />
      ) : (
        <PhotoStrip images={images} onViewImage={i => setLightboxIdx(i)} />
      )}
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
          placeholder="What's on your mind?"
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
