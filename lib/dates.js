// ─── Date utilities ───────────────────────────────────────────────────────────

export const toKey = d => {
  const dt = d instanceof Date ? d : new Date(d);
  return [dt.getFullYear(), String(dt.getMonth()+1).padStart(2,"0"), String(dt.getDate()).padStart(2,"0")].join("-");
};
export const todayKey = () => toKey(new Date());
export const shift = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };

export const MONTHS_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
export const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const DAYS_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export function fmtDate(ds) {
  const d = new Date(ds + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function keyToDayNum(key) {
  const [y, m, d] = key.split("-").map(Number);
  function daysFromY2K(yr, mo, dy) {
    let total = 0;
    for (let y = 2000; y < yr; y++) {
      total += (y%4===0&&(y%100!==0||y%400===0)) ? 366 : 365;
    }
    const mdays = [0,31,28,31,30,31,30,31,31,30,31,30,31];
    if (yr%4===0&&(yr%100!==0||yr%400===0)) mdays[2]=29;
    for (let m2 = 1; m2 < mo; m2++) total += mdays[m2];
    return total + dy - 1;
  }
  return daysFromY2K(y, m, d);
}

export function dayOffset(dateOrKey) {
  const key = typeof dateOrKey === "string" ? dateOrKey : toKey(dateOrKey);
  return keyToDayNum(key);
}

export function offsetToDate(n) {
  let rem = Math.round(n);
  let yr = 2000;
  while (true) {
    const isLeap = yr%4===0&&(yr%100!==0||yr%400===0);
    const ydays = isLeap ? 366 : 365;
    if (rem < ydays) break;
    rem -= ydays; yr++;
  }
  const mdays = [0,31,28,31,30,31,30,31,31,30,31,30,31];
  if (yr%4===0&&(yr%100!==0||yr%400===0)) mdays[2]=29;
  let mo = 1;
  while (rem >= mdays[mo]) { rem -= mdays[mo]; mo++; }
  return new Date(yr, mo-1, rem+1, 12, 0, 0);
}

// ─── Natural language date parsing ───────────────────────────────────────────

const DAYS_FULL = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const DAYS_ABBR = ['sun','mon','tue','wed','thu','fri','sat'];

/** Parse a natural-language date query into YYYY-MM-DD or null. */
export function parseNaturalDate(query) {
  if (!query) return null;
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const today = new Date(); today.setHours(12,0,0,0);

  // today / tod
  if (q === 'today' || q === 'tod') return toKey(today);

  // tomorrow / tom
  if (q === 'tomorrow' || q === 'tom') return toKey(shift(today, 1));

  // next week / nw
  if (q === 'next week' || q === 'nw') return toKey(shift(today, 7));

  // ISO pass-through
  if (/^\d{4}-\d{2}-\d{2}$/.test(q)) return q;

  // Day name: monday, mon, etc. → next occurrence
  for (let i = 0; i < 7; i++) {
    if (q === DAYS_FULL[i] || q === DAYS_ABBR[i]) {
      const dow = today.getDay();
      let diff = i - dow;
      if (diff <= 0) diff += 7;
      return toKey(shift(today, diff));
    }
  }

  // Month + day: "mar 20", "march 20"
  const mdMatch = q.match(/^([a-z]+)\s+(\d{1,2})$/);
  if (mdMatch) {
    const [, mStr, dStr] = mdMatch;
    const day = parseInt(dStr, 10);
    let monthIdx = -1;
    for (let i = 0; i < 12; i++) {
      if (MONTHS_FULL[i].toLowerCase().startsWith(mStr) || MONTHS_SHORT[i].toLowerCase() === mStr) {
        monthIdx = i; break;
      }
    }
    if (monthIdx >= 0 && day >= 1 && day <= 31) {
      let year = today.getFullYear();
      const candidate = new Date(year, monthIdx, day, 12, 0, 0);
      if (candidate < today) candidate.setFullYear(year + 1);
      return toKey(candidate);
    }
  }

  return null;
}

/** Generate suggestion items for the date dropdown. Returns [{label, date}]. */
export function generateDateSuggestions(query) {
  const today = new Date(); today.setHours(12,0,0,0);

  if (!query || !query.trim()) {
    // Default suggestions
    const dow = today.getDay();
    const nextMon = shift(today, ((1 - dow + 7) % 7) || 7);
    const nextFri = shift(today, ((5 - dow + 7) % 7) || 7);
    return [
      { label: 'Today',       date: toKey(today) },
      { label: 'Tomorrow',    date: toKey(shift(today, 1)) },
      { label: 'Next Week',   date: toKey(shift(today, 7)) },
      { label: 'Next Monday', date: toKey(nextMon) },
      { label: 'Next Friday', date: toKey(nextFri) },
    ];
  }

  // Try exact parse first
  const exact = parseNaturalDate(query);
  if (exact) {
    const d = new Date(exact + 'T12:00:00');
    const label = MONTHS_SHORT[d.getMonth()] + ' ' + d.getDate();
    return [{ label, date: exact }];
  }

  // Partial match against day names
  const q = query.trim().toLowerCase();
  const results = [];
  for (let i = 0; i < 7; i++) {
    if (DAYS_FULL[i].startsWith(q) || DAYS_ABBR[i].startsWith(q)) {
      const dow = today.getDay();
      let diff = i - dow;
      if (diff <= 0) diff += 7;
      const d = shift(today, diff);
      results.push({ label: DAYS_FULL[i].charAt(0).toUpperCase() + DAYS_FULL[i].slice(1), date: toKey(d) });
    }
  }
  if (results.length) return results;

  // Partial match on month names (no day yet)
  for (let i = 0; i < 12; i++) {
    if (MONTHS_FULL[i].toLowerCase().startsWith(q) || MONTHS_SHORT[i].toLowerCase().startsWith(q)) {
      results.push({ label: MONTHS_FULL[i], date: null });
    }
  }
  return results;
}

/** Chip color for a date tag based on proximity to today. */
export function dateChipColor(dateStr) {
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(dateStr + 'T00:00:00');
  const diff = Math.round((target - today) / 86400000);
  if (diff < 0)  return '#B06878'; // overdue — red
  if (diff === 0) return '#D08828'; // due today — orange
  if (diff <= 3)  return '#B08050'; // 1–3 days — amber
  return '#5E9E8A';                 // >3 days — green
}
