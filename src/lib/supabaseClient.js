import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error(
    'Missing Supabase environment variables. Copy .env.example to .env, fill in ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from your Supabase project ' +
      '(Settings → API), then restart the dev server.'
  );
}

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

/**
 * Automatically cancels borrow requests that have been pending for more than 24 hours.
 */
export const autoCancelExpiredRequests = async () => {
  if (!supabase) return;

  try {
    // Set expiration threshold (24 hours)
    const EXPIRATION_HOURS = 24;
    const cutoffTime = new Date(Date.now() - EXPIRATION_HOURS * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('borrow_requests')
      .update({
        status: 'cancelled',
        cancel_reason: 'Auto-cancelled: Exceeded 24-hour pickup/approval window.',
      })
      .eq('status', 'pending')
      .lt('created_at', cutoffTime)
      .select();

    if (error) {
      console.error('Error auto-cancelling requests:', error.message);
      return;
    }

    if (data && data.length > 0) {
      console.log(`Auto-cancelled ${data.length} expired borrow request(s).`);
    }
  } catch (err) {
    console.error('Unexpected error during auto-cancel:', err);
  }
};