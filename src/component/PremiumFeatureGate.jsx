import { useEffect, useState } from 'react';
import { LockKeyhole, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';

export default function PremiumFeatureGate({ libraryId, onUpgrade, children }) {
  const [access, setAccess] = useState('loading');
  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await supabase.rpc('get_library_subscription_dashboard', { p_library_id: libraryId ? String(libraryId) : null });
      if (!active) return;
      const subscription = Array.isArray(data) ? data[0] : null;
      const status = subscription?.effective_status;
      const entitled = !error && subscription?.plan_key === 'premium' && ['trial', 'active', 'expiring', 'past_due'].includes(status);
      setAccess(error ? 'error' : entitled ? 'allowed' : 'locked');
    };
    void load();
    return () => { active = false; };
  }, [libraryId]);
  if (access === 'loading') return <div role="status" className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Checking subscription access…</div>;
  if (access === 'error') return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">Unable to verify your library’s subscription. Reload this page or contact Super Admin.</div>;
  if (access === 'locked') return <section className="rounded-2xl border border-blue-100 bg-white p-6 shadow-sm sm:p-8"><span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><LockKeyhole size={20}/></span><h2 className="mt-4 text-xl font-bold text-slate-900">Advanced analytics requires Premium</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Your library can continue using core inventory and circulation. Open <strong>Plan &amp; Subscription</strong> to review your plan or send an upgrade request to Super Admin.</p><button type="button" onClick={onUpgrade} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-semibold text-white"><Sparkles size={16}/>View subscription</button></section>;
  return children;
}
