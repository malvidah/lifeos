"use client";
import { useState, useCallback } from "react";
export function useCollapse(key,def=false){const[c,setC]=useState(()=>{if(typeof window==="undefined")return def;const s=localStorage.getItem(`collapse:${key}`);return s!==null?s==="1":def;});const toggle=useCallback(()=>{setC(p=>{const n=!p;localStorage.setItem(`collapse:${key}`,n?"1":"0");return n;});},[key]);return[c,toggle];}
