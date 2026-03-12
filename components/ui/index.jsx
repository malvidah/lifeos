"use client";
import { useState, useRef, Fragment, useContext, createContext } from "react";
import { useTheme } from "../theme/ThemeContext.jsx";
import { mono, F, R } from "../theme/tokens.js";
import { CHIP_TOKENS, projectColor as _projectColor } from "../DayLabEditor.jsx";
export const projectColor = _projectColor;
export const NavigationContext = createContext({ navigateToProject: () => {}, navigateToNote: () => {} });
export function TagChip({ name, onClick, plain = false }) {
  const { C } = useTheme();
  return (
    <span onClick={onClick} style={{
      ...CHIP_TOKENS.project(projectColor(name)),
      cursor: onClick ? 'pointer' : 'default',
      opacity: plain ? 0.4 : 1,
    }}>{name.toUpperCase()}</span>
  );
}

export function NoteChip({ name, onClick }) {
  const { C } = useTheme();
  return (
    <span onClick={onClick} style={{
      ...CHIP_TOKENS.note,
      cursor: onClick ? 'pointer' : 'default',
    }}>{name}</span>
  );
}
// RichLine — read-only counterpart to DayLabEditor.
// Renders stored plain-text with {project} chips, [note] chips, URLs, and [img:] blocks.
// Single flat pass — no indirection through renderRichLine/renderTextWithLinksAndTags.
export function RichLine({ text, dimTag = null }) {
  const { C } = useTheme();
  const { navigateToProject, navigateToNote } = useContext(NavigationContext);
  if (!text) return null;

  const parts = [];
  let last = 0, k = 0;
  // Single combined regex: [img:] | URL | {project} | #Legacy | [note]
  const re = /\[img:(https?:\/\/[^\]]+|data:[^\]]+)\]|(https?:\/\/[^\s<>"')[\]]+)|\{([a-z0-9][a-z0-9 ]*[a-z0-9]|[a-z0-9])\}|(#[A-Za-z][A-Za-z0-9]+(?![A-Za-z0-9]))|\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<Fragment key={k++}>{text.slice(last, m.index)}</Fragment>);
    if (m[1]) {
      parts.push(
        <div key={k++} style={{ margin: '6px 0', lineHeight: 0 }}>
          <img src={m[1]} alt="" style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 8, display: 'block' }} />
        </div>
      );
    } else if (m[2]) {
      const url = m[2];
      parts.push(
        <a key={k++} href={url} target="_blank" rel="noreferrer"
          style={{ color: '#C8820A', textDecoration: 'none', transition: 'color 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.color = '#F5A623'}
          onMouseLeave={e => e.currentTarget.style.color = '#C8820A'}
        >{url}</a>
      );
    } else if (m[3] !== undefined) {
      const name = m[3];
      const isOwn = dimTag && name === dimTag.toLowerCase();
      parts.push(<TagChip key={k++} name={name} plain={isOwn} onClick={() => navigateToProject(name)}/>);
    } else if (m[4]) {
      const name = m[4].slice(1).toLowerCase();
      const isOwn = dimTag && name === dimTag.toLowerCase();
      parts.push(<TagChip key={k++} name={name} plain={isOwn} onClick={() => navigateToProject(name)}/>);
    } else if (m[5]) {
      parts.push(<NoteChip key={k++} name={m[5]} onClick={() => navigateToNote(m[5])}/>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<Fragment key={k++}>{text.slice(last)}</Fragment>);
  return <>{parts.length ? parts : text}</>;
}
export function ChevronBtn({collapsed, onToggle, style={}}) {
  const { C } = useTheme();
  return (
    <button onClick={onToggle} style={{
      background:"none",border:"none",cursor:"pointer",padding:"2px 4px",
      color:C.dim,display:"flex",alignItems:"center",justifyContent:"center",
      flexShrink:0,transition:"color 0.15s",...style,
    }}
      onMouseEnter={e=>e.currentTarget.style.color=C.muted}
      onMouseLeave={e=>e.currentTarget.style.color=C.dim}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        {collapsed
          ? <polyline points="6 9 12 15 18 9"/>
          : <polyline points="18 15 12 9 6 15"/>}
      </svg>
    </button>
  );
}

// ─── Ring ─────────────────────────────────────────────────────────────────────
export function Ring({score,color,size=48}) {
  const { C } = useTheme();
  const r=(size-7)/2, circ=2*Math.PI*r;
  const val=parseFloat(score)||0;
  const pct=Math.min(val/100,1);
  // Bubble grows from r×0.5 at score 0 → r×1 at score 85, then stays full
  const bubbleR = score ? r * Math.min(0.5 + 0.5*(val/85), 1.0) : 0;
  return (
    <svg width={size} height={size} style={{flexShrink:0}}>
      {/* Pastel fill bubble — scales with score */}
      <circle cx={size/2} cy={size/2} r={bubbleR}
        fill={color+"28"}
        style={{transition:"r 0.5s cubic-bezier(.4,0,.2,1)"}}/>
      {/* Track ring */}
      <circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color+"30"} strokeWidth={2.5}
        style={{transform:"rotate(-90deg)",transformOrigin:"50% 50%"}}/>
      {/* Progress arc */}
      <circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color} strokeWidth={2.5} strokeLinecap="round"
        strokeDasharray={`${pct*circ} ${circ}`}
        style={{transform:"rotate(-90deg)",transformOrigin:"50% 50%",
          transition:"stroke-dasharray 0.5s cubic-bezier(.4,0,.2,1)"}}/>
      {/* Score label — color-tinted, not plain text */}
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
        style={{fill:score?color:C.dim,fontSize:F.sm,fontFamily:mono,
          letterSpacing:"-0.02em"}}>
        {score||"—"}
      </text>
    </svg>
  );
}
export function Card({children,style={},fitContent=false}) {
  const { C } = useTheme();
  return (
    <div style={{
      background:C.card,borderRadius:R,border:`1px solid ${C.border}`,
      overflow:"clip",height:fitContent?"auto":"100%",
      display:"flex",flexDirection:"column",
      ...style,
    }}>{children}</div>
  );
}



