import { useEffect, useState, useCallback } from 'react';
import { LockKeyhole, Sparkles, AlertCircle, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';

export default function PremiumFeatureGate({ libraryId, onUpgrade, children }) {
  const [access, setAccess] = useState('loading');
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_library_subscription_dashboard', {
        p_library_id: libraryId ? String(libraryId) : null,
      });
      if (error) {
        setAccess('error');
        return;
      }
      const subscription = Array.isArray(data) ? data[0] : null;
      const status = subscription?.effective_status;
      const entitled =
        subscription?.plan_key === 'premium' &&
        ['trial', 'active', 'expiring', 'past_due'].includes(status);
      setAccess(entitled ? 'allowed' : 'locked');
    } catch {
      setAccess('error');
    } finally {
      setRetrying(false);
    }
  }, [libraryId]);

  useEffect(() => {
    let active = true;
    const initialLoad = async () => {
      if (active) await load();
    };
    void initialLoad();
    return () => {
      active = false;
    };
  }, [load]);

  const handleRetry = () => {
    setRetrying(true);
    setAccess('loading');
    void load();
  };

  if (access === 'loading' || retrying) {
    return (
      <div className="flex min-h-64 items-center justify-center p-6">
        <div
          role="status"
          className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <RefreshCw size={24} className="animate-spin text-shelf-primary dark:text-blue-400" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Checking library subscription access…
          </p>
        </div>
      </div>
    );
  }

  if (access === 'error') {
    return (
      <div className="flex min-h-72 items-center justify-center p-6">
        <div
          role="alert"
          className="flex max-w-md flex-col items-center rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
            <AlertCircle size={24} aria-hidden="true" />
          </span>
          <h3 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
            Subscription verification unavailable
          </h3>
          <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
            We were unable to verify your library’s active plan status. Please retry or verify that your staff account is assigned to an active library branch.
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-shelf-primary px-4 py-2 text-xs font-bold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary"
          >
            <RefreshCw size={14} aria-hidden="true" />
            Retry verification
          </button>
        </div>
      </div>
    );
  }

  if (access === 'locked') {
    return (
      <div className="flex min-h-72 items-center justify-center p-6">
        <section className="flex max-w-lg flex-col items-center rounded-2xl border border-blue-100 bg-white p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-10">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 dark:bg-slate-700 dark:text-blue-300">
            <LockKeyhole size={24} aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">
            Advanced Analytics Requires Premium
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Your library can continue using core inventory and circulation. Open{' '}
            <strong className="text-slate-800 dark:text-slate-200">Plan &amp; Subscription</strong>{' '}
            to review your current plan or submit an upgrade request to Super Admin.
          </p>
          <button
            type="button"
            onClick={onUpgrade}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-shelf-primary px-5 py-2.5 text-sm font-bold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary"
          >
            <Sparkles size={16} aria-hidden="true" />
            View subscription
          </button>
        </section>
      </div>
    );
  }

  return children;
}
