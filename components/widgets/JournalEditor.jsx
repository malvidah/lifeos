"use client";
import { useState, useEffect, useRef, useCallback, useContext, useMemo, Fragment } from "react";
import { mono, serif, F, R, projectColor } from "@/lib/tokens";
import { useDbSave } from "@/lib/db";
import { NoteContext, ProjectNamesContext, NavigationContext } from "@/lib/contexts";
import { RichLine, Shimmer, SourceBadge } from "../ui/primitives.jsx";
import { estimateNutrition, uploadImageFile, deleteImageFile } from "@/lib/images";
import { api } from "@/lib/api";
import { DayLabEditor } from "../Editor.jsx";

// Extract image URLs from journal/note content
export function extractImages(content) {
  if (!content) return [];
  const urls = [];
  let m;
  // Image chip format (inline spans)
  const chipRe = /data-image-chip="([^"]+)"/g;
  while ((m = chipRe.exec(content)) !== null) urls.push(m[1]);
  // Legacy: [img:url] text format
  const txtRe = /\[img:(https?:\/\/[^\]]+)\]/g;
  while ((m = txtRe.exec(content)) !== null) urls.push(m[1]);
  // Legacy: HTML imageblock format
  const htmlRe = /data-imageblock="([^"]+)"/g;
  while ((m = htmlRe.exec(content)) !== null) urls.push(m[1]);
  return [...new Set(urls)];
}

// ── Photo Strip ───────────────────────────────────────────────────────────────
// Horizontal scroll row of filled rounded squares. Click to open slideshow.
// Drag an image to reorder; click (without dragging) opens slideshow.
const SIZE = 140;

export function PhotoStrip({ images, onViewImage, onReorder }) {
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const didDrag = useRef(false);

  if (!images.length) return null;

  const canReorder = !!onReorder && images.length > 1;

  const onDragStart = (e, i) => {
    setDragIdx(i);
    didDrag.current = false;
    e.dataTransfer.effectAllowed = 'move';
    // Transparent drag image — the inline style changes provide the visual feedback
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    e.dataTransfer.setDragImage(canvas, 0, 0);
  };

  const onDragOver = (e, i) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (i !== overIdx) setOverIdx(i);
    didDrag.current = true;
  };

  const onDrop = (e, i) => {
    e.preventDefault();
    if (dragIdx != null && dragIdx !== i && onReorder) {
      const arr = [...images];
      const [moved] = arr.splice(dragIdx, 1);
      arr.splice(i, 0, moved);
      onReorder(arr);
    }
    setDragIdx(null);
    setOverIdx(null);
  };

  const onDragEnd = () => {
    setDragIdx(null);
    setOverIdx(null);
    // Prevent the click handler from also firing after a drag
    setTimeout(() => { didDrag.current = false; }, 100);
  };

  return (
    <div style={{
      display: 'flex', gap: 4, overflowX: 'auto', overflowY: 'hidden',
      marginBottom: 12, borderRadius: 10,
      scrollbarWidth: 'none', msOverflowStyle: 'none',
      WebkitOverflowScrolling: 'touch',
      userSelect: 'none',
    }}>
      {images.map((url, i) => {
        const isDragged = dragIdx === i;
        const isOver = overIdx === i && dragIdx != null && dragIdx !== i;
        return (
          <div
            key={url}
            draggable={canReorder}
            onDragStart={canReorder ? e => onDragStart(e, i) : undefined}
            onDragOver={canReorder ? e => onDragOver(e, i) : undefined}
            onDrop={canReorder ? e => onDrop(e, i) : undefined}
            onDragEnd={canReorder ? onDragEnd : undefined}
            onClick={() => { if (!didDrag.current) onViewImage(i); }}
            style={{
              width: SIZE, height: SIZE, flexShrink: 0,
              borderRadius: 10, overflow: 'visible',
              cursor: 'pointer', background: 'var(--dl-well)',
              opacity: isDragged ? 0.35 : 1,
              outline: isOver ? '2px solid var(--dl-accent)' : '2px solid transparent',
              outlineOffset: -2,
              transform: isOver ? 'scale(1.06)' : 'scale(1)',
              transition: 'opacity 0.15s, transform 0.15s, outline-color 0.15s',
              borderRadius: 10,
            }}
            onMouseEnter={e => { if (dragIdx == null) e.currentTarget.style.opacity = '0.85'; }}
            onMouseLeave={e => { if (dragIdx == null) e.currentTarget.style.opacity = '1'; }}
          >
            <img src={url} alt="" loading="lazy" draggable="false" style={{
              width: '100%', height: '100%', objectFit: 'cover', display: 'block',
              borderRadius: 10, pointerEvents: 'none',
            }} />
          </div>
        );
      })}
    </div>
  );
}

