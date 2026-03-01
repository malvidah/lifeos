import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Save or update an entry (upsert by date+type)
export async function saveEntry(date, type, data) {
  const { error } = await supabase
    .from('entries')
    .upsert({ date, type, data, updated_at: new Date().toISOString() }, { onConflict: 'date,type' });
  if (error) throw error;
}

// Load one entry by date + type
export async function loadEntry(date, type) {
  const { data, error } = await supabase
    .from('entries')
    .select('data')
    .eq('date', date)
    .eq('type', type)
    .maybeSingle();
  if (error) throw error;
  return data?.data ?? null;
}

// Load all entries for a date (all types at once)
export async function loadDay(date) {
  const { data, error } = await supabase
    .from('entries')
    .select('type, data')
    .eq('date', date);
  if (error) throw error;
  const result = {};
  for (const row of data || []) result[row.type] = row.data;
  return result;
}

// Load all entries for a date range (for export / backup)
export async function loadRange(startDate, endDate) {
  const { data, error } = await supabase
    .from('entries')
    .select('date, type, data, updated_at')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });
  if (error) throw error;
  return data || [];
}
