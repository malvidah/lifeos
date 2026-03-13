"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "@/lib/theme";
import { serif, mono, F, R, projectColor } from "@/lib/tokens";
import { tagDisplayName } from "@/lib/tags";
import { useNavigation } from "@/lib/contexts";
import ProjectsCard from "../cards/ProjectsCard.jsx";

export default function NavBar(props) {
  const { C } = useTheme();
  const { activeProject, searchOpen, setSearchOpen, searchQuery, setSearchQuery, searchInputRef, srLoading, date, token, userId, onSelectProject, onBack } = props;

  const openSearch = () => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 60); };

  // Shared search button — identical style/size on every page
  const SearchBtn = ({ onClick }) => (
    <button onClick={onClick}
      style={{background:'none',border:'none',cursor:'pointer',
        display:'flex',alignItems:'center',justifyContent:'center',
        color:C.muted, flexShrink:0,
        width:44, height:48,
        transition:'color 0.15s'}}
      onMouseEnter={e=>e.currentTarget.style.color=C.text}
      onMouseLeave={e=>e.currentTarget.style.color=C.muted}
      aria-label="Search">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    </button>
  );

  // Shared outer shell — both modes render this exact wrapper so layout is identical
  const Shell = ({ children }) => (
    <div style={{
      display:'flex', alignItems:'center', flexShrink:0,
      height:48, overflow:'visible',
      position:'relative', // needed for home view's absolute-positioned crossfade children
    }}>
      {children}
    </div>
  );

  // ── Project / graph view ──
  if (activeProject) {
    const isGraph  = activeProject === '__graph__';
    const pcol = isGraph ? "var(--dl-accent)" : projectColor(activeProject);
    const label = isGraph ? 'ALL PROJECTS'
                : activeProject === '__everything__' ? 'ALL'
                : tagDisplayName(activeProject);
    return (
      <Shell>
        {/* Back button — same left-edge as the all-projects icon on home */}
        <button onClick={onBack}
          style={{background:'none',border:'none',cursor:'pointer',
            display:'flex',alignItems:'center',justifyContent:'center',
            color:pcol+'99', flexShrink:0,
            width:36, height:48}}
          aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.08em',
          textTransform:'uppercase',color:pcol, flex:1, minWidth:0,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
          {label}
        </span>
        <SearchBtn onClick={() => { onBack(); openSearch(); }} />
      </Shell>
    );
  }

  // ── Home view: strip + search crossfade ──
  return (
    <Shell>
      {/* Projects bar — fades out when search open */}
      <div style={{position:'absolute',top:0,left:0,right:0,bottom:0,
        opacity:searchOpen?0:1,pointerEvents:searchOpen?'none':'auto',
        transition:'opacity 0.18s ease',display:'flex',alignItems:'center'}}>
        <div style={{flex:1,minWidth:0}}>
          <ProjectsCard date={date} token={token} userId={userId} onSelectProject={onSelectProject}/>
        </div>
        <SearchBtn onClick={openSearch} />
      </div>
      {/* Search pill — fades in when search open */}
      <div style={{position:'absolute',top:0,left:0,right:0,bottom:0,
        opacity:searchOpen?1:0,pointerEvents:searchOpen?'auto':'none',
        transition:'opacity 0.18s ease',display:'flex',alignItems:'center',
        justifyContent:'center',padding:'0 10px'}}>
        <div style={{width:'100%',maxWidth:560,display:'flex',alignItems:'center',gap:8,
          backdropFilter:'blur(20px) saturate(1.4)',WebkitBackdropFilter:'blur(20px) saturate(1.4)',
          background:`${C.surface}ee`,border:`1px solid ${C.border}`,borderRadius:100,
          padding:'0 18px',height:52,boxShadow:C.shadow}}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2.5" strokeLinecap="round" style={{flexShrink:0}}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input ref={searchInputRef} value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}
            onKeyDown={e=>{if(e.key==='Escape'){setSearchOpen(false);setSearchQuery('');}}}
            placeholder="Search"
            style={{flex:1,background:'transparent',border:'none',outline:'none',
              fontFamily:serif,fontSize:F.md,color:C.text,caretColor:C.accent}}/>
          {srLoading && <span style={{fontFamily:mono,fontSize:8,color:C.muted,letterSpacing:'0.12em',flexShrink:0}}>…</span>}
          <button onClick={()=>{setSearchOpen(false);setSearchQuery('');}}
            style={{background:'none',border:'none',cursor:'pointer',padding:'0 2px',
              color:C.muted,display:'flex',alignItems:'center',flexShrink:0,transition:'color 0.12s'}}
            onMouseEnter={e=>e.currentTarget.style.color=C.text}
            onMouseLeave={e=>e.currentTarget.style.color=C.muted}
            aria-label="Close search">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
    </Shell>
  );
}

// ─── AddJournalLine — single-line Editor that calls onAdd(text) on Enter or blur.
// Editor self-clears after commit; callers do not need to maintain text state.
