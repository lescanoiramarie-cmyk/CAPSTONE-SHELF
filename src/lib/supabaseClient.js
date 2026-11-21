import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Known production project identifier (from .env/.env.local commits)
const PRODUCTION_PROJECT_REF = 'khwtfjyvawukbsvyjdux';

// Known local project identifier (from supabase/config.toml)
const LOCAL_PROJECT_REF = 'shelf-ilms-local';

function validateSupabaseConfig() {
  if (!supabaseUrl || !supabaseAnonKey) {
    const message =
      'Missing Supabase environment variables. Copy .env.example to .env, fill in ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from your Supabase project ' +
      '(Settings → API), then restart the dev server.';
    console.error(message);
    if (import.meta.env.DEV) {
      throw new Error(message);
    }
    return false;
  }

  // Safety guard: detect accidental production connection during local development
  if (import.meta.env.DEV && supabaseUrl.includes(PRODUCTION_PROJECT_REF)) {
    const warning = `⚠️ SECURITY WARNING: Local development is connected to PRODUCTION Supabase project (${PRODUCTION_PROJECT_REF}).

This is a critical security risk:
- Local development changes could affect production data
- Production credentials are exposed in local environment
- Accidental data modification or deletion could occur

Required action:
1. Create a local Supabase project (supabase init / supabase start)
2. Update .env with local project credentials (VITE_SUPABASE_URL pointing to local)
3. Ensure .env is in .gitignore (already configured)
4. Never commit production credentials to version control

See .env.example for configuration guidance.`;

    console.error(warning);
    // In development, we throw to prevent accidental production usage
    throw new Error(warning);
  }

  return true;
}

const configValid = validateSupabaseConfig();

export const supabase =
  configValid && supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        global: {
          headers: {
            apikey: supabaseAnonKey,
          },
        },
        auth: {
          experimental: { passkey: true },
        },
      })
    : null;

export { PRODUCTION_PROJECT_REF, LOCAL_PROJECT_REF };
