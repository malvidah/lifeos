"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { serif, mono, F, projectColor } from "@/lib/tokens";
import { tagDisplayName } from "@/lib/tags";

// ─── HomeSettingsPanel ───────────────────────────────────────────────────────
// Same slide-in chrome as ProjectSettingsPanel, blank body for now.
export function HomeSettingsPanel({ open, onClose }) {

  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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
    background: "var(--dl-bg)", borderTop: `1px solid var(--dl-border)`,
    borderRadius: '14px 14px 0 0',
    display: 'flex', flexDirection: 'column',
    transform: open ? 'translateY(0)' : 'translateY(110%)',
    transition: 'transform 0.25s cubic-bezier(0.32,0.72,0,1)',
    overflow: 'hidden',
  } : {
    position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 201,
    width: 300, background: "var(--dl-bg)", borderRight: `1px solid var(--dl-border)`,
    display: 'flex', flexDirection: 'column',
    transform: open ? 'translateX(0)' : 'translateX(-100%)',
    transition: 'transform 0.22s cubic-bezier(0.32,0.72,0,1)',
    overflow: 'hidden',
  };

  return (
    <>
      <div style={overlayStyle} onClick={onClose} />
      <div style={panelStyle}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px 12px', borderBottom: `1px solid var(--dl-border)`, flexShrink: 0,
        }}>
          <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: "var(--dl-highlight)" }}>
            Dashboard
          </span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: "var(--dl-highlight)", fontSize: 16, lineHeight: 1, padding: '2px 4px',
          }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }} />
      </div>
    </>
  );
}

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

export function ProjectSettingsPanel({ project, token, open, onClose, onRenamed, projectData }) {
  const pcol = project && project !== '__everything__' ? projectColor(project) : "var(--dl-accent)";

  // ── Name editing ────────────────────────────────────────────────────────────
  const [nameInput, setNameInput] = useState('');
  const [renaming, setRenaming]   = useState(false);
  const [renameErr, setRenameErr] = useState('');
  const nameRef = useRef(null);

  // ── Sharing ────────────────────────────────────────────────────────────────
  const [isPublic, setIsPublic]     = useState(false);
  const [shareToken, setShareToken] = useState(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [copied, setCopied]         = useState(false);

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
    setIsPublic(!!projectData?.is_public);
    setShareToken(projectData?.share_token ?? null);
    setCopied(false);
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

  async function toggleShare() {
    const next = !isPublic;
    setShareLoading(true);
    setCopied(false);
    try {
      const res = await fetch('/api/projects', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: project, is_public: next }),
      });
      const d = await res.json();
      if (d?.project) {
        setIsPublic(!!d.project.is_public);
        setShareToken(d.project.share_token);
      }
    } finally { setShareLoading(false); }
  }

  function copyShareLink() {
    if (!shareToken) return;
    const url = `${window.location.origin}/share/${shareToken}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
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
      if (d.ok) {
        // Clear cached journal/task data so day view re-fetches with new tag names
        window.dispatchEvent(new CustomEvent('daylab:refresh', { detail: { types: ['journal', 'tasks'] } }));
        onRenamed(newSlug);
      } else setRenameErr(d.error || 'Rename failed.');
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
    background: "var(--dl-bg)",
    borderTop: `1px solid var(--dl-border)`,
    borderRadius: '14px 14px 0 0',
    display: 'flex', flexDirection: 'column',
    transform: open ? 'translateY(0)' : 'translateY(110%)',
    transition: 'transform 0.25s cubic-bezier(0.32,0.72,0,1)',
    overflow: 'hidden',
  } : {
    position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 201,
    width: 300,
    background: "var(--dl-bg)",
    borderRight: `1px solid var(--dl-border)`,
    display: 'flex', flexDirection: 'column',
    transform: open ? 'translateX(0)' : 'translateX(-100%)',
    transition: 'transform 0.22s cubic-bezier(0.32,0.72,0,1)',
    overflow: 'hidden',
  };

  const sectionLabel = {
    fontFamily: mono, fontSize: 9, letterSpacing: '0.1em',
    textTransform: 'uppercase', color: "var(--dl-highlight)", marginBottom: 10,
  };

  const input = {
    fontFamily: serif, fontSize: F.md,
    background: "var(--dl-well)", border: `1px solid var(--dl-border)`,
    borderRadius: 6, padding: '7px 10px',
    color: "var(--dl-strong)", outline: 'none', width: '100%', boxSizing: 'border-box',
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
          borderBottom: `1px solid var(--dl-border)`,
          flexShrink: 0,
        }}>
          <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: pcol }}>
            {tagDisplayName(project)}
          </span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: "var(--dl-highlight)", fontSize: 16, lineHeight: 1, padding: '2px 4px',
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
              style={{ ...input, borderColor: renameErr ? "var(--dl-red)" : "var(--dl-border)" }}
              placeholder="project name"
            />
            {renaming && (
              <div style={{ fontFamily: mono, fontSize: 9, color: "var(--dl-highlight)", marginTop: 6 }}>Renaming…</div>
            )}
            {renameErr && (
              <div style={{ fontFamily: mono, fontSize: 9, color: "var(--dl-red)", marginTop: 6 }}>{renameErr}</div>
            )}
          </div>

          {/* ── LOOK FOR ─────────────────────────────────────────────────── */}
          {project !== '__everything__' && (
            <div>
              <div style={sectionLabel}>Look For</div>
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
                <div style={{ fontFamily: mono, fontSize: 9, color: "var(--dl-highlight)", marginTop: 8 }}>Saving…</div>
              )}
            </div>
          )}

          {/* ── SHARE ──────────────────────────────────────────────────── */}
          {project !== '__everything__' && (
            <div style={{ marginTop: 24 }}>
              <div style={sectionLabel}>Share</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <button
                  onClick={toggleShare}
                  disabled={shareLoading}
                  style={{
                    width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
                    background: isPublic ? pcol : 'var(--dl-border)',
                    position: 'relative', transition: 'background 0.2s',
                    flexShrink: 0, padding: 0,
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 2, left: isPublic ? 20 : 2,
                    width: 18, height: 18, borderRadius: 9,
                    background: '#fff', transition: 'left 0.2s',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }} />
                </button>
                <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--dl-highlight)' }}>
                  {shareLoading ? 'Saving…' : isPublic ? 'Public' : 'Private'}
                </span>
              </div>
              {isPublic && shareToken && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    readOnly
                    value={`${typeof window !== 'undefined' ? window.location.origin : ''}/share/${shareToken}`}
                    style={{ ...input, flex: 1, fontSize: 11, color: 'var(--dl-highlight)' }}
                    onFocus={e => e.target.select()}
                  />
                  <button
                    onClick={copyShareLink}
                    style={{
                      background: pcol + '22', border: `1px solid ${pcol}44`,
                      borderRadius: 6, padding: '7px 12px',
                      fontFamily: mono, fontSize: 9, letterSpacing: '0.06em',
                      color: pcol, cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >{copied ? 'Copied!' : 'Copy'}</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
