"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "../lib/supabase.js";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragOverlay, defaultDropAnimationSideEffects,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const C = {
  bg:"#0D0D0F", surface:"#16171A", card:"#1C1D21",
  border:"#26272C", border2:"#2E2F35",
  text:"#E8E4DC", muted:"#6B6870", dim:"#3A3840",
  accent:"#C4A882", green:"#4E9268", blue:"#4A82B0",
  yellow:"#B08A3E", red:"#A05050",
};
const serif = "Georgia, 'Times New Roman', serif";
const mono  = "'SF Mono', 'Fira Code', ui-monospace, monospace";

// ─── Responsive hook ──────────────────────────────────────────────────────────
function useIsMobile() {
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return mobile;
}


const R = "12px";

const toKey    = d => new Date(d).toISOString().split("T")[0];
const todayKey = () => toKey(new Date());
const shift    = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const DAY3 = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const MON3 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function weekOf(anchor) {
  const d=new Date(anchor); d.setDate(d.getDate()-((d.getDay()+6)%7));
  return Array.from({length:7},(_,i)=>shift(d,i));
}

// ─── AI ───────────────────────────────────────────────────────────────────────
async function estimateKcal(prompt) {
  const r = await fetch("/api/ai",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:64,
      system:"Return only valid JSON with a single `kcal` integer field.",
      messages:[{role:"user",content:prompt}]})});
  const d = await r.json();
  const text = d.content?.find(b=>b.type==="text")?.text||"{}";
  try { return JSON.parse(text.match(/\{[\s\S]*\}/)[0]).kcal||null; } catch { return null; }
}

// ─── DB ───────────────────────────────────────────────────────────────────────
async function dbSave(date,type,data,token) {
  if (!token) return;
  try { await fetch("/api/entries",{method:"POST",
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
    body:JSON.stringify({date,type,data})}); } catch(e) { console.warn(e); }
}
async function dbLoad(date,type,token) {
  if (!token) return null;
  try {
    const r = await fetch(`/api/entries?date=${date}&type=${type}`,{headers:{"Authorization":`Bearer ${token}`}});
    if (!r.ok) return null;
    return (await r.json()).data ?? null;
  } catch { return null; }
}
const MEM = {};
function useDbSave(date,type,empty,token) {
  const [value,_set] = useState(()=>MEM[`${date}:${type}`]??empty);
  const [loaded,setLoaded] = useState(`${date}:${type}` in MEM);
  const live=useRef(value), dateRef=useRef(date), timer=useRef(null);
  live.current=value;
  useEffect(()=>{
    if (!token) return;
    const key=`${date}:${type}`; dateRef.current=date;
    if (key in MEM){_set(MEM[key]);live.current=MEM[key];setLoaded(true);return;}
    setLoaded(false);_set(empty);live.current=empty;
    dbLoad(date,type,token).then(v=>{
      const val=v??empty; MEM[key]=val;_set(val);live.current=val;setLoaded(true);
    });
  },[date,type,token]); // eslint-disable-line
  useEffect(()=>{
    if (!token) return;
    const flush=()=>{clearTimeout(timer.current);dbSave(dateRef.current,type,live.current,token);};
    window.addEventListener("beforeunload",flush);
    document.addEventListener("visibilitychange",()=>{if(document.hidden)flush();});
    return ()=>window.removeEventListener("beforeunload",flush);
  },[type,token]); // eslint-disable-line
  const setValue=useCallback(u=>{
    const next=typeof u==="function"?u(live.current):u;
    live.current=next; MEM[`${dateRef.current}:${type}`]=next; _set(next);
    clearTimeout(timer.current);
    timer.current=setTimeout(()=>dbSave(dateRef.current,type,live.current,token),800);
  },[type,token]);
  return {value,setValue,loaded};
}

// ─── Ring ─────────────────────────────────────────────────────────────────────
function Ring({score,color,size=48}) {
  const r=(size-7)/2,circ=2*Math.PI*r,val=parseFloat(score)||0,pct=Math.min(val/100,1),elite=val>=90;
  return (
    <svg width={size} height={size} style={{transform:"rotate(-90deg)",flexShrink:0}}>
      <circle cx={size/2} cy={size/2} r={r} fill={elite?color+"18":"none"} stroke={C.dim} strokeWidth={3}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color}
        strokeWidth={elite?4:2.5} strokeLinecap="round" strokeDasharray={`${pct*circ} ${circ}`}
        style={{transition:"stroke-dasharray 0.5s cubic-bezier(.4,0,.2,1)"}}/>
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
        style={{fill:score?C.text:C.muted,fontSize:11,fontFamily:serif,
          transform:"rotate(90deg)",transformOrigin:`${size/2}px ${size/2}px`}}>
        {score||"—"}
      </text>
    </svg>
  );
}

