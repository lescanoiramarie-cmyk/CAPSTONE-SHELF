import { supabase } from './supabaseClient.js';

export async function recordAuditEvent({ action, branchId = null, details = {} }) {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { error } = await supabase.rpc('write_audit_log', {
    p_action: action,
    p_branch_id: branchId,
    p_details: details,
  });

  if (error) {
    throw error;
  }
}