export const MEM = {};
export const DIRTY = {};
let CURRENT_USER_ID = null;

// ─── Global undo/redo history ────────────────────────────────────────────────
// Each entry: { label, undo: fn, redo: fn }
export const HISTORY = { stack: [], cursor: -1 };
export function pushHistory(entry) {
  // Drop any redo tail
  HISTORY.stack = HISTORY.stack.slice(0, HISTORY.cursor + 1);
  HISTORY.stack.push(entry);
  if (HISTORY.stack.length > 60) HISTORY.stack.shift();
  HISTORY.cursor = HISTORY.stack.length - 1;
}
export function canUndo() { return HISTORY.cursor >= 0; }
export function canRedo() { return HISTORY.cursor < HISTORY.stack.length - 1; }
export async function doUndo() { if (canUndo()) { await HISTORY.stack[HISTORY.cursor].undo(); HISTORY.cursor--; } }
export async function doRedo() { if (canRedo()) { HISTORY.cursor++; await HISTORY.stack[HISTORY.cursor].redo(); } }

// Call this when auth state changes — wipes cache for previous user
export function clearCacheForUser(newUserId) {
  if (CURRENT_USER_ID && CURRENT_USER_ID !== newUserId) {
    // Different user logged in — purge everything
    for (const k of Object.keys(MEM)) delete MEM[k];
    for (const k of Object.keys(DIRTY)) delete DIRTY[k];
  }
  CURRENT_USER_ID = newUserId;
}
