const toKey = d => {
  const dt = d instanceof Date ? d : new Date(d);
  // Use local date parts — toISOString() gives UTC which is wrong for US timezones at night
  return [dt.getFullYear(), String(dt.getMonth()+1).padStart(2,"0"), String(dt.getDate()).padStart(2,"0")].join("-");
};
export const todayKey = () => toKey(new Date());
export const shift    = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };


export const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const MONTHS_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// Convert a YYYY-MM-DD key or Date to an integer day number.
// We avoid epoch subtraction entirely — just count calendar days from a fixed point.
// This sidesteps ALL timezone/DST issues.
export function keyToDayNum(key) {
  // key is always "YYYY-MM-DD" local date
  const [y, m, d] = key.split("-").map(Number);
  // Days since a distant fixed point (Jan 1 2000) using pure calendar math
  // Zeller-like: count days in each year/month without Date arithmetic
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
  // Convert day number back to a local Date at noon
  // We walk from Y2K adding years/months until we land on the right day
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
  // Return as a local noon Date (noon avoids any DST edge)
  return new Date(yr, mo-1, rem+1, 12, 0, 0);
}

// Mobile date picker — horizontal day strip with physics momentum
// Month and year are static labels (snap discretely). Only the day ribbon moves.
