"use client";
import { useState, useEffect } from "react";
import { useTheme } from "@/lib/theme";
import { mono, F, blurweb, injectBlurWebFont } from "@/lib/tokens";
import { createClient } from "@/lib/supabase";

export default function LoginScreen() {
  const { C } = useTheme();
  const [loading,setLoading]=useState(false);
  useEffect(() => { injectBlurWebFont(); }, []);
  return (
    <div style={{background:C.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
      <div style={{textAlign:"center"}}>
        <div style={{
          fontFamily: blurweb,
          fontSize: 28,
          letterSpacing: "normal",
          textTransform: "uppercase",
          color: "var(--dl-strong)",
          userSelect: "none",
          lineHeight: 1,
          marginBottom: 28,
        }}>DAY LAB</div>
        <div style={{fontFamily:mono,fontSize:F.sm,color:C.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:48}}>your ai dashboard</div>
        <button disabled={loading} onClick={async()=>{
          setLoading(true);
          const supabase=createClient();
          const isNative = !!(window.daylabNative);
          const redirectTo = isNative ? `daylab://auth/callback` : `${window.location.origin}/auth/callback`;
          await supabase.auth.signInWithOAuth({provider:"google",options:{
            scopes:"https://www.googleapis.com/auth/calendar",
            redirectTo,
            queryParams:{access_type:"offline",prompt:"consent"},
          }});
        }} style={{background:"none",border:`1px solid ${C.border2}`,borderRadius:8,
          color:loading?C.muted:C.text,fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",
          textTransform:"uppercase",padding:"13px 32px",cursor:loading?"not-allowed":"pointer"}}>
          {loading?"redirecting…":"sign in with google"}
        </button>

      </div>
      <div style={{position:"absolute",bottom:24,left:0,right:0,display:"flex",justifyContent:"center",gap:24}}>
        <a href="/privacy" style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",color:C.muted,textDecoration:"none",opacity:0.6}}>Privacy</a>
        <a href="/terms" style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",color:C.muted,textDecoration:"none",opacity:0.6}}>Terms</a>
      </div>
    </div>
  );
}

// ─── InsightsCard ─────────────────────────────────────────────────────────────
