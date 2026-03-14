/**
 * Day Lab — Remote MCP Server
 * Implements MCP Protocol 2025-06-18 (Streamable HTTP transport)
 * Auth: Bearer token (dl_... personal token) passed via Authorization header
 *
 * Claude.ai setup: Settings → Connectors → Add custom connector
 *   URL: https://daylab.me/mcp
 *   Advanced: paste your dl_... token as Bearer token
 */

import { createClient } from '@supabase/supabase-js';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'daylab', version: '1.0.0' };

// ── Auth ───────────────────────────────────────────────────────────────────────
const SERVICE = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const getResourceUrl = (req) => `https://${req.headers.get('host') || 'daylab.me'}`;
// `${getResourceUrl(request)}/.well-known/oauth-protected-resource` derived per-request

function unauthorizedResponse(msg = 'Authentication required') {
  return new Response(JSON.stringify({ error: 'unauthorized', message: msg }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      // RFC9728 §5.1 — tell client where to discover auth server
      'WWW-Authenticate': `Bearer realm="${getResourceUrl(request)}", resource_metadata="${`${getResourceUrl(request)}/.well-known/oauth-protected-resource`}"`,
      'MCP-Protocol-Version': PROTOCOL_VERSION,
    }
  });
}

async function resolveUser(request) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const svc = SERVICE();

  // OAuth 2.1 access token (dla_...)
  if (token.startsWith('dla_')) {
    const { data } = await svc.from('entries')
      .select('data, user_id')
      .eq('date', `oauth_token:${token}`)
      .eq('type', 'oauth_token')
      .maybeSingle();
    if (!data) return null;
    if (new Date(data.data.access_expires_at) < new Date()) return null;
    return data.user_id;
  }

  // Legacy personal token (dl_...)
  if (token.startsWith('dl_')) {
    const { data } = await svc.from('entries')
      .select('user_id')
      .eq('type', 'agent_token')
      .eq('date', 'global')
      .eq('data->>token', token)
      .maybeSingle();
    return data?.user_id || null;
  }

  return null;
}

// ── Tool definitions ───────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'get_today',
    description: 'Read all data for a specific date from Day Lab (tasks, meals, notes, activity). Defaults to today if no date given.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date in YYYY-MM-DD format. Omit for today.' }
      }
    }
  },
  {
    name: 'add_task',
    description: 'Add one or more tasks to Day Lab for a specific date.',
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
    description: 'Mark a task as done or undone in Day Lab.',
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
    description: 'Append text to the notes section of Day Lab for a date.',
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
    description: 'Log one or more meals or food items to Day Lab.',
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
    description: 'Add an event to the user\'s Google Calendar via Day Lab.',
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
    const [journalR, tasksR, mealsR] = await Promise.all([
      svc.from('journal_blocks').select('content, position')
        .eq('user_id', userId).eq('date', date).order('position'),
      svc.from('tasks').select('text, done')
        .eq('user_id', userId).eq('date', date).order('position'),
      svc.from('meal_items').select('content')
        .eq('user_id', userId).eq('date', date).order('position'),
    ]);

    return {
      date,
      notes: (journalR.data ?? []).map(r => r.content?.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join('\n') || null,
      tasks: (tasksR.data ?? []).filter(t => t.text?.trim()).map(t => ({ text: t.text, done: t.done })),
      meals: (mealsR.data ?? []).filter(m => m.content?.trim()).map(m => m.content),
    };
  }

  if (name === 'add_task') {
    // Find the next position for this date
    const { count } = await svc.from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('date', date);
    const startPos = count ?? 0;

    const rows = (input.tasks || []).map((text, i) => ({
      user_id: userId, date,
      position: startPos + i,
      text,
      html: `<p>${text.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</p>`,
      done: false,
    }));
    if (rows.length) {
      const { error } = await svc.from('tasks').insert(rows);
      if (error) throw error;
    }
    return { added: rows.length, tasks: rows.map(r => r.text) };
  }

  if (name === 'complete_task') {
    const done = input.done !== false;
    const { data: tasks } = await svc.from('tasks')
      .select('id, text, done')
      .eq('user_id', userId).eq('date', date);

    const match = input.match.toLowerCase();
    const matched = (tasks ?? []).filter(t => t.text?.toLowerCase().includes(match));
    for (const t of matched) {
      await svc.from('tasks').update({
        done,
        completed_at: done ? today : null,
      }).eq('id', t.id);
    }
    return { updated: matched.length, match: input.match, done };
  }

  if (name === 'add_note') {
    // Append as a new journal block
    const { count } = await svc.from('journal_blocks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('date', date);
    const pos = count ?? 0;

    const { error } = await svc.from('journal_blocks').insert({
      user_id: userId, date,
      position: pos,
      content: `<p>${input.text.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</p>`,
    });
    if (error) throw error;
    return { appended: true, date };
  }

  if (name === 'add_meal') {
    const { count } = await svc.from('meal_items')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('date', date);
    const startPos = count ?? 0;

    const rows = (input.meals || []).map((text, i) => ({
      user_id: userId, date,
      position: startPos + i,
      content: text,
    }));
    if (rows.length) {
      const { error } = await svc.from('meal_items').insert(rows);
      if (error) throw error;
    }
    return { added: rows.length, meals: rows.map(r => r.content) };
  }

  if (name === 'add_calendar_event') {
    // Read Google token from user_settings
    const { data: settingsRow } = await svc.from('user_settings')
      .select('data').eq('user_id', userId).maybeSingle();
    let accessToken = settingsRow?.data?.googleToken;
    const refreshTok = settingsRow?.data?.googleRefreshToken;

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

    if (!accessToken) return { error: 'Google Calendar not connected. Please connect via Day Lab settings.' };

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

export async function HEAD() {
  return new Response(null, {
    status: 200,
    headers: { 'MCP-Protocol-Version': PROTOCOL_VERSION }
  });
}

export async function POST(request) {
  let userId = null;
  try { userId = await resolveUser(request); } catch {}

  let body;
  try { body = await request.json(); } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 });
  }

  // If no auth and it's not an initialize/notifications call, return 401 so Claude starts OAuth
  const methods = Array.isArray(body) ? body.map(b => b.method) : [body.method];
  const needsAuth = methods.some(m => m && m !== 'initialize' && m !== 'notifications/initialized');
  if (!userId && needsAuth) return unauthorizedResponse();

  const mcpHeaders = { 'Content-Type': 'application/json', 'MCP-Protocol-Version': PROTOCOL_VERSION };

  if (Array.isArray(body)) {
    const results = await Promise.all(body.map(b => handleRPC(b, userId)));
    return Response.json(results.filter(Boolean), { headers: mcpHeaders });
  }

  const result = await handleRPC(body, userId);
  if (result === null) return new Response(null, { status: 202 });
  return Response.json(result, { headers: mcpHeaders });
}
