"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { createPortal } from "react-dom";
import "@/components/theme/theme.css";
import { serif, mono, F } from "@/lib/tokens";
import { ThemeProvider } from "@/lib/theme";
import { createClient } from "@/lib/supabase";
import { uploadImageFile } from "@/lib/images";
import NoteCardItem, { firstMediaForNote } from "@/components/widgets/NoteCardItem.jsx";
import NotesGrid from "@/components/widgets/NotesGrid.jsx";
import { MiniTripMap } from "@/components/widgets/JournalEditor.jsx";
import { Card } from "@/components/ui/primitives.jsx";
import PublicWorldMapCard from "@/components/cards/places/PublicWorldMapCard.jsx";
import PublicNotesCard from "@/components/widgets/PublicNotesCard.jsx";

// Extract a display name from note content (mirrors NotesCard.noteName).
function noteName(note) {
  const c = note?.content || '';
  if (c.startsWith('<')) {
    const m = c.match(/<h1[^>]*>(.*?)<\/h1>/s);
    return m ? m[1].replace(/<[^>]+>/g, '').trim() || 'Untitled' : 'Untitled';
  }
  return c.split('\n')[0].trim() || 'Untitled';
}

// Public profile page. Unauthenticated visitors see a read-only view.
// If the viewing user IS the profile owner, fields become click-to-edit and
// the avatar/banner show upload affordances on hover.
// Wrap in ThemeProvider so MiniTripMap (and any other token-aware children)
// can call useTheme without crashing. Standalone pages don't inherit the
// dashboard's provider tree.
export default function ProfilePageWrapper() {
  return (
    <ThemeProvider>
      <ProfilePage />
    </ThemeProvider>
  );
}

