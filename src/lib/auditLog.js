import { supabase } from './supabaseClient.js';

/*
 * Audit writes must never break the operation they describe.
 *
 * The staff account handlers mutate state and show a success
 * message before recording the event, so a failed audit write
 * used to surface as an unhandled rejection with no feedback
 * and no log entry.
 */
export async function recordAuditEvent({ action, branchId = null, details = {} }) {
  if (!supabase) {
    console.error(
      'Audit event not recorded: Supabase is not configured.',
      { action }
    );

    return { recorded: false };
  }

  try {
    const { error } = await supabase.rpc('write_audit_log', {
      p_action: action,
      p_branch_id: branchId,
      p_details: details,
    });

    if (error) {
      console.error(
        `Audit event not recorded: ${action}`,
        error
      );

      return { recorded: false, error };
    }

    return { recorded: true };
  } catch (error) {
    console.error(
      `Audit event not recorded: ${action}`,
      error
    );

    return { recorded: false, error };
  }
}