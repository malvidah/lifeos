"use client";
import { Component, useState, useRef, Fragment } from "react";
import { mono, F, R, projectColor, CHIP_TOKENS } from "@/lib/tokens";
import { useNavigation } from "@/lib/contexts";

export function ChevronBtn({collapsed, onToggle, style={}}) {
  return (
    <button onClick={onToggle} style={{
      background:"none",border:"none",cursor:"pointer",padding:"2px 4px",
      color:"var(--dl-middle)",display:"flex",alignItems:"center",justifyContent:"center",
      flexShrink:0,transition:"color 0.15s",...style,
    }}
      onMouseEnter={e=>e.currentTarget.style.color="var(--dl-highlight)"}
      onMouseLeave={e=>e.currentTarget.style.color="var(--dl-middle)"}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        {collapsed ? <polyline points="6 9 12 15 18 9"/> : <polyline points="18 15 12 9 6 15"/>}
      </svg>
    </button>
  );
}

export function Ring({score,color,size=48}) {
  const r=(size-7)/2, circ=2*Math.PI*r;
  const val=parseFloat(score)||0;
  const pct=Math.min(val/100,1);
  const bubbleR = score ? r * Math.min(0.5 + 0.5*(val/85), 1.0) : 0;
  return (
    <svg width={size} height={size} style={{flexShrink:0}}>
      <circle cx={size/2} cy={size/2} r={bubbleR} fill={color} fillOpacity={0.16} style={{transition:"r 0.5s cubic-bezier(.4,0,.2,1)"}}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeOpacity={0.19} strokeWidth={2.5} style={{transform:"rotate(-90deg)",transformOrigin:"50% 50%"}}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round"
        strokeDasharray={`${pct*circ} ${circ}`}
        style={{transform:"rotate(-90deg)",transformOrigin:"50% 50%",transition:"stroke-dasharray 0.5s cubic-bezier(.4,0,.2,1)"}}/>
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
        style={{fill:score?color:"var(--dl-middle)",fontSize:F.sm,fontFamily:mono,letterSpacing:"-0.02em"}}>
        {score||"—"}
      </text>
    </svg>
  );
}

// CardHeader — standalone header row for cards that need flush content below
// (bare Card + CardHeader lets the body be edge-to-edge with no content padding).
export function CardHeader({ label, labelColor, collapsed, onToggle, headerLeft, headerRight }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,padding:"11px 14px",
      borderBottom:collapsed?"none":"1px solid var(--dl-border)",flexShrink:0,
      cursor:onToggle?"pointer":"default"}} onClick={onToggle}>
      {headerLeft}
      {onToggle&&<ChevronBtn collapsed={collapsed} onToggle={e=>{e.stopPropagation();onToggle();}}/>}
      <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",
        textTransform:"uppercase",color:labelColor||"var(--dl-highlight)",flex:1}}>{label}</span>
      {!collapsed && headerRight}
    </div>
  );
}

// Card — bare box when no label, full panel with header when label is provided
export function Card({
  children, style={}, fitContent=false,
  label, labelColor, slim, collapsed, onToggle, headerRight, headerLeft, autoHeight,
}) {

  // Bare box mode (no label)
  if (!label) {
    return (
      <div style={{
        background:"var(--dl-card)",borderRadius:R,border:"1px solid var(--dl-border)",
        overflow:"clip",height:fitContent?"auto":"100%",
        display:"flex",flexDirection:"column",...style,
      }}>{children}</div>
    );
  }

  // Panel mode (with label — header + collapsible content)
  const useAutoHeight = autoHeight || (!onToggle && !collapsed);
  return (
    <div style={slim ? {} : {flex:useAutoHeight?"0 0 auto":1,display:"flex",flexDirection:"column"}}>
      <div style={{
        background:"var(--dl-card)",borderRadius:R,border:"1px solid var(--dl-border)",overflow:"clip",
        display:"flex",flexDirection:"column",
        ...((collapsed || useAutoHeight) ? {height:"auto"} : {flex:1}),
      }}>
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"11px 14px",
          borderBottom:collapsed?"none":"1px solid var(--dl-border)",flexShrink:0,
          cursor:onToggle?"pointer":"default"}} onClick={onToggle}>
          {headerLeft}
          {onToggle&&<ChevronBtn collapsed={collapsed} onToggle={e=>{e.stopPropagation();onToggle();}}/>}
          <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",
            textTransform:"uppercase",color:labelColor||"var(--dl-highlight)",flex:1}}>{label}</span>
          {!collapsed && headerRight}
        </div>
        {!collapsed&&(
          <div style={slim ? {padding:"14px 16px"} : {flex:1,overflow:"auto",padding:16,minHeight:0}}>{children}</div>
        )}
      </div>
    </div>
  );
}