function ProfilePage() {
  const params = useParams();
  const handle = params?.handle;

  const [state, setState] = useState({ loading: true, profile: null, notes: [], trips: [], collections: [], places: [], error: null });
  const [token, setToken] = useState(null);
  const [meHandle, setMeHandle] = useState(null);
  const [saving, setSaving] = useState(false);

  // Resolve auth session — used to detect ownership.
  useEffect(() => {
    const sb = createClient();
    sb.auth.getSession().then(({ data }) => {
      const t = data?.session?.access_token || null;
      setToken(t);
      if (t) {
        fetch('/api/profile/me', { headers: { Authorization: `Bearer ${t}` } })
          .then(r => r.json()).then(d => setMeHandle(d?.profile?.handle || null))
          .catch(() => {});
      }
    });
  }, []);

  // Load the public profile data.
  const loadProfile = useCallback(() => {
    if (!handle) return;
    fetch(`/api/public/profile/${encodeURIComponent(handle)}`)
      .then(async r => {
        if (r.status === 404) return setState(s => ({ ...s, loading: false, profile: null, error: 'not_found' }));
        if (!r.ok) return setState(s => ({ ...s, loading: false, profile: null, error: 'fetch_failed' }));
        const json = await r.json();
        setState({
          loading: false,
          profile: json.profile,
          notes: json.notes || [],
          trips: json.trips || [],
          collections: json.collections || [],
          places: json.places || [],
          error: null,
        });
      })
      .catch(() => setState(s => ({ ...s, loading: false, profile: null, error: 'fetch_failed' })));
  }, [handle]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  // Whenever ownership is detected, pull the FULL owner profile from
  // /api/profile/me. The public profile API strips fields like `profile_public`,
  // so without this the owner's toggle UI would always read as Private even
  // when the profile is public. Also handles the private-profile case (where
  // the public API 404s but the owner still needs to see their data to edit).
  const isOwner = !!(state.profile && meHandle && state.profile.handle && meHandle === state.profile.handle)
                || !!(meHandle && handle && meHandle === handle);

  useEffect(() => {
    if (!token || !meHandle || meHandle !== handle) return;
    fetch('/api/profile/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        const ownerProfile = d?.profile;
        if (!ownerProfile?.handle) return;
        setState(s => ({
          ...s,
          loading: false,
          // Merge owner-only fields (profile_public, etc.) over whatever the
          // public response provided. `error` cleared so the page renders.
          profile: { ...(s.profile || {}), ...ownerProfile },
          error: null,
        }));
      }).catch(() => {});
  }, [token, meHandle, handle]);

  const [saveError, setSaveError] = useState(null);

  // ── Save profile field (PATCH /api/profile/me). Returns true on success. ──
  const saveField = useCallback(async (patch) => {
    if (!token) return false;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch('/api/profile/me', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.profile) {
        setState(s => ({ ...s, profile: { ...(s.profile || {}), ...d.profile } }));
        return true;
      }
      setSaveError(d?.error || `Save failed (${r.status})`);
      return false;
    } catch (e) {
      setSaveError('Save failed');
      return false;
    } finally {
      setSaving(false);
    }
  }, [token]);

  // ── Render states ────────────────────────────────────────────────────────
  if (state.loading) return <CenteredMessage>Loading…</CenteredMessage>;
  if (state.error === 'not_found' && !isOwner) {
    return <CenteredMessage>This profile doesn't exist or isn't public.</CenteredMessage>;
  }
  if (state.error && state.error !== 'not_found') {
    return <CenteredMessage>Couldn't load this profile.</CenteredMessage>;
  }
  if (!state.profile) return <CenteredMessage>Loading…</CenteredMessage>;

  const p = state.profile;
  const displayName = p.display_name || p.handle;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dl-bg)', color: 'var(--dl-strong)' }}>
      {/* Header — avatar + name + bio. No banner. */}
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '32px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <AvatarEditable
            url={p.avatar_url}
            name={displayName}
            isOwner={isOwner}
            token={token}
            onSave={(url) => saveField({ avatar_url: url })}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <EditableText
              value={p.display_name || ''}
              placeholder={p.handle}
              isOwner={isOwner}
              onSave={(v) => saveField({ display_name: v })}
              style={{
                fontFamily: serif, fontSize: 24, fontWeight: 600,
                color: 'var(--dl-strong)', lineHeight: 1.2,
              }}
              displayFallback={displayName}
            />
            <div style={{
              fontFamily: mono, fontSize: 12, letterSpacing: '0.06em',
              color: 'var(--dl-middle)', marginTop: 4,
              display: 'flex', alignItems: 'baseline', gap: 0,
            }}>
              <span>@</span>
              <HandleEditor
                value={p.handle || ''}
                isOwner={isOwner}
                onSave={(v) => saveField({ handle: v }).then(saved => {
                  // If saved successfully and handle changed, navigate to the new URL.
                  if (saved && v && v !== p.handle) {
                    if (typeof window !== 'undefined') window.history.replaceState(null, '', `/u/${v}`);
                  }
                })}
              />
            </div>
          </div>
          {isOwner && (
            <PublicToggle
              isPublic={!!p.profile_public}
              onChange={(v) => saveField({ profile_public: v })}
            />
          )}
        </div>

        {/* Bio */}
        <div style={{ marginTop: 16 }}>
          <EditableText
            value={p.bio || ''}
            placeholder={isOwner ? 'Add a short bio…' : ''}
            isOwner={isOwner}
            multiline
            onSave={(v) => saveField({ bio: v })}
            style={{
              fontFamily: serif, fontSize: F.md, lineHeight: 1.6,
              color: 'var(--dl-strong)', whiteSpace: 'pre-wrap',
            }}
            displayFallback={p.bio || (isOwner ? 'Add a short bio…' : '')}
            mutedWhenEmpty
          />
        </div>

        {isOwner && !p.profile_public && (
          <div style={{
            marginTop: 16, padding: '10px 14px',
            background: 'var(--dl-accent-15)', border: '1px solid var(--dl-accent-30, var(--dl-border2))',
            borderRadius: 8, fontFamily: mono, fontSize: 11, letterSpacing: '0.04em',
            color: 'var(--dl-strong)',
          }}>
            Your profile is <b>private</b>. Toggle the eye in the top right to make it public so others can visit this URL.
          </div>
        )}

        {saving && (
          <div style={{
            position: 'fixed', bottom: 16, right: 16,
            fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)',
          }}>Saving…</div>
        )}
        {saveError && (
          <div style={{
            position: 'fixed', bottom: 16, right: 16,
            fontFamily: mono, fontSize: 10, color: '#fff',
            background: '#c0392b', padding: '6px 10px', borderRadius: 6,
          }}>{saveError}</div>
        )}
      </div>

      {/* Content — Day Lab cards (read-only) */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 80px' }}>
        <PublicContent
          notes={state.notes}
          trips={state.trips}
          collections={state.collections}
          places={state.places}
        />
      </div>
    </div>
  );
}

