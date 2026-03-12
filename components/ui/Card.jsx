"use client";
export function Card({children,style={},fitContent=false}){return <div style={{background:"var(--dl-card)",borderRadius:16,padding:"10px 14px",boxShadow:"var(--dl-shadow)",overflow:"hidden",...(fitContent?{}:{flex:1,display:"flex",flexDirection:"column"}),...style}}>{children}</div>;}
