"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "@/lib/theme";
import { serif, mono, F, projectColor } from "@/lib/tokens";
import { tagDisplayName } from "@/lib/tags";

// ─── ProjectSettingsPanel ────────────────────────────────────────────────────
// Desktop: left slide-in panel (320px)
// Mobile:  bottom sheet (1/3 page height)
//
// Props:
//   project   – current project slug (e.g. "health")
//   token     – auth token
//   open      – boolean
//   onClose   – () => void
//   onRenamed – (newSlug: string) => void  (called after successful rename)

export function ProjectSettingsPanel({ project, token, open, onClose, onRenamed }) {
  const { C } = useTheme();
  const pcol = project && project !== '__everything__' ? projectColor(project) : C.accent;

  // ── Name editing ────────────────────────────────────────────────────────────
  const [nameInput, setNameInput] = useState('');
  const [renaming, setRenaming]   = useState(false);
  const [renameErr, setRenameErr] = useState('');
  const nameRef = useRef(null);

  // ── Search terms (LOOK FOR) ────────────────────────────────────────────────
  const [terms, setTerms]         = useState([]);
  const [termInput, setTermInput] = useState('');
  const [saving, setSaving]       = useState(false);
  const termInputRef = useRef(null);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setNameInput(tagDisplayName(project));
    setRenameErr('');
    loadTerms();
  }, [open, project]);

  async function loadTerms() {
    if (!token) return;
    try {
      const res = await fetch('/api/settings', { headers: { Authorization: `Bearer ${token}` } });
      const d   = await res.json();
      const ps  = d?.data?.projectSettings ?? {};
      setTerms(ps[project]?.searchTerms ?? []);
    } catch { setTerms([]); }
  }

  async function saveTerms(next) {
    setSaving(true);
    try {
      // Read current settings, patch projectSettings for this project
      const res = await fetch('/api/settings', { headers: { Authorization: `Bearer ${token}` } });
      const d   = await res.json();
      const ps  = d?.data?.projectSettings ?? {};
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectSettings: { ...ps, [project]: { ...(ps[project] ?? {}), searchTerms: next } },
        }),
      });
      setTerms(next);
    } finally { setSaving(false); }
  }

  function addTerm(raw) {
    const t = raw.trim().toLowerCase();
    if (!t || terms.includes(t)) { setTermInput(''); return; }
    const next = [...terms, t];
    setTermInput('');
    saveTerms(next);
  }

  function removeTerm(t) {
    saveTerms(terms.filter(x => x !== t));
  }

  async function handleRename() {
    const newSlug = nameInput.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!newSlug || newSlug === project) { setRenameErr(''); return; }
    if (!/^[a-z0-9][a-z0-9 ]{0,38}[a-z0-9]$|^[a-z0-9]$/.test(newSlug)) {
      setRenameErr('Use lowercase letters, numbers and spaces only.'); return;
    }
    setRenaming(true); setRenameErr('');
    try {
      const res = await fetch('/api/projects/rename', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldName: project, newName: newSlug }),
      });
      const d = await res.json();
      if (d.ok) onRenamed(newSlug);
      else setRenameErr(d.error || 'Rename failed.');
    } catch { setRenameErr('Network error.'); }
    finally { setRenaming(false); }
  }

  // ── Trap focus + ESC ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // ── Styles ──────────────────────────────────────────────────────────────────
  const isMobileQuery = typeof window !== 'undefined' && window.innerWidth < 640;
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const overlayStyle = {
    position: 'fixed', inset: 0, zIndex: 200,
    background: 'rgba(0,0,0,0.45)',
    opacity: open ? 1 : 0,
    pointerEvents: open ? 'auto' : 'none',
    transition: 'opacity 0.2s',
  };

  const panelStyle = isMobile ? {
    position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 201,
    height: 'calc(max(33vh, 260px))',
    background: C.bg,
    borderTop: `1px solid ${C.border}`,
    borderRadius: '14px 14px 0 0',
    display: 'flex', flexDirection: 'column',
    transform: open ? 'translateY(0)' : 'translateY(110%)',
    transition: 'transform 0.25s cubic-bezier(0.32,0.72,0,1)',
    overflow: 'hidden',
  } : {
    position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 201,
    width: 300,
    background: C.bg,
    borderRight: `1px solid ${C.border}`,
    display: 'flex', flexDirection: 'column',
    transform: open ? 'translateX(0)' : 'translateX(-100%)',
    transition: 'transform 0.22s cubic-bezier(0.32,0.72,0,1)',
    overflow: 'hidden',
  };

  const sectionLabel = {
    fontFamily: mono, fontSize: 9, letterSpacing: '0.1em',
    textTransform: 'uppercase', color: C.muted, marginBottom: 10,
  };

  const input = {
    fontFamily: serif, fontSize: F.md,
    background: C.well, border: `1px solid ${C.border}`,
    borderRadius: 6, padding: '7px 10px',
    color: C.text, outline: 'none', width: '100%', boxSizing: 'border-box',
  };

  return (
    <>
      {/* Backdrop */}
      <div style={overlayStyle} onClick={onClose} />

      {/* Panel */}
      <div style={panelStyle}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px 12px',
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}>
          <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: pcol }}>
            Project Settings
          </span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: C.muted, fontSize: 16, lineHeight: 1, padding: '2px 4px',
          }}>×</button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>

          {/* ── Project name ──────────────────────────────────────────────── */}
          <div style={{ marginBottom: 24 }}>
            <div style={sectionLabel}>Project Name</div>
            <input
              ref={nameRef}
              value={nameInput}
              onChange={e => { setNameInput(e.target.value); setRenameErr(''); }}
              onBlur={handleRename}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); nameRef.current?.blur(); } }}
              disabled={renaming || project === '__everything__'}
              style={{ ...input, borderColor: renameErr ? '#e05' : C.border }}
              placeholder="project name"
            />
            {renaming && (
              <div style={{ fontFamily: mono, fontSize: 9, color: C.muted, marginTop: 6 }}>Renaming…</div>
            )}
            {renameErr && (
              <div style={{ fontFamily: mono, fontSize: 9, color: '#e05', marginTop: 6 }}>{renameErr}</div>
            )}
            {!renaming && !renameErr && (
              <div style={{ fontFamily: mono, fontSize: 9, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
                Renames across all notes, tasks, meals & workouts.
              </div>
            )}
          </div>

          {/* ── LOOK FOR ─────────────────────────────────────────────────── */}
          {project !== '__everything__' && (
            <div>
              <div style={sectionLabel}>Look For</div>
              <div style={{
                fontFamily: mono, fontSize: 9, color: C.muted,
                lineHeight: 1.6, marginBottom: 12,
              }}>
                Pull in entries that mention these terms — even if they aren&apos;t tagged to this project.
              </div>

              {/* Term chips */}
              {terms.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {terms.map(t => (
                    <span key={t} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      background: pcol + '22', border: `1px solid ${pcol}55`,
                      borderRadius: 20, padding: '3px 10px 3px 10px',
                      fontFamily: mono, fontSize: 9, color: pcol,
                      letterSpacing: '0.05em',
                    }}>
                      {t}
                      <button
                        onClick={() => removeTerm(t)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: pcol, fontSize: 11, lineHeight: 1, padding: 0,
                          marginLeft: 2, opacity: 0.7,
                        }}
                        onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                        onMouseLeave={e => e.currentTarget.style.opacity = '0.7'}
                      >×</button>
                    </span>
                  ))}
                </div>
              )}

              {/* Add term input */}
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  ref={termInputRef}
                  value={termInput}
                  onChange={e => setTermInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault(); addTerm(termInput);
                    }
                  }}
                  disabled={saving}
                  style={{ ...input, flex: 1 }}
                  placeholder="add a term…"
                />
                <button
                  onClick={() => addTerm(termInput)}
                  disabled={!termInput.trim() || saving}
                  style={{
                    background: pcol + '22', border: `1px solid ${pcol}44`,
                    borderRadius: 6, padding: '7px 12px',
                    fontFamily: mono, fontSize: 9, letterSpacing: '0.06em',
                    color: pcol, cursor: 'pointer',
                    opacity: termInput.trim() ? 1 : 0.4,
                  }}
                >Add</button>
              </div>

              {saving && (
                <div style={{ fontFamily: mono, fontSize: 9, color: C.muted, marginTop: 8 }}>Saving…</div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