// ─── Public content (real Day Lab Card primitives, read-only) ────────────────
function PublicContent({ notes, trips, collections, places }) {
  const hasMap   = (places?.length || 0) > 0 || (trips?.length || 0) > 0;
  const hasNotes = (notes?.length || 0) > 0;

  if (!hasMap && !hasNotes) {
    return (
      <div style={{
        marginTop: 36, paddingBottom: 80,
        fontFamily: mono, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
        color: 'var(--dl-middle)', opacity: 0.6, textAlign: 'center',
      }}>
        No public content yet
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {hasMap && (
        <Card label="🗺️ Map" color="var(--dl-accent)" autoHeight slim>
          <PublicWorldMapCard
            places={places || []}
            collections={collections || []}
            trips={trips || []}
          />
        </Card>
      )}
      {hasNotes && (
        <PublicNotesCard notes={notes} trips={trips} places={places} />
      )}
    </div>
  );
}

// ─── Inline handle editor (lowercase only, click-to-edit for owner) ─────────
function HandleEditor({ value, isOwner, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);
  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  const commit = () => {
    setEditing(false);
    const v = draft.trim().toLowerCase();
    if (v && v !== value) onSave?.(v);
    else setDraft(value);
  };
  if (!isOwner) return <span>{value}</span>;
  if (editing) {
    return (
      <input
        ref={ref}
        value={draft}
        onChange={e => setDraft(e.target.value.toLowerCase())}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
        style={{
          background: 'var(--dl-surface)', border: '1px solid var(--dl-border2)',
          borderRadius: 4, padding: '1px 5px', outline: 'none',
          fontFamily: 'inherit', fontSize: 'inherit', color: 'inherit',
          letterSpacing: 'inherit',
        }}
      />
    );
  }
  return (
    <span
      onClick={() => setEditing(true)}
      title="Click to change handle"
      style={{ cursor: 'text', textDecoration: 'underline dotted', textDecorationColor: 'var(--dl-border)' }}
    >{value}</span>
  );
}

// ─── Editable text (click to edit when owner, plain span otherwise) ──────────
function EditableText({ value, placeholder, isOwner, multiline, onSave, style, displayFallback, mutedWhenEmpty }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave?.(draft);
  };

  if (!isOwner) {
    if (!value) return null;
    return <div style={style}>{value}</div>;
  }
  if (editing) {
    const Tag = multiline ? 'textarea' : 'input';
    return (
      <Tag
        ref={ref}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter' && !multiline) { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
        rows={multiline ? 3 : undefined}
        placeholder={placeholder}
        style={{
          ...style,
          background: 'var(--dl-surface)',
          border: '1px solid var(--dl-border2)',
          borderRadius: 6, padding: '4px 8px',
          outline: 'none', resize: multiline ? 'vertical' : 'none',
          width: '100%', boxSizing: 'border-box',
        }}
      />
    );
  }
  const isEmpty = !value;
  return (
    <div
      onClick={() => setEditing(true)}
      title="Click to edit"
      style={{
        ...style,
        cursor: 'text',
        opacity: isEmpty && mutedWhenEmpty ? 0.45 : 1,
        borderRadius: 6,
        padding: '2px 4px', margin: '-2px -4px',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--dl-surface)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {value || displayFallback || placeholder}
    </div>
  );
}

// ─── Avatar with click-to-upload for owner ───────────────────────────────────
function AvatarEditable({ url, name, isOwner, token, onSave }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [err, setErr] = useState(null);
  const initial = (name || '?').charAt(0).toUpperCase();
  const size = 112;

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    setUploading(true);
    setErr(null);
    try {
      const newUrl = await uploadImageFile(file, token);
      if (newUrl) onSave?.(newUrl);
      else setErr('Upload failed — try a JPG or PNG');
    } catch {
      setErr('Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div
      onClick={isOwner ? () => fileRef.current?.click() : undefined}
      onMouseEnter={() => isOwner && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: size, height: size, borderRadius: '50%',
        background: url ? `url("${url}") center/cover no-repeat` : 'var(--dl-accent-15)',
        border: '4px solid var(--dl-bg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: serif, fontSize: 42, fontWeight: 600,
        color: 'var(--dl-accent)', flexShrink: 0,
        boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
        cursor: isOwner ? 'pointer' : 'default',
        position: 'relative', overflow: 'hidden',
        transition: 'box-shadow 0.15s',
      }}
    >
      {!url && initial}
      {isOwner && (hovered || uploading) && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontFamily: mono, fontSize: 10, letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          {uploading ? '…' : (url ? 'Change' : '+ photo')}
        </div>
      )}
      {isOwner && (
        <input ref={fileRef} type="file" accept="image/*" onChange={onPick} style={{ display: 'none' }} />
      )}
      {err && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4,
          background: '#c0392b', color: '#fff', borderRadius: 4, padding: '2px 6px',
          fontFamily: mono, fontSize: 9, whiteSpace: 'nowrap', zIndex: 10,
        }}>{err}</div>
      )}
    </div>
  );
}

