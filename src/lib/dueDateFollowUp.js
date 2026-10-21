import { supabase } from './supabaseClient.js';

export async function sendDueDateFollowUp(borrowRequestId) {
  const requestId = String(borrowRequestId || '').trim();
  if (!requestId) {
    throw new Error('A borrow request ID is required.');
  }
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await supabase.functions.invoke(
    'send-due-date-notifications',
    {
      body: {
        operation: 'follow-up',
        borrowRequestId: requestId,
      },
    }
  );

  if (error) {
    let detail;
    try {
      detail = (await error.context?.json?.())?.error || '';
    } catch (parseError) {
      console.warn('Unable to read follow-up error details:', parseError);
    }
    throw new Error(detail || error.message || 'Unable to send follow-up.');
  }

  if (!data?.success) {
    throw new Error(data?.error || 'Unable to send follow-up.');
  }

  return data;
}
