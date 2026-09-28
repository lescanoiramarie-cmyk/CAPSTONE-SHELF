import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const allowedOrigin = Deno.env.get('APP_ORIGIN') || 'http://localhost:5173';

const headers = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return respond(405, { error: 'Method not allowed.' });
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return respond(500, { error: 'Staff provisioning is not configured on the server.' });
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization) return respond(401, { error: 'Sign in with an authorized super-admin account.' });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user || authData.user.app_metadata?.role !== 'superadmin') {
    return respond(403, { error: 'Only an authenticated super-admin can manage staff accounts.' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const body = await request.json();
    if (body.operation === 'create') {
      const email = String(body.email || '').trim().toLowerCase();
      const fullName = String(body.fullName || '').trim();
      const password = String(body.password || '');
      const libraryId = String(body.libraryId || '');
      if (!email || !fullName || password.length < 10 || !libraryId) {
        return respond(400, { error: 'Name, email, a 10-character password, and branch are required.' });
      }

      const { data: library, error: libraryError } = await admin
        .from('libraries')
        .select('id')
        .eq('id', libraryId)
        .maybeSingle();
      if (libraryError || !library) return respond(400, { error: 'Select a valid library branch.' });

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { role: 'subadmin', library_id: libraryId, is_active: true },
        user_metadata: { full_name: fullName },
      });
      if (createError || !created.user) return respond(400, { error: createError?.message || 'Unable to create staff account.' });

      const { error: profileError } = await admin.from('staff_profiles').insert({
        id: created.user.id,
        email,
        full_name: fullName,
        role: 'subadmin',
        library_id: libraryId,
      });
      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id);
        return respond(400, { error: profileError.message });
      }

      return respond(200, { id: created.user.id, email, role: 'subadmin', libraryId });
    }

    if (body.operation === 'set-active') {
      const userId = String(body.userId || '');
      const isActive = body.isActive === true;
      if (!userId) return respond(400, { error: 'A staff account ID is required.' });

      const { data: profile, error: profileError } = await admin
        .from('staff_profiles')
        .select('id, role, library_id')
        .eq('id', userId)
        .maybeSingle();
      if (profileError || !profile || profile.role !== 'subadmin') {
        return respond(404, { error: 'Sub-admin account not found.' });
      }

      const { error: authUpdateError } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: isActive ? 'none' : '876000h',
        app_metadata: { role: 'subadmin', library_id: profile.library_id, is_active: isActive },
      });
      if (authUpdateError) return respond(400, { error: authUpdateError.message });

      const { error: updateError } = await admin
        .from('staff_profiles')
        .update({ is_active: isActive })
        .eq('id', userId);
      if (updateError) return respond(400, { error: updateError.message });

      return respond(200, { id: userId, isActive });
    }

    return respond(400, { error: 'Unsupported staff management operation.' });
  } catch (error) {
    return respond(500, { error: error instanceof Error ? error.message : 'Unexpected staff management error.' });
  }
});