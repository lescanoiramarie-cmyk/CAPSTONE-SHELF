import { supabase } from './supabaseClient.js';

export async function sendFineReminder(borrowRequestId) {
  const id = String(borrowRequestId || '').trim();
  if (!id) throw new Error('A fine record ID is required.');
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.functions.invoke('send-fine-reminder', { body: { borrowRequestId: id } });
  if (error) {
    let detail = '';
    try { detail = (await error.context?.json?.())?.error || ''; } catch { /* use the function client error */ }
    throw new Error(detail || error.message || 'Unable to send fine reminder.');
  }
  if (!data?.success) throw new Error(data?.error || 'Unable to send fine reminder.');
  return data;
}
