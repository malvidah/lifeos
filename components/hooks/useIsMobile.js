"use client";
import { useState, useEffect } from "react";
export function useIsMobile(bp=768){const[m,setM]=useState(false);useEffect(()=>{let t;const fn=()=>{clearTimeout(t);t=setTimeout(()=>setM(window.innerWidth<bp),150);};setM(window.innerWidth<bp);window.addEventListener("resize",fn);return()=>{window.removeEventListener("resize",fn);clearTimeout(t);};},[bp]);return m;}