export function InfoTip({text}) {
  const [show,setShow]=useState(false);
  const [above,setAbove]=useState(false);
  const btnRef=useRef(null);
  function handleShow(){
    if(btnRef.current){ setAbove(btnRef.current.getBoundingClientRect().top>160); }
    setShow(true);
  }
  return (
    <span style={{position:"relative",display:"inline-flex",alignItems:"center"}}>
      <button ref={btnRef} onMouseEnter={handleShow} onMouseLeave={()=>setShow(false)}
        onFocus={handleShow} onBlur={()=>setShow(false)}
        style={{width:14,height:14,borderRadius:"50%",border:"1px solid var(--dl-border2)",
          background:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center",justifyContent:"center",
          color:"var(--dl-middle)",fontFamily:mono,fontSize:F.sm,lineHeight:1,flexShrink:0}}
        aria-label="More info">i</button>
      {show&&(
        <div style={{position:"absolute",...(above?{bottom:"calc(100% + 6px)"}:{top:"calc(100% + 6px)"}),
          right:"-4px",background:"var(--dl-card)",border:"1px solid var(--dl-border2)",borderRadius:6,
          padding:"8px 10px",width:190,fontFamily:mono,fontSize:F.sm,color:"var(--dl-highlight)",lineHeight:1.5,
          zIndex:500,boxShadow:"var(--dl-shadow)",pointerEvents:"none",whiteSpace:"normal"}}>
          {text}
        </div>
      )}
    </span>
  );
}

export function IntegrationToggle({on, onOn, onOff, pending}) {
  const bg = on ? "rgba(196,168,130,0.15)" : pending ? "rgba(208,136,40,0.18)" : "rgba(155,107,58,0.08)";
  const dot = on ? "var(--dl-accent)" : pending ? "var(--dl-accent)" : "var(--dl-middle)";
  const borderColor = pending ? "var(--dl-accent)70" : "var(--dl-border2)";
  return (
    <button onClick={on ? onOff : onOn} style={{
      background:bg,border:`1px solid ${borderColor}`,borderRadius:20,cursor:"pointer",
      padding:3,display:"flex",alignItems:"center",width:40,height:22,
      justifyContent:on?"flex-end":"flex-start",flexShrink:0,transition:"all 0.2s"}}>
      <div style={{width:14,height:14,borderRadius:"50%",background:dot,transition:"all 0.2s"}}/>
    </button>
  );
}

export function IntegrationRow({label, subtitle, connected, onToggleOn, onToggleOff, children, pendingToggle}) {
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:8,paddingTop:1}}>
        <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",color:"var(--dl-highlight)",flexShrink:0}}>{label}</span>
        {children}
        <div style={{marginLeft:"auto",flexShrink:0}}>
          <IntegrationToggle on={connected} onOn={onToggleOn} onOff={onToggleOff} pending={pendingToggle}/>
        </div>
      </div>
      {subtitle&&(<div style={{fontFamily:mono,fontSize:9,color:"var(--dl-middle)",letterSpacing:"0.03em",marginTop:3}}>— {subtitle}</div>)}
    </div>
  );
}

export function Shimmer({width="100%", height=14, style={}}) {
  return (
    <div style={{width,height,borderRadius:4,
      background:"linear-gradient(90deg, var(--dl-border) 25%, var(--dl-border2) 50%, var(--dl-border) 75%)",
      backgroundSize:"200% 100%",animation:"shimmer 1.4s infinite",...style}}/>
  );
}

