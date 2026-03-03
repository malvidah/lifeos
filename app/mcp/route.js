/**
 * Day Loop — Remote MCP Server
 * Implements MCP Protocol 2025-06-18 (Streamable HTTP transport)
 * Auth: Bearer token (dl_... personal token) passed via Authorization header
 *
 * Claude.ai setup: Settings → Connectors → Add custom connector
 *   URL: https://dayloop.me/mcp
 *   Advanced: paste your dl_... token as Bearer token
 */

import { createClient } from '@supabase/supabase-js';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'dayloop', version: '1.0.0' };

// ── Auth ───────────────────────────────────────────────────────────────────────
const SERVICE = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function resolveUser(request) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token.startsWith('dl_')) return null;
  const { data } = await SERVICE()
    .from('entries')
    .select('user_id')
    .eq('type', 'agent_token')
    .eq('date', 'global')
    .eq('data->>token', token)
    .maybeSingle();
  return data?.user_id || null;
}

// ── Tool definitions ───────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'get_today',
    description: 'Read all data for a specific date from Day Loop (tasks, meals, notes, activity). Defaults to today if no date given.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date in YYYY-MM-DD format. Omit for today.' }
      }
    }
  },
  {
    name: 'add_task',
    description: 'Add one or more tasks to Day Loop for a specific date.',
    inputSchema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of task descriptions to add'
        },
        date: { type: 'string', description: 'Date in YYYY-MM-DD format. Omit for today.' }
      },
      required: ['tasks']
    }
  },
  {
    name: 'complete_task',
    description: 'Mark a task as done or undone in Day Loop.',
    inputSchema: {
      type: 'object',
      properties: {
        match: { type: 'string', description: 'Text to match the task (partial, case-insensitive)' },
        done: { type: 'boolean', description: 'true to complete, false to uncomplete. Defaults to true.' },
        date: { type: 'string', description: 'Date in YYYY-MM-DD format. Omit for today.' }
      },
      required: ['match']
    }
  },
  {
    name: 'add_note',
    description: 'Append text to the notes section of Day Loop for a date.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to append to notes' },
        date: { type: 'string', description: 'Date in YYYY-MM-DD format. Omit for today.' }
      },
      required: ['text']
    }
  },
  {
    name: 'add_meal',
    description: 'Log one or more meals or food items to Day Loop.',
    inputSchema: {
      type: 'object',
      properties: {
        meals: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of meal/food descriptions, e.g. ["scrambled eggs 300kcal", "coffee"]'
        },
        date: { type: 'string', description: 'Date in YYYY-MM-DD format. Omit for today.' }
      },
      required: ['meals']
    }
  },
  {
    name: 'add_calendar_event',
    description: 'Add an event to the user\'s Google Calendar via Day Loop.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title' },
        date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
        startTime: { type: 'string', description: 'Start time in HH:MM format (24h), e.g. "14:00"' },
        endTime: { type: 'string', description: 'End time in HH:MM format. Defaults to 1hr after start.' },
        allDay: { type: 'boolean', description: 'Set true for all-day events' }
      },
      required: ['title', 'date']
    }
  }
];