// ─── Card (Widget) ───────────────────────────────────────────────────────────
export function Widget({label,color,children,slim,collapsed,onToggle,headerRight,headerLeft,autoHeight}) {
  const { C } = useTheme();
  const useAutoHeight = autoHeight || (!onToggle && !collapsed);
  return (
    <div style={slim ? {} : {flex:useAutoHeight?"0 0 auto":1,display:"flex",flexDirection:"column"}}>
      <Card style={(collapsed || useAutoHeight) ? {height:"auto"} : {flex:1}}>
        <div style={{
          display:"flex",alignItems:"center",gap:8,padding:"11px 14px",
          borderBottom:collapsed?"none":`1px solid ${C.border}`,flexShrink:0,
          cursor:onToggle?"pointer":"default",
        }} onClick={onToggle}>
          {headerLeft}
          {onToggle&&<ChevronBtn collapsed={collapsed} onToggle={e=>{e.stopPropagation();onToggle();}}/>}
          <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",
            textTransform:"uppercase",color:C.muted,flex:1}}>{label}</span>
          {!collapsed && headerRight}
        </div>
        {!collapsed&&(
          <div style={slim ? {padding:"14px 16px"} : {flex:1,overflow:"auto",padding:16,minHeight:0}}>{children}</div>
        )}
      </Card>
    </div>
  );
}
export function InfoTip({text}) {
  const { C } = useTheme();
  const [show,setShow]=useState(false);
  const [above,setAbove]=useState(false);
  const btnRef=useRef(null);
  function handleShow(){
    if(btnRef.current){
      const rect=btnRef.current.getBoundingClientRect();
      setAbove(rect.top>160);
    }
    setShow(true);
  }
  return (
    <span style={{position:"relative",display:"inline-flex",alignItems:"center"}}>
      <button
        ref={btnRef}
        onMouseEnter={handleShow} onMouseLeave={()=>setShow(false)}
        onFocus={handleShow} onBlur={()=>setShow(false)}
        style={{
          width:14,height:14,borderRadius:"50%",border:`1px solid ${C.border2}`,
          background:"none",cursor:"pointer",padding:0,
          display:"flex",alignItems:"center",justifyContent:"center",
          color:C.dim,fontFamily:mono,fontSize:F.sm,lineHeight:1,flexShrink:0,
        }}
        aria-label="More info"
      >i</button>
      {show&&(
        <div style={{
          position:"absolute",
          ...(above
            ? {bottom:"calc(100% + 6px)"}
            : {top:"calc(100% + 6px)"}),
          right:"-4px",
          background:C.card,border:`1px solid ${C.border2}`,borderRadius:6,
          padding:"8px 10px",width:190,
          fontFamily:mono,fontSize:F.sm,color:C.muted,lineHeight:1.5,
          zIndex:500,boxShadow:C.shadow,pointerEvents:"none",
          whiteSpace:"normal",
        }}>
          {text}
        </div>
      )}
    </span>
  );
}

