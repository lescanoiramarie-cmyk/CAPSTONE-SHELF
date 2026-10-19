
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const MAX_ATTEMPTS = 5;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

function normalizeEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  try {
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        { error: 'Login service is not configured.' },
        500,
      );
    }

    const body = await request.json();
    const email = normalizeEmail(body?.email);
    const password = String(body?.password ?? '');

    if (!email || !password) {
      return jsonResponse(
        { error: 'Email and password are required.' },
        400,
      );
    }

    // The public anon key is supplied by the Supabase client.
    const anonKey = request.headers.get('apikey');

    if (!anonKey) {
      return jsonResponse(
        { error: 'Login request is missing its API key.' },
        401,
      );
    }

    // Use the public client only for password authentication.
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Keep privileged lockout operations server-side.
    const adminClient = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    const { data: lockoutData, error: lockoutError } =
      await adminClient.rpc('check_login_lockout', {
        p_email: email,
      });

    if (lockoutError) {
      console.error('Login lockout check failed:', lockoutError);
      return jsonResponse(
        { error: 'Unable to verify login status. Try again later.' },
        500,
      );
    }

    const lockout = Array.isArray(lockoutData)
      ? lockoutData[0]
      : lockoutData;

    if (lockout?.is_locked === true) {
      const retryAfterSeconds = Number(
        lockout.retry_after_seconds ?? 0,
      );

      return jsonResponse(
        {
          error:
            `Too many failed login attempts. Try again in ` +
            `${Math.max(1, Math.ceil(retryAfterSeconds / 60))} minute(s).`,
          locked: true,
          retryAfterSeconds,
        },
        429,
      );
    }

    const { data: authData, error: authError } =
      await authClient.auth.signInWithPassword({
        email,
        password,
      });

    if (authError || !authData.session || !authData.user) {
      const { data: failureData, error: failureError } =
        await adminClient.rpc('record_login_failure', {
          p_email: email,
        });

      if (failureError) {
        console.error('Failed to record login failure:', failureError);
        return jsonResponse(
          { error: 'Unable to process login. Please try again.' },
          500,
        );
      }

      const failure = Array.isArray(failureData)
        ? failureData[0]
        : failureData;

      if (failure?.is_locked === true) {
        return jsonResponse(
          {
            error:
              'Too many failed login attempts. Your account is locked for 15 minutes.',
            locked: true,
            retryAfterSeconds: 900,
            attempts: Number(failure.attempts ?? MAX_ATTEMPTS),
          },
          429,
        );
      }

      const attempts = Number(failure?.attempts ?? 1);

      return jsonResponse(
        {
          error: 'Invalid email or password.',
          attempts,
          remainingAttempts: Math.max(0, MAX_ATTEMPTS - attempts),
        },
        401,
      );
    }

    const { error: clearError } = await adminClient.rpc(
      'clear_login_failures',
      { p_email: email },
    );

    if (clearError) {
      console.error('Failed to clear login failures:', clearError);
      await authClient.auth.signOut();
      return jsonResponse(
        { error: 'Unable to complete login. Please try again.' },
        500,
      );
    }

    return jsonResponse({
      success: true,
      session: authData.session,
      user: authData.user,
    });
  } catch (error) {
    console.error('Login with lockout failed:', error);
    return jsonResponse(
      { error: 'Unable to complete login. Please try again.' },
      500,
    );
  }
});