// ─── Banner with click-to-upload for owner ───────────────────────────────────
function BannerEditable({ url, isOwner, token, onSave }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [err, setErr] = useState(null);

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    setUploading(true);
    setErr(null);
    try {
      const newUrl = await uploadImageFile(file, token);
      if (newUrl) onSave?.(newUrl);
      else setErr('Upload failed — try a JPG or PNG');
    } catch {
      setErr('Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div
      onClick={isOwner ? () => fileRef.current?.click() : undefined}
      onMouseEnter={() => isOwner && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%', height: 240,
        background: url
          ? `url("${url}") center/cover no-repeat`
          : 'linear-gradient(135deg, var(--dl-accent-15), var(--dl-card))',
        cursor: isOwner ? 'pointer' : 'default',
        position: 'relative', overflow: 'hidden',
      }}
    >
      {isOwner && (hovered || uploading) && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontFamily: mono, fontSize: 11, letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          {uploading ? 'Uploading…' : (url ? 'Click to replace banner' : '+ banner image')}
        </div>
      )}
      {isOwner && (
        <input ref={fileRef} type="file" accept="image/*" onChange={onPick} style={{ display: 'none' }} />
      )}
      {err && (
        <div style={{
          position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
          background: '#c0392b', color: '#fff', borderRadius: 6, padding: '4px 10px',
          fontFamily: mono, fontSize: 10, letterSpacing: '0.04em',
        }}>{err}</div>
      )}
    </div>
  );
}

// ─── Public/private toggle (eye icon, owner only) ────────────────────────────
function PublicToggle({ isPublic, onChange }) {
  return (
    <button
      onClick={() => onChange(!isPublic)}
      title={isPublic ? 'Profile is public — click to make private' : 'Profile is private — click to make public'}
      style={{
        background: isPublic ? 'var(--dl-accent-15)' : 'transparent',
        border: `1px solid ${isPublic ? 'var(--dl-accent)' : 'var(--dl-border)'}`,
        borderRadius: 100, padding: '6px 10px',
        cursor: 'pointer',
        fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
        color: isPublic ? 'var(--dl-accent)' : 'var(--dl-middle)',
        display: 'flex', alignItems: 'center', gap: 6,
        transition: 'all 0.15s', flexShrink: 0,
      }}
    >
      {isPublic ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
      )}
      {isPublic ? 'Public' : 'Private'}
    </button>
  );
}

function CenteredMessage({ children }) {
  return (
    <div style={{
      minHeight: '100vh', background: 'var(--dl-bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: mono, fontSize: 12, color: 'var(--dl-middle)',
      letterSpacing: '0.06em', textTransform: 'uppercase', padding: 40, textAlign: 'center',
    }}>
      {children}
    </div>
  );
}