// ── Tool execution ─────────────────────────────────────────────────────────────
async function executeTool(name, input, userId) {
  const svc = SERVICE();
  const today = new Date().toISOString().split('T')[0];
  const date = input.date || today;

  if (name === 'get_today') {
    const { data: rows } = await svc.from('entries')
      .select('type, data').eq('date', date).eq('user_id', userId);
    const result = {};
    for (const r of rows || []) result[r.type] = r.data;

    const tasks = (result.tasks || []).filter(t => t.text?.trim());
    const meals = (result.meals || []).filter(m => m.text?.trim());
    const activity = (result.activity || []).filter(a => a.text?.trim());
    const notes = result.notes || '';

    return {
      date,
      tasks: tasks.map(t => ({ text: t.text, done: t.done })),
      meals: meals.map(m => m.text),
      activity: activity.map(a => a.text),
      notes: notes || null,
    };
  }

  if (name === 'add_task') {
    const { data: existing } = await svc.from('entries').select('data')
      .eq('date', date).eq('type', 'tasks').eq('user_id', userId).maybeSingle();
    const current = Array.isArray(existing?.data) ? existing.data.filter(r => r.text?.trim()) : [];
    const newRows = (input.tasks || []).map(t => ({
      id: Date.now() + Math.random(), text: t, done: false
    }));
    await svc.from('entries').upsert(
      { date, type: 'tasks', data: [...current, ...newRows], user_id: userId, updated_at: new Date().toISOString() },
      { onConflict: 'date,type,user_id' }
    );
    return { added: newRows.length, tasks: newRows.map(r => r.text) };
  }

  if (name === 'complete_task') {
    const { data: existing } = await svc.from('entries').select('data')
      .eq('date', date).eq('type', 'tasks').eq('user_id', userId).maybeSingle();
    const current = Array.isArray(existing?.data) ? existing.data : [];
    const done = input.done !== false;
    const updated = current.map(r =>
      r.text?.toLowerCase().includes(input.match.toLowerCase()) ? { ...r, done } : r
    );
    const matched = updated.filter((r, i) => r.done !== current[i]?.done || (done && r.text?.toLowerCase().includes(input.match.toLowerCase())));
    await svc.from('entries').upsert(
      { date, type: 'tasks', data: updated, user_id: userId, updated_at: new Date().toISOString() },
      { onConflict: 'date,type,user_id' }
    );
    return { updated: matched.length, match: input.match, done };
  }

  if (name === 'add_note') {
    const { data: existing } = await svc.from('entries').select('data')
      .eq('date', date).eq('type', 'notes').eq('user_id', userId).maybeSingle();
    const current = existing?.data || '';
    const updated = current ? current + '\n\n' + input.text : input.text;
    await svc.from('entries').upsert(
      { date, type: 'notes', data: updated, user_id: userId, updated_at: new Date().toISOString() },
      { onConflict: 'date,type,user_id' }
    );
    return { appended: true, date };
  }

  if (name === 'add_meal') {
    const { data: existing } = await svc.from('entries').select('data')
      .eq('date', date).eq('type', 'meals').eq('user_id', userId).maybeSingle();
    const current = Array.isArray(existing?.data) ? existing.data.filter(r => r.text?.trim()) : [];
    const newRows = (input.meals || []).map(t => ({ id: Date.now() + Math.random(), text: t, kcal: null }));
    await svc.from('entries').upsert(
      { date, type: 'meals', data: [...current, ...newRows], user_id: userId, updated_at: new Date().toISOString() },
      { onConflict: 'date,type,user_id' }
    );
    return { added: newRows.length, meals: newRows.map(r => r.text) };
  }

  if (name === 'add_calendar_event') {
    const { data: stored } = await svc.from('entries').select('data')
      .eq('date', '0000-00-00').eq('type', 'google_token').eq('user_id', userId).maybeSingle();
    let accessToken = stored?.data?.token;
    const refreshTok = stored?.data?.refreshToken;

    if (!accessToken && refreshTok) {
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: refreshTok, grant_type: 'refresh_token',
        }),
      });
      const d = await r.json();
      if (d.access_token) accessToken = d.access_token;
    }

    if (!accessToken) return { error: 'Google Calendar not connected. Please connect via Day Loop settings.' };

    const evDate = input.date || today;
    let eventBody;
    if (input.allDay || !input.startTime) {
      const next = new Date(evDate + 'T12:00:00');
      next.setDate(next.getDate() + 1);
      eventBody = { summary: input.title, start: { date: evDate }, end: { date: next.toISOString().split('T')[0] } };
    } else {
      const endT = input.endTime || (() => {
        const [h, m] = input.startTime.split(':').map(Number);
        return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      })();
      eventBody = {
        summary: input.title,
        start: { dateTime: `${evDate}T${input.startTime}:00`, timeZone: 'America/Los_Angeles' },
        end: { dateTime: `${evDate}T${endT}:00`, timeZone: 'America/Los_Angeles' },
      };
    }

    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(eventBody),
    });
    const d = await res.json();
    return res.ok
      ? { created: true, title: input.title, date: evDate, eventId: d.id }
      : { error: d.error?.message || 'Calendar API error' };
  }

  return { error: `Unknown tool: ${name}` };
}

// ── MCP JSON-RPC handler ───────────────────────────────────────────────────────
async function handleRPC(body, userId) {
  const { jsonrpc, id, method, params } = body;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: SERVER_INFO,
        capabilities: { tools: {} },
      }
    };
  }

  if (method === 'notifications/initialized') {
    return null; // no response needed
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0', id,
      result: { tools: TOOLS }
    };
  }

  if (method === 'tools/call') {
    if (!userId) {
      return { jsonrpc: '2.0', id, error: { code: -32001, message: 'Unauthorized — invalid or missing token' } };
    }
    try {
      const result = await executeTool(params.name, params.arguments || {}, userId);
      return {
        jsonrpc: '2.0', id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !!result.error,
        }
      };
    } catch (e) {
      return { jsonrpc: '2.0', id, error: { code: -32000, message: e.message } };
    }
  }

  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

// ── Route handlers ─────────────────────────────────────────────────────────────
export async function HEAD() {
  return new Response(null, {
    status: 200,
    headers: { 'MCP-Protocol-Version': PROTOCOL_VERSION }
  });
}

export async function POST(request) {
  // Auth — initialize is allowed without token, tool calls require it
  let userId = null;
  try { userId = await resolveUser(request); } catch {}

  let body;
  try { body = await request.json(); } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 });
  }

  // Handle batch requests
  if (Array.isArray(body)) {
    const results = await Promise.all(body.map(b => handleRPC(b, userId)));
    return Response.json(results.filter(Boolean), {
      headers: { 'Content-Type': 'application/json', 'MCP-Protocol-Version': PROTOCOL_VERSION }
    });
  }

  const result = await handleRPC(body, userId);
  if (result === null) return new Response(null, { status: 202 });

  return Response.json(result, {
    headers: { 'Content-Type': 'application/json', 'MCP-Protocol-Version': PROTOCOL_VERSION }
  });
}
