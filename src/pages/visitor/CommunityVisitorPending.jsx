import { Link } from 'react-router-dom';
import { useAuth } from '../../context/useAuth.js';
import { supabase } from '../../lib/supabaseClient.js';
import { useEffect, useState } from 'react';

export default function CommunityVisitorPending() {
  const { logout } = useAuth();
  const [pendingInfo, setPendingInfo] = useState(null);
  const [status, setStatus] = useState('loading');
  const [hasAuthenticatedUser, setHasAuthenticatedUser] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadApprovalStatus = async () => {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        if (!session?.user?.id) {
          if (!cancelled) setStatus('information');
          return;
        }

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user?.id) {
          if (!cancelled) setStatus('information');
          return;
        }

        const { data, error: queryError } = await supabase.rpc(
          'get_my_visitor_approval_status'
        );
        if (queryError) throw queryError;
        if (cancelled) return;

        const approvalStatus = Array.isArray(data) ? data[0] : null;
        setHasAuthenticatedUser(true);
        if (
          ['institutional', 'community'].includes(approvalStatus?.registration_type) &&
          approvalStatus.approval_status === 'pending' &&
          approvalStatus.otp_verified === true &&
          approvalStatus.is_active === false
        ) {
          setPendingInfo(approvalStatus);
          setStatus('pending');
          return;
        }

        if (
          ['institutional', 'community'].includes(approvalStatus?.registration_type) &&
          approvalStatus.approval_status === 'approved' &&
          approvalStatus.otp_verified === true &&
          approvalStatus.is_active === true
        ) {
          setPendingInfo(approvalStatus);
          setStatus('approved');
          return;
        }

        setStatus('unavailable');
      } catch (loadError) {
        console.error('Visitor approval status loading failed:', loadError);
        if (!cancelled) setStatus('error');
      }
    };

    void loadApprovalStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'loading') {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl items-center px-4 py-12">
        <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-sm text-slate-600">Loading approval status...</p>
        </section>
      </main>
    );
  }

  if (status === 'error' || status === 'unavailable') {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl items-center px-4 py-12">
        <section className="w-full rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm sm:p-8">
          <p className="text-xs font-bold uppercase tracking-wider text-red-700">Visitor registration</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">
            {status === 'error' ? 'Unable to load status' : 'Approval status unavailable'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {status === 'error'
              ? 'Unable to check your approval status. Please try again later.'
              : 'We could not confirm a verified visitor account awaiting approval for this sign-in.'}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/visitor-login" className="rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-bold text-white">Return to sign in</Link>
            {hasAuthenticatedUser && (
              <button type="button" onClick={() => void logout()} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Sign out</button>
            )}
          </div>
        </section>
      </main>
    );
  }

  const isPending = status === 'pending';
  const isApproved = status === 'approved';

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center px-4 py-12">
      <section className="w-full rounded-2xl border border-blue-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-bold uppercase tracking-wider text-blue-700">
          {pendingInfo?.registration_type === 'community'
            ? 'Public / Community visitor'
            : pendingInfo?.registration_type === 'institutional'
              ? 'Institutional visitor'
              : 'Visitor registration'}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">
          {isApproved
            ? 'Library approval complete'
            : isPending
              ? 'Library approval pending'
              : 'Librarian approval required'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Both Institutional and Public / Community Visitor accounts must verify their email and receive approval from an authorized librarian at the selected library before borrowing, reviews, attendance identification, or an active visitor QR pass are enabled.
        </p>
        {isPending && (
          <p className="mt-3 text-sm text-slate-600">
            Your email is verified. Your selected library must approve your account before visitor services are enabled. No active QR pass is available while approval is pending.
          </p>
        )}
        {status === 'information' && (
          <p className="mt-3 text-sm text-slate-600">
            If you have completed email verification, wait for your selected library to review your account. Restricted visitor services remain unavailable until approval.
          </p>
        )}
        {isApproved && (
          <p className="mt-3 text-sm text-slate-600">
            Your account is approved. Sign in to access the visitor services available to your account.
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/visitor-login" className="rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-bold text-white">Go to visitor sign in</Link>
          {hasAuthenticatedUser && (
            <button type="button" onClick={() => void logout()} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Sign out</button>
          )}
        </div>
      </section>
    </main>
  );
}