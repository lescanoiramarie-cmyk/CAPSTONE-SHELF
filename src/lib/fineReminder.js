import { supabase } from './supabaseClient.js';

export async function sendFineReminder(borrowRequestId) {
  const id = String(borrowRequestId || '').trim();
  if (!id) throw new Error('A fine record ID is required.');
  if (!supabase) throw new Error('Supabase is not configured.');

  // Invoke RPC to record fine reminder in database, enforce once-per-day restriction, and create visitor in-app notification
  const { data: rpcData, error: rpcError } = await supabase.rpc('alert_visitor_fine_payment', {
    p_borrow_request_id: id,
  });

  if (rpcError) {
    if (/already.*today/i.test(rpcError.message)) {
      throw new Error('A fine reminder has already been sent for this loan today.');
    }
    // Attempt edge function if RPC failed for another reason
    const { data, error } = await supabase.functions.invoke('send-fine-reminder', { body: { borrowRequestId: id } });
    if (error) {
      let detail = '';
      try { detail = (await error.context?.json?.())?.error || ''; } catch { /* use the function client error */ }
      throw new Error(detail || error.message || rpcError.message || 'Unable to send fine reminder.');
    }
    if (!data?.success) throw new Error(data?.error || 'Unable to send fine reminder.');
    return data;
  }

  // Also trigger edge function in background for external email delivery if configured
  try {
    supabase.functions.invoke('send-fine-reminder', { body: { borrowRequestId: id } }).catch(() => {});
  } catch {
    // Non-blocking
  }

  return rpcData;
}
