import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export async function saveEntry(date, type, data) {
  const { error } = await supabase
    .from('journal')
    .upsert({ date, type, data, updated_at: new Date().toISOString() }, { onConflict: 'date,type' });
  if (error) throw error;
}

export async function loadEntry(date, type) {
  const { data, error } = await supabase
    .from('journal')
    .select('data')
    .eq('date', date)
    .eq('type', type)
    .maybeSingle();
  if (error) throw error;
  return data?.data ?? null;
}

export async function loadDay(date) {
  const { data, error } = await supabase
    .from('journal')
    .select('type, data')
    .eq('date', date);
  if (error) throw error;
  const result = {};
  for (const row of data || []) result[row.type] = row.data;
  return result;
}