export function IntegrationToggle({on, onOn, onOff, pending}) {
  const { C } = useTheme();
  const bg = on
    ? `rgba(196,168,130,0.15)`
    : pending
      ? `rgba(208,136,40,0.18)`
      : `rgba(155,107,58,0.08)`;
  const dot = on ? C.accent : pending ? C.accent : C.dim;
  const borderColor = pending ? `${C.accent}70` : C.border2;
  return (
    <button
      onClick={on ? onOff : onOn}
      style={{
        background: bg,
        border: `1px solid ${borderColor}`, borderRadius: 20, cursor: "pointer",
        padding: 3, display: "flex", alignItems: "center", width: 40, height: 22,
        justifyContent: on ? "flex-end" : "flex-start", flexShrink: 0,
        transition: "all 0.2s",
      }}>
      <div style={{width:14,height:14,borderRadius:"50%",background:dot,transition:"all 0.2s"}}/>
    </button>
  );
}

export function IntegrationRow({label, subtitle, connected, onToggleOn, onToggleOff, children, pendingToggle}) {
  const { C } = useTheme();
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:8,paddingTop:1}}>
        <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",color:C.muted,flexShrink:0}}>
          {label}
        </span>
        {children}
        <div style={{marginLeft:"auto",flexShrink:0}}>
          <IntegrationToggle on={connected} onOn={onToggleOn} onOff={onToggleOff} pending={pendingToggle}/>
        </div>
      </div>
      {subtitle && (
        <div style={{fontFamily:mono,fontSize:9,color:C.dim,letterSpacing:"0.03em",marginTop:3}}>
          — {subtitle}
        </div>
      )}
    </div>
  );
}
export function Shimmer({width="100%", height=14, style={}}) {
  const { C } = useTheme();
  return (
    <div style={{
      width, height, borderRadius:4,
      background:`linear-gradient(90deg, ${C.border} 25%, ${C.border2} 50%, ${C.border} 75%)`,
      backgroundSize:"200% 100%",
      animation:"shimmer 1.4s infinite",
      ...style,
    }}/>
  );
}

// ─── Health card ────────────────────────────────────────────────────────────
export function NavBtn({onClick,title,children}) {
  return (
    <button onClick={onClick} title={title} style={{
      background:'none',border:'none',cursor:'pointer',
      color:C.muted,fontFamily:mono,fontSize:F.md,lineHeight:1,
      padding:'3px 5px',borderRadius:4,transition:'color 0.1s',
    }}
    onMouseEnter={e=>e.currentTarget.style.color=C.text}
    onMouseLeave={e=>e.currentTarget.style.color=C.muted}>
      {children}
    </button>
  );
}
export function TaskCheckbox({ done, onToggle }) {
  return (
    <button
      onClick={onToggle}
      style={{
        width: 15, height: 15, flexShrink: 0, borderRadius: 4, padding: 0,
        cursor: 'pointer', marginTop: 4,
        border: `1.5px solid ${done ? C.blue : C.border2}`,
        background: done ? C.blue : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s',
      }}
    >
      {done && (
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke={C.bg} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1.5,5 4,7.5 8.5,2"/>
        </svg>
      )}
    </button>
  );
}