export function NavBtn({onClick,title,children}) {
  return (
    <button onClick={onClick} title={title} style={{
      background:'none',border:'none',cursor:'pointer',color:"var(--dl-highlight)",
      fontFamily:mono,fontSize:F.md,lineHeight:1,padding:'3px 5px',borderRadius:4,transition:'color 0.1s'}}
      onMouseEnter={e=>e.currentTarget.style.color="var(--dl-strong)"}
      onMouseLeave={e=>e.currentTarget.style.color="var(--dl-highlight)"}>
      {children}
    </button>
  );
}

export function DayLabLoader({ size = 32, color = "var(--dl-strong)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1500 1500" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}>
      <style>{"@keyframes dlPulse{0%,100%{opacity:.15;transform:scale(.92)}50%{opacity:1;transform:scale(1)}}@keyframes dlDot{0%,100%{opacity:.2;transform:scale(.7)}50%{opacity:1;transform:scale(1.1)}}.dl-cross{animation:dlPulse 1.6s ease-in-out infinite;transform-origin:751px 767px}.dl-dot{animation:dlDot 1.6s ease-in-out infinite .3s;transform-origin:1048px 474px}"}</style>
      <path className="dl-cross" d="M841 518C841 551 842.5 578 845.5 599C849.5 619 856.5 635 866.5 647C877.5 659 892.5 667 911.5 671C930.5 675 955 677 985 677C1015 677 1039 679.5 1057 684.5C1076 689.5 1090.5 696 1100.5 704C1110.5 712 1117 721.5 1120 732.5C1124 742.5 1126 753 1126 764C1126 775 1124.5 786.5 1121.5 798.5C1119.5 809.5 1114 819.5 1105 828.5C1096 837.5 1082.5 845 1064.5 851C1046.5 857 1022 860 991 860C961 860 936 862 916 866C897 870 882 877.5 871 888.5C860 898.5 852 913 847 932C843 950 841 973 841 1001C841 1035 838.5 1061.5 833.5 1080.5C828.5 1099.5 821.5 1113.5 812.5 1122.5C804.5 1131.5 795 1137 784 1139C773 1141 762 1142 751 1142C721 1142 698.5 1133.5 683.5 1116.5C668.5 1098.5 661 1061 661 1004C661 951 651.5 914 632.5 893C614.5 871 580 860 529 860C481 860 443 854.5 415 843.5C387 831.5 373 806 373 767C373 737 383.5 714.5 404.5 699.5C426.5 684.5 466 677 523 677C551 677 574 675 592 671C610 666 624 658 634 647C645 635 652 619 655 599C659 579 661 553 661 521C661 493 663.5 470.5 668.5 453.5C673.5 436.5 680 423.5 688 414.5C696 405.5 705.5 399.5 716.5 396.5C727.5 393.5 739 392 751 392C784 392 807 403.5 820 426.5C834 448.5 841 479 841 518Z" fill={color}/>
      <path className="dl-dot" d="M1138 476C1138 488.667 1135.33 500.667 1130 512C1125.33 522.667 1118.67 532.333 1110 541C1102 549 1092.33 555.667 1081 561C1070.33 565.667 1059.33 568 1048 568C1036.67 568 1025.33 565.667 1014 561C1003.33 555.667 993.667 549 985 541C976.333 532.333 969.333 522.667 964 512C958.667 500.667 956 488.667 956 476C956 463.333 958.333 451.333 963 440C968.333 428.667 975 418.667 983 410C991.667 401.333 1001.33 394.667 1012 390C1023.33 384.667 1035.33 382 1048 382C1060.67 382 1072.33 384.667 1083 390C1094.33 394.667 1104 401.333 1112 410C1120 418.667 1126.33 428.667 1131 440C1135.67 451.333 1138 463.333 1138 476ZM1013 474C1013 484 1016.33 492.333 1023 499C1029.67 505.667 1038 509 1048 509C1058 509 1066.33 505.667 1073 499C1079.67 492.333 1083 484 1083 474C1083 464 1079.67 455.667 1073 449C1066.33 442.333 1058 439 1048 439C1038 439 1029.67 442.333 1023 449C1016.33 455.667 1013 464 1013 474Z" fill={color}/>
    </svg>
  );
}

