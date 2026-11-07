import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';
import libraryBg from '../assets/library.jpg';

export default function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [mfaPending, setMfaPending] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const { loginSubAdmin, completeMfaLogin, cancelMfaLogin } = useAuth();
  const navigate = useNavigate();

  const handleSubAdminLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const result = await loginSubAdmin(email, password);
      if (result?.mfaRequired) {
        setMfaPending(result);
        return;
      }
      navigate('/subadmin');
    } catch (err) {
      setError(err.message);
    }
  };

  const verifyMfa = async (event) => {
    event.preventDefault();
    setError(''); setMfaBusy(true);
    try { await completeMfaLogin(mfaCode); navigate('/subadmin'); }
    catch (err) { setError(err?.message || 'The authenticator code was not accepted.'); }
    finally { setMfaBusy(false); }
  };

  return (
    <div className="min-h-screen flex w-full bg-shelf-bg">
      <div
        className="hidden lg:flex lg:w-1/2 bg-shelf-primary text-white p-12 flex-col justify-between relative overflow-hidden bg-cover bg-center"
        style={{ backgroundImage: `linear-gradient(rgba(0, 32, 70, 0.88), rgba(0, 32, 70, 0.88)), url(${libraryBg})` }}
      >
        <div className="relative z-10 flex items-center gap-3">
          <img src="/shelf-logo.png" alt="" className="h-10 w-10 object-contain" />
          <span className="text-xl font-bold tracking-wider">SHELF</span>
        </div>

        <div className="relative z-10 space-y-4 max-w-lg">
          <span className="px-3 py-1 bg-white/10 backdrop-blur-md text-xs font-semibold rounded-full border border-white/20">
            Staff Portal
          </span>
          <h1 className="text-4xl font-extrabold leading-tight">Library Operations & Circulation Desk.</h1>
          <p className="text-sm text-slate-300">
            Manage book borrowing, catalog updates, visitor check-ins, and reservations seamlessly.
          </p>
        </div>

        <div className="relative z-10 text-xs text-slate-400">© SHELF System. All rights reserved.</div>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl border border-slate-200 space-y-6">
          <div className="text-center lg:text-left space-y-1">
            <h2 className="text-2xl font-bold text-shelf-text">Sub-Admin Access</h2>
            <p className="text-xs text-slate-500">Sign in with your staff credentials to manage library inventory.</p>
          </div>

          {error && (
            <div className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}

          {!mfaPending && <form onSubmit={handleSubAdminLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 uppercase tracking-wider">Staff Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@shelf.edu"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 uppercase tracking-wider">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-shelf-primary text-white py-3 rounded-lg font-bold text-sm hover:opacity-95 transition shadow-sm"
            >
              Sign in as staff
            </button>
          </form>}
          {mfaPending && <form onSubmit={verifyMfa} className="space-y-4">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"><p className="font-bold">{mfaPending.mfaSetupRequired ? 'Set up required multi-factor authentication' : 'Enter your authenticator code'}</p><p className="mt-1 text-xs">{mfaPending.mfaSetupRequired ? 'Scan the QR with an authenticator app, then verify a code.' : 'Enter the current six-digit code from your authenticator app.'}</p></div>
            {mfaPending.mfaSetupRequired && mfaPending.mfaQrCode && <div className="mx-auto w-fit rounded-lg border bg-white p-2"><img src={mfaPending.mfaQrCode} alt="Scan this QR code with your authenticator app" className="h-40 w-40" /><p className="mt-1 max-w-48 break-all text-center font-mono text-[10px] text-slate-500">{mfaPending.mfaSecret}</p></div>}
            <input aria-label="Authenticator code" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" className="w-full rounded-lg border border-slate-300 px-4 py-3 text-center font-mono text-lg tracking-[0.4em]" />
            <button disabled={mfaBusy || mfaCode.length !== 6} className="w-full rounded-lg bg-shelf-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{mfaBusy ? 'Verifying…' : 'Verify and continue'}</button>
            <button type="button" disabled={mfaBusy} onClick={async () => { setMfaBusy(true); await cancelMfaLogin(); setMfaPending(null); setMfaCode(''); setMfaBusy(false); }} className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel sign-in</button>
          </form>}

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600">
            Staff access is provisioned through Supabase Auth by a super-admin.
          </div>

          <div className="pt-4 border-t border-slate-200 flex justify-between text-xs font-semibold">
            <a href="/" className="text-slate-500 hover:text-shelf-primary">← Visitor Portal</a>
            <a href="/superadmin-login" className="text-shelf-primary hover:underline">Super-Admin Access →</a>
          </div>
        </div>
      </div>
    </div>
  );
}