export function TaskFilterBtns({ filter, setFilter }) {
  const { C } = useTheme();
  const OpenIcon = () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="2.5"/>
    </svg>
  );
  const DoneIcon = () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="2.5"/>
      <polyline points="5,8.5 7,10.5 11,6"/>
    </svg>
  );
  const btns = [
    { key: 'open', label: null,  icon: <OpenIcon/> },
    { key: 'done', label: null,  icon: <DoneIcon/> },
    { key: 'all',  label: 'ALL', icon: null },
  ];
  return (
    <div style={{ display:'flex', gap:4 }}>
      {btns.map(b => {
        const active = filter === b.key;
        return (
          <button key={b.key} onClick={e => { e.stopPropagation(); setFilter(b.key); }}
            style={{
              fontFamily: mono, fontSize: '10px', letterSpacing: '0.06em',
              padding: b.label ? '3px 8px' : '3px 6px',
              borderRadius: 4, cursor: 'pointer',
              minHeight: 22,
              background: active ? C.accent+'22' : 'none',
              border: `1px solid ${active ? C.accent : C.border2}`,
              color: active ? C.accent : C.muted,
              display: 'flex', alignItems: 'center', gap: 3,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!active) { e.currentTarget.style.borderColor=C.accent+'66'; e.currentTarget.style.color=C.text; }}}
            onMouseLeave={e => { if (!active) { e.currentTarget.style.borderColor=C.border2; e.currentTarget.style.color=C.muted; }}}
          >
            {b.label || b.icon}
          </button>
        );
      })}
    </div>
  );
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
// Stores as HTML string (like journal). Old format [{id,text,done}] auto-migrates.
// Old [{id,text,done}] JSON is converted to HTML on read; the HTML stores checked state.
export function DayLabLoader({ size = 32, color = "#EFDFC3" }) {
  const { C } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 1500 1500" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}>
      <style>{`
        @keyframes dlPulse {
          0%, 100% { opacity: 0.15; transform: scale(0.92); }
          50% { opacity: 1; transform: scale(1); }
        }
        @keyframes dlDot {
          0%, 100% { opacity: 0.2; transform: scale(0.7); }
          50% { opacity: 1; transform: scale(1.1); }
        }
        .dl-cross { animation: dlPulse 1.6s ease-in-out infinite; transform-origin: 751px 767px; }
        .dl-dot   { animation: dlDot   1.6s ease-in-out infinite 0.3s; transform-origin: 1048px 474px; }
      `}</style>
      <path className="dl-cross"
        d="M841 518C841 551 842.5 578 845.5 599C849.5 619 856.5 635 866.5 647C877.5 659 892.5 667 911.5 671C930.5 675 955 677 985 677C1015 677 1039 679.5 1057 684.5C1076 689.5 1090.5 696 1100.5 704C1110.5 712 1117 721.5 1120 732.5C1124 742.5 1126 753 1126 764C1126 775 1124.5 786.5 1121.5 798.5C1119.5 809.5 1114 819.5 1105 828.5C1096 837.5 1082.5 845 1064.5 851C1046.5 857 1022 860 991 860C961 860 936 862 916 866C897 870 882 877.5 871 888.5C860 898.5 852 913 847 932C843 950 841 973 841 1001C841 1035 838.5 1061.5 833.5 1080.5C828.5 1099.5 821.5 1113.5 812.5 1122.5C804.5 1131.5 795 1137 784 1139C773 1141 762 1142 751 1142C721 1142 698.5 1133.5 683.5 1116.5C668.5 1098.5 661 1061 661 1004C661 951 651.5 914 632.5 893C614.5 871 580 860 529 860C481 860 443 854.5 415 843.5C387 831.5 373 806 373 767C373 737 383.5 714.5 404.5 699.5C426.5 684.5 466 677 523 677C551 677 574 675 592 671C610 666 624 658 634 647C645 635 652 619 655 599C659 579 661 553 661 521C661 493 663.5 470.5 668.5 453.5C673.5 436.5 680 423.5 688 414.5C696 405.5 705.5 399.5 716.5 396.5C727.5 393.5 739 392 751 392C784 392 807 403.5 820 426.5C834 448.5 841 479 841 518Z"
        fill={color}
      />
      <path className="dl-dot"
        d="M1138 476C1138 488.667 1135.33 500.667 1130 512C1125.33 522.667 1118.67 532.333 1110 541C1102 549 1092.33 555.667 1081 561C1070.33 565.667 1059.33 568 1048 568C1036.67 568 1025.33 565.667 1014 561C1003.33 555.667 993.667 549 985 541C976.333 532.333 969.333 522.667 964 512C958.667 500.667 956 488.667 956 476C956 463.333 958.333 451.333 963 440C968.333 428.667 975 418.667 983 410C991.667 401.333 1001.33 394.667 1012 390C1023.33 384.667 1035.33 382 1048 382C1060.67 382 1072.33 384.667 1083 390C1094.33 394.667 1104 401.333 1112 410C1120 418.667 1126.33 428.667 1131 440C1135.67 451.333 1138 463.333 1138 476ZM1013 474C1013 484 1016.33 492.333 1023 499C1029.67 505.667 1038 509 1048 509C1058 509 1066.33 505.667 1073 499C1079.67 492.333 1083 484 1083 474C1083 464 1079.67 455.667 1073 449C1066.33 442.333 1058 439 1048 439C1038 439 1029.67 442.333 1023 449C1016.33 455.667 1013 464 1013 474Z"
        fill={color}
      />
    </svg>
  );
}
