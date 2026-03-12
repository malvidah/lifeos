export const toKey=d=>{const dt=d instanceof Date?d:new Date(d);return[dt.getFullYear(),String(dt.getMonth()+1).padStart(2,"0"),String(dt.getDate()).padStart(2,"0")].join("-");};
export const todayKey=()=>toKey(new Date());
export const shift=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x;};
export function keyToDayNum(key){const[y,m,d]=key.split("-").map(Number);return Math.floor(new Date(y,m-1,d).getTime()/86400000);}
export function dayOffset(dateOrKey){const t=typeof dateOrKey==="string"?new Date(dateOrKey+"T12:00:00"):dateOrKey;return Math.floor(t.getTime()/86400000);}
export function offsetToDate(n){return new Date(n*86400000+43200000);}
export const MONTHS_FULL=["January","February","March","April","May","June","July","August","September","October","November","December"];
export const MONTHS_SHORT=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const DAYS_SHORT=["S","M","T","W","T","F","S"];
export function fmtDate(ds){if(!ds)return"";const[y,m,d]=ds.split("-").map(Number);return`${MONTHS_SHORT[m-1]} ${d}, ${y}`;}