// ── Slideshow ─────────────────────────────────────────────────────────────────
// Wide rectangle with chevrons, dots, and X to close.
export function Slideshow({ images, index, onClose }) {
  const [idx, setIdx] = useState(index);
  const pointerStart = useRef(null);

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

  // Unified pointer (mouse + touch) swipe
  const onPointerDown = (e) => { pointerStart.current = e.clientX; };
  const onPointerUp = (e) => {
    if (pointerStart.current == null) return;
    const diff = e.clientX - pointerStart.current;
    if (Math.abs(diff) > 40) { diff > 0 ? prev() : next(); }
    pointerStart.current = null;
  };

  return (
    <div style={{ marginBottom: 12, position: 'relative', borderRadius: 10, overflow: 'hidden', background: 'var(--dl-well)', cursor: 'grab', userSelect: 'none' }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <img src={images[idx]} alt="" style={{ width: '100%', aspectRatio: '4/3', objectFit: 'contain', display: 'block' }} />

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

      {/* Right chevron */}
      {images.length > 1 && (
        <div onClick={next} style={{
          position: 'absolute', right: 0, top: 0, bottom: 0, width: 48,
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
export function DropZone({ uploading }) {
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
  // null = strip mode (default), 0+ = slideshow at that index.
  // Always starts in strip — slideshow only opens on explicit user click.
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const dragCounter = useRef(0);

  const images = useMemo(() => extractImages(value), [value]);

  // Persist mode preference to user_settings for public share pages only
  useEffect(() => {
    const mode = lightboxIdx != null ? 'slideshow' : 'strip';
    try { localStorage.setItem('daylab:photoMode', mode); } catch {}
    if (token) api.patch('/api/settings', { photoMode: mode }, token).catch(() => {});
  }, [lightboxIdx != null]); // eslint-disable-line

  // Close slideshow when navigating to a day with no images
  useEffect(() => {
    if (images.length === 0 && lightboxIdx != null) setLightboxIdx(null);
    // Clamp index if beyond available images
    if (lightboxIdx != null && images.length > 0 && lightboxIdx >= images.length) {
      setLightboxIdx(0);
    }
  }, [images.length]); // eslint-disable-line

  // Format date for chip label: "Mar 16"
  const chipDate = useMemo(() => {
    if (!date) return '';
    const [y, m, d] = date.split('-').map(Number);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[m - 1]} ${d}`;
  }, [date]);

  // Reorder images in journal content to match new order
  const reorderImages = useCallback((newOrder) => {
    setValue(prev => {
      if (!prev) return prev;
      let content = prev;
      // Remove all image references (chips, imageblocks, [img:] tags)
      content = content.replace(/<span\s+data-image-chip="[^"]*"[^>]*>[^<]*<\/span>\s*/g, '');
      content = content.replace(/<div\s+data-imageblock="[^"]*"[^>]*>[\s\S]*?<\/div>/g, '');
      content = content.replace(/\[img:https?:\/\/[^\]]+\]\n?/g, '');
      // Clean up empty paragraphs left behind
      content = content.replace(/<p>\s*<\/p>/g, '');
      // Re-add images in new order as chips
      const chips = newOrder.map(url =>
        `<span data-image-chip="${url}" data-chip-label="${chipDate}">\u{1F4F7}</span> `
      ).join('');
      if (chips) {
        if (content.includes('</p>')) {
          content = content.replace(/<\/p>\s*$/, chips + '</p>');
        } else {
          content = (content || '') + `<p>${chips}</p>`;
        }
      }
      return content;
    }, { undoLabel: 'Reorder photos' });
  }, [setValue, chipDate]);

  // Append image chip to journal content
  const addImage = useCallback((url) => {
    setValue(prev => {
      if (prev && prev.includes(url)) return prev;
      const chipHtml = `<span data-image-chip="${url}" data-chip-label="${chipDate}">\u{1F4F7}</span> `;
      if (prev && prev.includes('</p>')) {
        return prev.replace(/<\/p>\s*$/, chipHtml + '</p>');
      }
      return (prev || '') + `<p>${chipHtml}</p>`;
    }, { undoLabel: 'Add photo' });
  }, [setValue, chipDate]);

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
      {lightboxIdx != null && images.length > 0 ? (
        <Slideshow images={images} index={lightboxIdx} onClose={() => setLightboxIdx(null)} />
      ) : images.length > 0 ? (
        <PhotoStrip images={images} onViewImage={i => setLightboxIdx(i)} onReorder={reorderImages} />
      ) : null}
      {(dragging || uploading) ? (
        <DropZone uploading={uploading} />
      ) : (
        <DayLabEditor
          key={date}
          value={value || ''}
          onBlur={html => setValue(html, {undoLabel: 'Edit notes'})}
          onUpdate={html => markDirty(html)}
          onImageUpload={file => uploadImageFile(file, token)}
          onImageDelete={src => deleteImageFile(src, token)}
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
