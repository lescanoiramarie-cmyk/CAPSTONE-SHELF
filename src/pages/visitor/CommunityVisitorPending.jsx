import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/useAuth.js';
import { supabase } from '../../lib/supabaseClient.js';
import { useEffect, useState } from 'react';

export default function CommunityVisitorPending() {
  const { logout } = useAuth();
  const [searchParams] = useSearchParams();
  const [pendingInfo, setPendingInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // visitor_id can be passed via query param or stored in sessionStorage after OTP verification
  const visitorId = searchParams.get('visitor_id') || sessionStorage.getItem('pending_visitor_id');

  useEffect(() => {
    if (!visitorId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      setError('No pending visitor session found. Please verify your email again.');
      return;
    }

    // Fetch pending visitor status using a direct query (RLS allows pending community visitors to read their own row)
    supabase
      .from('visitors')
      .select('id, full_name, email, registration_type, approval_status, otp_verified, is_active, qr_code, library_id')
      .eq('id', visitorId)
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        if (queryError) {
          setError('Unable to load pending approval status.');
          setLoading(false);
          return;
        }
        if (!data) {
          setError('Pending visitor record not found.');
          setLoading(false);
          return;
        }
        if (data.registration_type !== 'community' || data.approval_status !== 'pending') {
          // Already approved or not a community visitor - redirect to login
          sessionStorage.removeItem('pending_visitor_id');
          setError('This account is no longer pending approval. Please sign in.');
          setLoading(false);
          return;
        }
        setPendingInfo(data);
        setLoading(false);
      })
      .catch(() => {
        setError('Unable to load pending approval status.');
        setLoading(false);
      });
  }, [visitorId]);

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl items-center px-4 py-12">
        <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-sm text-slate-600">Loading approval status...</p>
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl items-center px-4 py-12">
        <section className="w-full rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm sm:p-8">
          <p className="text-xs font-bold uppercase tracking-wider text-red-700">Error</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Unable to load status</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{error}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/visitor-login" className="rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-bold text-white">Sign in</Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center px-4 py-12">
      <section className="w-full rounded-2xl border border-blue-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Community visitor</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Library approval pending</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Your email is verified. The library you selected must approve your account before borrowing, reviews, attendance identification, and a visitor QR pass are enabled.
        </p>
        <p className="mt-3 text-sm text-slate-600">
          Signed in as <strong>{pendingInfo?.email || 'community visitor'}</strong>. You have limited access while approval is pending.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/catalog" className="rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-bold text-white">Browse public catalog</Link>
          <button type="button" onClick={() => void logout()} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Sign out</button>
        </div>
      </section>
    </main>
  );
}