export function TagChip({ name, onClick, plain = false }) {
  return (
    <span onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } } : undefined}
      style={{
        ...CHIP_TOKENS.project(projectColor(name)),
        cursor: onClick ? 'pointer' : 'default',
        opacity: plain ? 0.4 : 1,
      }}>{name.toUpperCase()}</span>
  );
}

export function NoteChip({ name, onClick }) {
  return (
    <span onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } } : undefined}
      style={{
        ...CHIP_TOKENS.note,
        cursor: onClick ? 'pointer' : 'default',
      }}>{name}</span>
  );
}

export function RichLine({ text, dimTag = null }) {
  const { navigateToProject, navigateToNote } = useNavigation();
  if (!text) return null;
  const parts = [];
  let last = 0, k = 0;
  const re = /\[img:(https?:\/\/[^\]]+|data:[^\]]+)\]|(https?:\/\/[^\s<>"')\]]+)|\{([a-z0-9][a-z0-9 ]*[a-z0-9]|[a-z0-9])\}|(#[A-Za-z][A-Za-z0-9]+(?![A-Za-z0-9]))|\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<Fragment key={k++}>{text.slice(last, m.index)}</Fragment>);
    if (m[1]) {
      parts.push(<div key={k++} style={{ margin: '6px 0', lineHeight: 0 }}><img src={m[1]} alt="" style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 8, display: 'block' }} /></div>);
    } else if (m[2]) {
      parts.push(<a key={k++} href={m[2]} target="_blank" rel="noreferrer" style={{ color: 'var(--dl-accent)', textDecoration: 'none' }}>{m[2]}</a>);
    } else if (m[3] !== undefined) {
      const tagName = m[3], isOwn = dimTag && tagName === dimTag.toLowerCase();
      parts.push(<TagChip key={k++} name={tagName} plain={isOwn} onClick={() => navigateToProject(tagName)}/>);
    } else if (m[4]) {
      const tagName = m[4].slice(1).toLowerCase(), isOwn = dimTag && tagName === dimTag.toLowerCase();
      parts.push(<TagChip key={k++} name={tagName} plain={isOwn} onClick={() => navigateToProject(tagName)}/>);
    } else if (m[5]) {
      const noteName = m[5];
      parts.push(<NoteChip key={k++} name={noteName} onClick={() => navigateToNote(noteName)}/>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<Fragment key={k++}>{text.slice(last)}</Fragment>);
  return <>{parts.length ? parts : text}</>;
}

export function SourceBadge({source}) {
  if (!source) return null;
  const isStrava = source === "strava";
  return (
    <span style={{
      fontFamily:mono, fontSize:F.sm, letterSpacing:"0.04em", textTransform:"uppercase",
      color: isStrava ? "#FC4C02" : "var(--dl-highlight)",
      border: `1px solid ${isStrava ? "#FC4C02" : "var(--dl-border2)"}`,
      borderRadius:3, padding:"1px 4px", flexShrink:0, opacity:0.8,
    }}>{isStrava ? "Strava" : "Oura"}</span>
  );
}

// ─── ErrorBoundary ─────────────────────────────────────────────────────────
// Catches render errors in children; shows a minimal fallback instead of
// crashing the entire app. Use: <ErrorBoundary label="Tasks">...</ErrorBoundary>
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error(`[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ''}]`, error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 16, textAlign: 'center',
          fontFamily: mono, fontSize: F.sm, color: 'var(--dl-middle)',
        }}>
          Something went wrong{this.props.label ? ` in ${this.props.label}` : ''}.{' '}
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--dl-accent)', fontFamily: mono, fontSize: F.sm,
              textDecoration: 'underline', padding: 0,
            }}
          >Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}