// ─── Resizable container ──────────────────────────────────────────────────────
function Resizable({defaultH, minH=100, children, fill=false}) {
  const [h, setH] = useState(defaultH);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  // If fill=true, stretch to remaining container height instead
  if (fill) {
    return <div style={{flex:1,minHeight:minH,display:"flex",flexDirection:"column"}}>{children}</div>;
  }

  function onPointerDown(e) {
    e.preventDefault(); e.stopPropagation();
    dragging.current=true;
    startY.current=e.clientY;
    startH.current=h;

    function onMove(e) {
      if (!dragging.current) return;
      setH(Math.max(minH, startH.current + (e.clientY - startY.current)));
    }
    function onUp() {
      dragging.current=false;
      window.removeEventListener("pointermove",onMove);
      window.removeEventListener("pointerup",onUp);
    }
    window.addEventListener("pointermove",onMove);
    window.addEventListener("pointerup",onUp);
  }

  return (
    <div style={{position:"relative",height:h,flexShrink:0}}>
      <div style={{height:"100%"}}>{children}</div>
      {/* Resize handle strip */}
      <div onPointerDown={onPointerDown} style={{
        position:"absolute",bottom:-4,left:0,right:0,height:10,
        cursor:"ns-resize",zIndex:20,
        display:"flex",alignItems:"center",justifyContent:"center",
      }}>
        <div className="resize-pill" style={{
          width:36,height:4,borderRadius:3,
          background:C.border2,transition:"background 0.15s, transform 0.15s",
        }}/>
      </div>
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────
function Card({children,style={}}) {
  return (
    <div style={{
      background:C.card,borderRadius:R,border:`1px solid ${C.border}`,
      overflow:"hidden",height:"100%",
      boxShadow:"0 1px 3px rgba(0,0,0,0.4),0 4px 16px rgba(0,0,0,0.2)",
      display:"flex",flexDirection:"column",
      ...style,
    }}>{children}</div>
  );
}

// ─── Sortable wrapper ─────────────────────────────────────────────────────────
function SortableCard({id,children}) {
  const {attributes,listeners,setNodeRef,transform,transition,isDragging} = useSortable({id});
  return (
    <div ref={setNodeRef} style={{
      transform:CSS.Transform.toString(transform),
      transition:transition||"transform 200ms cubic-bezier(.4,0,.2,1)",
      opacity:isDragging?0:1,
    }}>
      {children({dragProps:{...attributes,...listeners}})}
    </div>
  );
}

// ─── Widget card ─────────────────────────────────────────────────────────────
function Widget({label,color,dragProps,children}) {
  return (
    <div style={{height:"100%",display:"flex",flexDirection:"column"}}>
      <Card>
        <div style={{
          display:"flex",alignItems:"center",gap:8,padding:"10px 14px",
          borderBottom:`1px solid ${C.border}`,flexShrink:0,
        }}>
          <div {...dragProps} style={{cursor:"grab",color:C.dim,fontSize:15,
            lineHeight:1,touchAction:"none",userSelect:"none"}}>⠿</div>
          <div style={{width:3,height:13,borderRadius:2,background:color,flexShrink:0}}/>
          <span style={{fontFamily:mono,fontSize:9,letterSpacing:"0.2em",
            textTransform:"uppercase",color:C.muted}}>{label}</span>
        </div>
        <div style={{flex:1,overflow:"auto",padding:14,minHeight:0}}>{children}</div>
      </Card>
    </div>
  );
}

// ─── UserMenu ─────────────────────────────────────────────────────────────────
function UserMenu({session,token}) {
  const [open,setOpen]=useState(false);
  const [ouraKey,setOuraKey]=useState("");
  const [saved,setSaved]=useState(false);
  const [saving,setSaving]=useState(false);
  const ref=useRef(null);
  const user=session?.user;
  const initials=user?.user_metadata?.name?.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()||user?.email?.[0]?.toUpperCase()||"?";
  const avatar=user?.user_metadata?.avatar_url;

  useEffect(()=>{if(!token||!open)return;dbLoad("global","settings",token).then(d=>{if(d?.ouraToken)setOuraKey(d.ouraToken);});},[token,open]); // eslint-disable-line
  useEffect(()=>{
    if(!open)return;
    const fn=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    document.addEventListener("mousedown",fn);
    return ()=>document.removeEventListener("mousedown",fn);
  },[open]);

  async function saveKey(){setSaving(true);await dbSave("global","settings",{ouraToken:ouraKey},token);setSaving(false);setSaved(true);setTimeout(()=>setSaved(false),2000);}

  return (
    <div ref={ref} style={{position:"relative"}}>
      <button onClick={()=>setOpen(o=>!o)} style={{
        width:32,height:32,borderRadius:"50%",padding:0,cursor:"pointer",
        border:`1.5px solid ${C.border2}`,background:avatar?"transparent":C.surface,
        overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"}}>
        {avatar?<img src={avatar} width={32} height={32} style={{objectFit:"cover"}} alt=""/>
          :<span style={{fontFamily:mono,fontSize:10,color:C.muted}}>{initials}</span>}
      </button>
      {open&&(
        <div style={{position:"absolute",top:40,right:0,width:256,zIndex:300,
          background:C.card,border:`1px solid ${C.border2}`,borderRadius:R,
          padding:16,display:"flex",flexDirection:"column",gap:12,
          boxShadow:"0 8px 32px rgba(0,0,0,0.6)"}}>
          <div>
            <div style={{fontFamily:serif,fontSize:14,color:C.text}}>{user?.user_metadata?.name||"—"}</div>
            <div style={{fontFamily:mono,fontSize:9,color:C.muted,marginTop:3}}>{user?.email}</div>
          </div>
          <div style={{height:1,background:C.border}}/>
          <div>
            <div style={{fontFamily:mono,fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase",color:C.muted,marginBottom:8}}>Oura API Key</div>
            <input type="password" value={ouraKey} onChange={e=>{setOuraKey(e.target.value);setSaved(false);}} placeholder="paste token here"
              style={{width:"100%",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:6,outline:"none",
                color:C.text,fontFamily:mono,fontSize:10,padding:"7px 10px",marginBottom:8}}/>
            <button onClick={saveKey} disabled={saving||!ouraKey.trim()} style={{
              width:"100%",background:saved?C.green+"22":"none",border:`1px solid ${saved?C.green:C.border2}`,
              borderRadius:6,color:saved?C.green:ouraKey.trim()?C.text:C.muted,
              fontFamily:mono,fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase",
              padding:"7px",cursor:ouraKey.trim()?"pointer":"default",transition:"all 0.2s"}}>
              {saved?"saved ✓":saving?"saving…":"save key"}
            </button>
          </div>
          <div style={{height:1,background:C.border}}/>
          <button onClick={async()=>{const s=createClient();await s.auth.signOut();}}
            style={{background:"none",border:"none",padding:0,textAlign:"left",cursor:"pointer",
              color:C.muted,fontFamily:mono,fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase"}}>
            sign out →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── TopBar ───────────────────────────────────────────────────────────────────
function TopBar({session,token,syncStatus}) {
  return (
    <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"0 16px",
      height:48,display:"flex",alignItems:"center",gap:12,flexShrink:0,
      position:"sticky",top:0,zIndex:100}}>
      <span style={{fontFamily:serif,fontSize:15,color:C.text,letterSpacing:"-0.01em"}}>Life OS</span>
      <div style={{flex:1}}/>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        <div style={{width:6,height:6,borderRadius:"50%",
          background:syncStatus.syncing?C.yellow:C.green,
          boxShadow:syncStatus.syncing?`0 0 6px ${C.yellow}`:`0 0 6px ${C.green}`,
          transition:"background 0.3s"}}/>
        <span style={{fontFamily:mono,fontSize:9,color:C.muted,letterSpacing:"0.06em"}}>
          {syncStatus.syncing?"syncing":syncStatus.lastSync||"synced"}
        </span>
      </div>
      <UserMenu session={session} token={token}/>
    </div>
  );
}

// ─── CalStrip ────────────────────────────────────────────────────────────────
function CalStrip({selected,onSelect,events,healthDots,dragProps}) {
  const [anchor,setAnchor]=useState(()=>new Date());
  const mobile = useIsMobile();
  const days=weekOf(anchor),today=todayKey();
  const months=[...new Set(days.map(d=>MON3[d.getMonth()]))].join(" · ");

  return (
    <Card>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
        <div {...dragProps} style={{cursor:"grab",color:C.dim,fontSize:15,lineHeight:1,touchAction:"none",userSelect:"none"}}>⠿</div>
        <span style={{fontFamily:serif,fontSize:mobile?15:18,color:C.text,letterSpacing:"-0.02em",lineHeight:1}}>{months}</span>
        <span style={{fontFamily:mono,fontSize:mobile?10:12,color:C.muted,marginLeft:2}}>{days[0].getFullYear()}</span>
        <div style={{flex:1}}/>
        {[["‹",()=>setAnchor(d=>shift(d,-7))],["today",()=>{setAnchor(new Date());onSelect(todayKey());}],["›",()=>setAnchor(d=>shift(d,7))]].map(([l,fn])=>(
          <button key={l} onClick={fn} style={{background:"none",cursor:"pointer",
            border:`1px solid ${C.border2}`,borderRadius:6,color:C.muted,fontFamily:mono,
            padding:l==="today"?"4px 8px":"4px 7px",fontSize:l==="today"?9:13,
            letterSpacing:l==="today"?"0.08em":"0",transition:"border-color 0.15s,color 0.15s"}}>{l}</button>
        ))}
      </div>

      {/* Day columns */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",flex:1,overflow:"hidden"}}>
        {days.map((d,i)=>{
          const k=toKey(d),sel=k===selected,tod=k===today;
          const allEvts=(events[k]||[]).slice().sort((a,b)=>(a.time||"").localeCompare(b.time||""));
          // On mobile show max 2 events, on desktop show all
          const evts = mobile ? allEvts.slice(0,2) : allEvts;
          const dot=healthDots[k]||{};
          return (
            <div key={k} onClick={()=>onSelect(k)} style={{cursor:"pointer",
              borderRight:i<6?`1px solid ${C.border}`:"none",
              background:sel?"rgba(196,168,130,0.06)":"transparent",transition:"background 0.15s",
              display:"flex",flexDirection:"column"}}>
              {/* Day header */}
              <div style={{padding:mobile?"6px 3px 3px":"8px 6px 4px",display:"flex",flexDirection:"column",alignItems:"center",gap:1,
                borderBottom:`1px solid ${C.border}`,flexShrink:0,
                borderTop:sel?`2px solid ${C.accent}`:tod?`2px solid ${C.muted}`:`2px solid transparent`}}>
                <span style={{fontFamily:mono,fontSize:mobile?7:9,letterSpacing:"0.06em",color:sel?C.accent:C.muted}}>{DAY3[i]}</span>
                <span style={{fontFamily:serif,fontSize:mobile?14:17,lineHeight:1,color:tod?C.accent:C.text}}>{d.getDate()}</span>
                {!mobile && <div style={{display:"flex",gap:2,height:4,alignItems:"center",marginTop:1}}>
                  {dot.sleep>=90    &&<span style={{width:3,height:3,borderRadius:"50%",background:C.blue,display:"inline-block"}}/>}
                  {dot.readiness>=90&&<span style={{width:3,height:3,borderRadius:"50%",background:C.green,display:"inline-block"}}/>}
                  {dot.strain>=90   &&<span style={{width:3,height:3,borderRadius:"50%",background:C.yellow,display:"inline-block"}}/>}
                </div>}
              </div>
              {/* Events */}
              <div style={{padding:mobile?"3px 3px":"5px 6px",display:"flex",flexDirection:"column",gap:mobile?2:3,flex:1,overflow:"hidden"}}>
                {evts.length===0
                  ? !mobile && <span style={{fontFamily:mono,fontSize:9,color:C.dim}}>—</span>
                  : evts.map((ev,ei)=>(
                    <div key={ei}>
                      {mobile
                        ? <div style={{
                            width:"100%",height:3,borderRadius:2,
                            background:ev.color||C.accent,opacity:0.8,marginBottom:1
                          }}/>
                        : <div style={{display:"flex",gap:4,alignItems:"baseline"}}>
                            <span style={{fontFamily:mono,fontSize:8,color:ev.color||C.accent,flexShrink:0,whiteSpace:"nowrap",opacity:0.9}}>{ev.time}</span>
                            <span style={{fontFamily:serif,fontSize:11,lineHeight:1.4,wordBreak:"break-word",color:sel?C.text:"#AAA5A0",
                              overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{ev.title}</span>
                          </div>
                      }
                    </div>
                  ))
                }
                {mobile && allEvts.length > 2 &&
                  <span style={{fontFamily:mono,fontSize:7,color:C.dim}}>+{allEvts.length-2}</span>
                }
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
// ─── HealthStrip ──────────────────────────────────────────────────────────────
const H_EMPTY={sleepScore:"",sleepHrs:"",sleepEff:"",readinessScore:"",hrv:"",rhr:"",strainScore:"",strainNote:""};
function HealthStrip({date,token,onHealthChange,onSyncStart,onSyncEnd,dragProps}) {
  const {value:h,setValue:setH,loaded}=useDbSave(date,"health",H_EMPTY,token);
  const set=k=>e=>setH(p=>({...p,[k]:e.target.value}));
  useEffect(()=>{if(loaded)onHealthChange(date,h);},[h,loaded]); // eslint-disable-line
  useEffect(()=>{
    if(!loaded||!token)return;
    onSyncStart("oura");
    fetch(`/api/oura?date=${date}`,{headers:{Authorization:`Bearer ${token}`}})
      .then(r=>r.json()).then(data=>{
        if(data.error)return;
        setH(p=>({...p,
          sleepScore:p.sleepScore||data.sleepScore||"",sleepHrs:p.sleepHrs||data.sleepHrs||"",
          sleepEff:p.sleepEff||data.sleepQuality||"",readinessScore:p.readinessScore||data.readinessScore||"",
          hrv:p.hrv||data.hrv||"",rhr:p.rhr||data.rhr||"",
        }));
      }).catch(()=>{}).finally(()=>onSyncEnd("oura"));
  },[date,loaded,token]); // eslint-disable-line

  const metrics=[
    {key:"sleep",label:"Sleep",color:C.blue,score:h.sleepScore,setScore:e=>setH(p=>({...p,sleepScore:e.target.value})),
      fields:[{label:"Hours",value:h.sleepHrs,onChange:set("sleepHrs"),unit:"h"},{label:"Efficiency",value:h.sleepEff,onChange:set("sleepEff"),unit:"%"}]},
    {key:"readiness",label:"Readiness",color:C.green,score:h.readinessScore,setScore:e=>setH(p=>({...p,readinessScore:e.target.value})),
      fields:[{label:"HRV",value:h.hrv,onChange:set("hrv"),unit:"ms"},{label:"Resting HR",value:h.rhr,onChange:set("rhr"),unit:"bpm"}]},
    {key:"strain",label:"Strain",color:C.yellow,score:h.strainScore,setScore:e=>setH(p=>({...p,strainScore:e.target.value})),
      fields:[{label:"Note",value:h.strainNote,onChange:set("strainNote"),unit:""}]},
  ];

  const mobileH = useIsMobile();
  return (
    <Card style={{overflow:"visible"}}>
      <div style={{display:"flex",alignItems:"stretch",flexWrap:mobileH?"wrap":"nowrap"}}>
        {!mobileH && <div style={{display:"flex",alignItems:"center",padding:"0 10px",borderRight:`1px solid ${C.border}`}}>
          <div {...dragProps} style={{cursor:"grab",color:C.dim,fontSize:15,lineHeight:1,touchAction:"none",userSelect:"none"}}>⠿</div>
        </div>}
        {metrics.map((m,mi)=>(
          <div key={m.key} style={{flex:mobileH?"1 1 30%":"1 1 0",display:"flex",alignItems:"center",gap:mobileH?8:12,
            padding:mobileH?"10px 10px":"12px 14px",borderRight:(!mobileH&&mi<2)?`1px solid ${C.border}`:"none",
            borderBottom:mobileH&&mi<2?`1px solid ${C.border}`:"none"}}>
            <div style={{position:"relative",flexShrink:0}}>
              <Ring score={m.score} color={m.color} size={48}/>
              <input value={m.score} onChange={m.setScore} style={{position:"absolute",inset:0,opacity:0,cursor:"text",width:"100%",fontSize:16}}/>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:mono,fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:m.color,marginBottom:6}}>{m.label}</div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                {m.fields.map(f=>(
                  <div key={f.label}>
                    <div style={{fontFamily:mono,fontSize:8,textTransform:"uppercase",color:C.muted,marginBottom:2,letterSpacing:"0.08em"}}>{f.label}</div>
                    <div style={{display:"flex",alignItems:"baseline",gap:2}}>
                      <input value={f.value} onChange={f.onChange} placeholder="—"
                        style={{background:"transparent",border:"none",outline:"none",padding:0,
                          color:f.value?C.text:C.dim,fontFamily:serif,fontSize:17,width:f.unit?38:80}}/>
                      {f.unit&&<span style={{fontFamily:mono,fontSize:9,color:C.muted}}>{f.unit}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Notes ────────────────────────────────────────────────────────────────────
// ─── Notes ────────────────────────────────────────────────────────────────────
// Plain textarea with a transparent overlay that colorizes "# heading" lines.
// Cmd+B / Cmd+I wrap selected text in ** / *.
function Notes({date,token}) {
  const {value,setValue,loaded} = useDbSave(date,"notes","",token);
  const [editing, setEditing] = useState(false);
  const taRef = useRef(null);

  useEffect(() => {
    if (editing) taRef.current?.focus();
  }, [editing]);

  function wrapSelection(marker) {
    const ta = taRef.current;
    if (!ta) return;
    const {selectionStart:s, selectionEnd:e, value:v} = ta;
    if (s === e) return;
    setValue(v.slice(0,s) + marker + v.slice(s,e) + marker + v.slice(e));
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + marker.length, e + marker.length);
    });
  }

  function handleKeyDown(e) {
    if ((e.metaKey||e.ctrlKey) && e.key==="b") { e.preventDefault(); wrapSelection("**"); }
    if ((e.metaKey||e.ctrlKey) && e.key==="i") { e.preventDefault(); wrapSelection("*"); }
  }

  // Render markdown as React elements
  function renderContent(text) {
    if (!text || !text.trim()) return null;
    return text.split("\n").map((line, i) => {
      // Heading
      if (line.startsWith("# ")) {
        return <div key={i} style={{color:"#D4A853",fontFamily:serif,fontSize:15,lineHeight:"1.8"}}>{renderInline(line.slice(2))}</div>;
      }
      // Empty line
      if (!line.trim()) {
        return <div key={i} style={{height:"1.8em"}}>&nbsp;</div>;
      }
      // Normal
      return <div key={i} style={{color:C.text,fontFamily:serif,fontSize:15,lineHeight:"1.8"}}>{renderInline(line)}</div>;
    });
  }

  function renderInline(text) {
    const re = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
    const parts = []; let last=0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      if (m[0].startsWith("**")) parts.push(<strong key={m.index}>{m[2]}</strong>);
      else parts.push(<em key={m.index}>{m[3]}</em>);
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  }

  if (!loaded) return <div style={{fontFamily:mono,fontSize:9,color:C.muted}}>Loading…</div>;

  const textareaStyle = {
    fontFamily:serif, fontSize:15, lineHeight:"1.8",
    padding:0, margin:0, border:"none", outline:"none",
    width:"100%", height:"100%", resize:"none",
    background:"transparent", color:C.text, caretColor:C.accent,
    whiteSpace:"pre-wrap", wordBreak:"break-word",
  };

  if (editing) {
    return (
      <textarea
        ref={taRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={handleKeyDown}
        style={textareaStyle}
      />
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      style={{height:"100%", overflow:"auto", cursor:"text"}}
    >
      {value && value.trim()
        ? renderContent(value)
        : <div style={{color:C.muted,fontFamily:serif,fontSize:15,lineHeight:"1.8"}}>
            What's on your mind?
            <span style={{display:"block",fontFamily:mono,fontSize:9,letterSpacing:"0.1em",
              textTransform:"uppercase",color:C.dim,marginTop:6,opacity:0.7}}>
              # heading &nbsp;·&nbsp; ⌘B bold &nbsp;·&nbsp; ⌘I italic
            </span>
          </div>
      }
    </div>
  );
}

// ─── RowList ─────────────────────────────────────────────────────────────────
function RowList({date,type,placeholder,promptFn,prefix,color,token}) {
  const mkRow=()=>({id:Date.now(),text:"",kcal:null});
  const {value:rows,setValue:setRows,loaded}=useDbSave(date,type,[mkRow()],token);
  const refs=useRef({});
  const safe=Array.isArray(rows)&&rows.length?rows:[mkRow()];
  const total=safe.reduce((s,r)=>s+(r.kcal||0),0);

  async function runEstimate(id,text){
    setRows(safe.map(r=>r.id===id?{...r,estimating:true}:r));
    const kcal=await estimateKcal(promptFn(text)).catch(()=>null);
    setRows(prev=>(Array.isArray(prev)?prev:safe).map(r=>r.id===id?{...r,kcal,estimating:false}:r));
  }
  function onKey(e,id,idx){
    if(e.key==="Enter"){e.preventDefault();const row=mkRow();setRows([...safe.slice(0,idx+1),row,...safe.slice(idx+1)]);setTimeout(()=>refs.current[row.id]?.focus(),30);}
    if(e.key==="Backspace"&&safe[idx].text===""&&safe.length>1){e.preventDefault();setRows(safe.filter(r=>r.id!==id));const t=safe[idx-1]?.id??safe[idx+1]?.id;setTimeout(()=>refs.current[t]?.focus(),30);}
  }
  if(!loaded) return <div style={{fontFamily:mono,fontSize:9,color:C.muted}}>Loading…</div>;
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      {safe.map((row,idx)=>(
        <div key={row.id} style={{display:"flex",alignItems:"baseline",gap:8,padding:"2px 0",minHeight:28}}>
          <input ref={el=>refs.current[row.id]=el} value={row.text}
            onChange={e=>setRows(safe.map(r=>r.id===row.id?{...r,text:e.target.value,kcal:null}:r))}
            onBlur={e=>{const r=safe.find(r=>r.id===row.id);if(e.target.value.trim()&&r?.kcal===null&&!r?.estimating)runEstimate(row.id,e.target.value);}}
            onKeyDown={e=>onKey(e,row.id,idx)} placeholder={idx===0?placeholder:""}
            style={{background:"transparent",border:"none",outline:"none",padding:0,flex:1,lineHeight:1.7,
              color:row.text?C.text:C.muted,fontFamily:serif,fontSize:15}}/>
          <span style={{fontFamily:mono,fontSize:10,color,flexShrink:0,minWidth:38,textAlign:"right",opacity:0.85}}>
            {row.estimating?"…":row.kcal?`${prefix}${row.kcal}`:""}
          </span>
        </div>
      ))}
      {total>0&&(
        <div style={{marginTop:"auto",paddingTop:8,display:"flex",alignItems:"center",gap:8}}>
          <div style={{flex:1,height:1,background:C.border}}/>
          <span style={{fontFamily:mono,fontSize:11,color,opacity:0.9}}>{prefix}{total} kcal</span>
        </div>
      )}
    </div>
  );
}
function Meals({date,token}){return <RowList date={date} type="meals" token={token} placeholder="What did you eat?" promptFn={t=>`Calories in: "${t}". Return JSON: {"kcal":420}`} prefix="" color={C.accent}/>;}
function Activity({date,token}){return <RowList date={date} type="activity" token={token} placeholder="What did you do?" promptFn={t=>`Calories burned: "${t}" for a typical adult. Return JSON: {"kcal":300}`} prefix="−" color={C.green}/>;}

// ─── Tasks ────────────────────────────────────────────────────────────────────
function Tasks({date,token}) {
  const mkRow=()=>({id:Date.now(),text:"",done:false});
  const {value:rows,setValue:setRows,loaded}=useDbSave(date,"tasks",[mkRow()],token);
  const refs=useRef({});
  const safe=Array.isArray(rows)&&rows.length?rows:[mkRow()];
  const open=safe.filter(r=>!r.done),done=safe.filter(r=>r.done);
  function onKey(e,id,idx){
    if(e.key==="Enter"){e.preventDefault();const row=mkRow();setRows([...safe.slice(0,idx+1),row,...safe.slice(idx+1)]);setTimeout(()=>refs.current[row.id]?.focus(),30);}
    if(e.key==="Backspace"&&safe[idx].text===""&&safe.length>1){e.preventDefault();setRows(safe.filter(r=>r.id!==id));if(safe[idx-1])setTimeout(()=>refs.current[safe[idx-1].id]?.focus(),30);}
  }
  if(!loaded) return <div style={{fontFamily:mono,fontSize:9,color:C.muted}}>Loading…</div>;
  return (
    <div style={{flex:1,overflow:"auto"}}>
      {[...open,...done].map((row,idx)=>(
        <div key={row.id} style={{display:"flex",alignItems:"center",gap:10,padding:"4px 0",minHeight:28,
          opacity:row.done?0.35:1,transition:"opacity 0.2s"}}>
          <button onClick={()=>setRows(safe.map(r=>r.id===row.id?{...r,done:!r.done}:r))}
            style={{width:15,height:15,flexShrink:0,borderRadius:4,padding:0,cursor:"pointer",
              border:`1.5px solid ${row.done?C.accent:C.border2}`,background:row.done?C.accent:"transparent",
              display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s"}}>
            {row.done&&<span style={{fontSize:8,color:C.bg,lineHeight:1}}>✓</span>}
          </button>
          <input ref={el=>refs.current[row.id]=el} value={row.text}
            onChange={e=>setRows(safe.map(r=>r.id===row.id?{...r,text:e.target.value}:r))}
            onKeyDown={e=>onKey(e,row.id,idx)}
            placeholder={idx===0&&open.length===1&&!row.text?"Add a task…":""}
            style={{background:"transparent",border:"none",outline:"none",padding:0,flex:1,lineHeight:1.7,
              color:row.done?C.muted:C.text,fontFamily:serif,fontSize:15,textDecoration:row.done?"line-through":"none"}}/>
        </div>
      ))}
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginScreen() {
  const [loading,setLoading]=useState(false);
  return (
    <div style={{background:C.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontFamily:serif,fontSize:32,color:C.text,marginBottom:6,letterSpacing:"-0.02em"}}>Life OS</div>
        <div style={{fontFamily:mono,fontSize:9,color:C.muted,letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:48}}>your personal dashboard</div>
        <button disabled={loading} onClick={async()=>{
          setLoading(true);
          const supabase=createClient();
          await supabase.auth.signInWithOAuth({provider:"google",options:{
            scopes:"https://www.googleapis.com/auth/calendar.readonly",
            redirectTo:`${window.location.origin}/auth/callback`,
          }});
        }} style={{background:"none",border:`1px solid ${C.border2}`,borderRadius:8,
          color:loading?C.muted:C.text,fontFamily:mono,fontSize:10,letterSpacing:"0.15em",
          textTransform:"uppercase",padding:"13px 32px",cursor:loading?"not-allowed":"pointer"}}>
          {loading?"redirecting…":"sign in with google"}
        </button>
      </div>
    </div>
  );
}

// ─── Widget definitions ───────────────────────────────────────────────────────
const WIDGET_DEFS = [
  {id:"notes",    label:"Notes",    color:C.accent, Comp:Notes},
  {id:"tasks",    label:"Tasks",    color:C.blue,   Comp:Tasks},
  {id:"meals",    label:"Meals",    color:C.red,    Comp:Meals},
  {id:"activity", label:"Activity", color:C.green,  Comp:Activity},
];
const FULL_IDS   = ["cal","health"];
const WIDGET_IDS = WIDGET_DEFS.map(w=>w.id);

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [session,   setSession]   = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [selected,  setSelected]  = useState(todayKey);
  const [events,    setEvents]    = useState({});
  const [healthDots,setHealthDots]= useState({});
  const [syncing,   setSyncing]   = useState(new Set());
  const [lastSync,  setLastSync]  = useState(null);

  // Full-width sections order
  const [fullOrder, setFullOrder] = useState(FULL_IDS);
  // Left column: first widget; right column: rest
  const [leftId,    setLeftId]    = useState("notes");
  const [rightOrder,setRightOrder]= useState(["tasks","meals","activity"]);

  // Heights (resizable)
  const [heights, setHeights] = useState({
    cal:300,
    tasks:1, meals:1, activity:1,  // flex ratios for right column
  });

  const sensors = useSensors(useSensor(PointerSensor,{activationConstraint:{distance:8}}));

  useEffect(()=>{
    const supabase=createClient();
    const code=new URLSearchParams(window.location.search).get("code");
    if(code){supabase.auth.exchangeCodeForSession(code).then(()=>window.history.replaceState({},document.title,window.location.pathname));}
    supabase.auth.getSession().then(({data:{session}})=>{setSession(session);setAuthReady(true);});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_,s)=>{setSession(s);setAuthReady(true);});
    return ()=>subscription.unsubscribe();
  },[]);

  const token=session?.access_token;
  const googleToken=session?.provider_token;
  const startSync=useCallback(k=>setSyncing(s=>new Set([...s,k])),[]);
  const endSync=useCallback(k=>{
    setSyncing(s=>{const n=new Set(s);n.delete(k);return n;});
    setLastSync(new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}));
  },[]);

  useEffect(()=>{
    if(!googleToken)return;
    startSync("cal");
    fetch("/api/calendar",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({token:googleToken,start:toKey(shift(new Date(),-7)),end:toKey(shift(new Date(),21))})})
      .then(r=>r.json()).then(d=>{if(d.events)setEvents(d.events);}).catch(()=>{}).finally(()=>endSync("cal"));
  },[googleToken]); // eslint-disable-line

  const onHealthChange=useCallback((date,data)=>{
    setHealthDots(prev=>({...prev,[date]:{sleep:+data.sleepScore||0,readiness:+data.readinessScore||0,strain:+data.strainScore||0}}));
  },[]);

  const wMap=Object.fromEntries(WIDGET_DEFS.map(w=>[w.id,w]));

  function makeResizeHandler(id) {
    return function(e){
      e.preventDefault(); e.stopPropagation();
      if (id === "cal") {
        // Cal uses px height
        const startY=e.clientY, startH=heights.cal;
        function onMove(e){setHeights(h=>({...h,cal:Math.max(120,startH+(e.clientY-startY))}));}
        function onUp(){window.removeEventListener("pointermove",onMove);window.removeEventListener("pointerup",onUp);}
        window.addEventListener("pointermove",onMove);
        window.addEventListener("pointerup",onUp);
      } else {
        // Right column widgets use flex ratios
        const startY=e.clientY, startRatio=heights[id]||1;
        function onMove(e){
          const delta=(e.clientY-startY)/100; // scale delta to ratio units
          setHeights(h=>({...h,[id]:Math.max(0.2,startRatio+delta)}));
        }
        function onUp(){window.removeEventListener("pointermove",onMove);window.removeEventListener("pointerup",onUp);}
        window.addEventListener("pointermove",onMove);
        window.addEventListener("pointerup",onUp);
      }
    };
  }

  // Bottom resize handle UI
  function ResizeHandle({id}) {
    return (
      <div onPointerDown={makeResizeHandler(id)} style={{
        height:10,display:"flex",alignItems:"center",justifyContent:"center",
        cursor:"ns-resize",flexShrink:0,
      }}>
        <div style={{
          width:32,height:3,borderRadius:2,background:C.border,
          transition:"background 0.15s",
        }}
          onPointerEnter={e=>e.currentTarget.style.background=C.accent}
          onPointerLeave={e=>e.currentTarget.style.background=C.border}
        />
      </div>
    );
  }

  // Drag handling for full-width sections
  const [activeId,setActiveId]=useState(null);
  function handleDragStart({active}){setActiveId(active.id);}
  function handleDragEnd({active,over}){
    setActiveId(null);
    if(!over||active.id===over.id)return;
    setFullOrder(o=>arrayMove(o,o.indexOf(active.id),o.indexOf(over.id)));
  }

  if(!authReady) return (
    <div style={{background:C.bg,height:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <span style={{fontFamily:mono,fontSize:9,color:C.muted,letterSpacing:"0.2em"}}>loading…</span>
    </div>
  );
  if(!session) return <LoginScreen/>;

  const syncStatus={syncing:syncing.size>0,lastSync};
  const leftWidget  = wMap[leftId];
  const rightWidgets = rightOrder.map(id=>wMap[id]).filter(Boolean);
  const mobile = useIsMobile();

  // Mobile calendar is shorter
  const calH = mobile ? 200 : heights.cal;

  return (
    <div style={{background:C.bg,height:"100vh",color:C.text,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{height:100%;overflow:hidden;background:${C.bg};}
        ::-webkit-scrollbar{width:3px;height:3px;}
        ::-webkit-scrollbar-thumb{background:${C.border2};border-radius:4px;}
        button{border-radius:0;}
        input::placeholder,textarea::placeholder{color:${C.muted};opacity:1;}
        a{text-decoration:none;}
        input,textarea,select{font-size:16px;}
      `}</style>

      <TopBar session={session} token={token} syncStatus={syncStatus}/>

      {mobile ? (
        /* ── MOBILE: single scrollable column ───────────────────────────── */
        <div style={{flex:1,overflowY:"auto",padding:8,display:"flex",flexDirection:"column",gap:8}}>
          {/* Calendar */}
          <div style={{height:calH,flexShrink:0}}>
            <CalStrip selected={selected} onSelect={setSelected}
              events={events} healthDots={healthDots} dragProps={{}}/>
          </div>
          {/* Health */}
          <HealthStrip date={selected} token={token}
            onHealthChange={onHealthChange} onSyncStart={startSync} onSyncEnd={endSync}
            dragProps={{}}/>
          {/* All widgets stacked */}
          {[leftWidget,...rightWidgets].map(w=>(
            <div key={w.id} style={{minHeight:200}}>
              <Widget label={w.label} color={w.color} dragProps={{}}>
                <w.Comp date={selected} token={token}/>
              </Widget>
            </div>
          ))}
        </div>
      ) : (
        /* ── DESKTOP: fixed layout ──────────────────────────────────────── */
        <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column",padding:10,gap:8,minHeight:0}}>

          {/* Full-width: cal + health */}
          <DndContext sensors={sensors} collisionDetection={closestCenter}
            onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <SortableContext items={fullOrder} strategy={verticalListSortingStrategy}>
              <div style={{display:"flex",flexDirection:"column",gap:0,flexShrink:0}}>
                {fullOrder.map((id,idx)=>(
                  <div key={id} style={{marginBottom:idx<fullOrder.length-1?8:0}}>
                    <SortableCard id={id}>
                      {({dragProps})=>
                        id==="cal"
                          ? <div style={{height:heights.cal}}>
                              <CalStrip selected={selected} onSelect={setSelected}
                                events={events} healthDots={healthDots} dragProps={dragProps}/>
                            </div>
                          : <HealthStrip date={selected} token={token}
                              onHealthChange={onHealthChange} onSyncStart={startSync} onSyncEnd={endSync}
                              dragProps={dragProps}/>
                      }
                    </SortableCard>
                    {id==="cal" && <ResizeHandle id="cal"/>}
                  </div>
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeId&&(
                <div style={{background:C.card,border:`1px solid ${C.accent}`,borderRadius:R,
                  padding:"12px 18px",fontFamily:mono,fontSize:10,letterSpacing:"0.15em",
                  textTransform:"uppercase",color:C.accent,boxShadow:"0 12px 40px rgba(0,0,0,0.7)"}}>
                  {activeId==="cal"?"Calendar":"Health"}
                </div>
              )}
            </DragOverlay>
          </DndContext>

          {/* Widget area — fills remaining space */}
          <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,minHeight:0}}>
            <div style={{minHeight:0,height:"100%"}}>
              <Widget label={leftWidget.label} color={leftWidget.color} dragProps={{}}>
                <leftWidget.Comp date={selected} token={token}/>
              </Widget>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8,minHeight:0}}>
              {rightWidgets.map((w,i)=>(
                <div key={w.id} style={{flex:heights[w.id]||1,minHeight:80,display:"flex",flexDirection:"column"}}>
                  <div style={{flex:1,minHeight:0}}>
                    <Widget label={w.label} color={w.color} dragProps={{}}>
                      <w.Comp date={selected} token={token}/>
                    </Widget>
                  </div>
                  {i < rightWidgets.length-1 && <ResizeHandle id={w.id}/>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
