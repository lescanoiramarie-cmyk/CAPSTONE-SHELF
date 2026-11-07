import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/useAuth.js';
import libraryBg from '../../assets/library.jpg';

export default function SuperAdminLogin() {
  const [email, setEmail] = useState('');
  const [passkey, setPasskey] = useState('');
  const [error, setError] = useState('');
  const [mfaPending, setMfaPending] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const { loginSuperAdmin, completeMfaLogin, cancelMfaLogin } = useAuth();
  const navigate = useNavigate();

  const handleSuperAdminLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const result = await loginSuperAdmin(email, passkey);
      if (result?.mfaRequired) {
        setMfaPending(result);
        return;
      }
      navigate('/superadmin');
    } catch (err) {
      setError(err.message);
    }
  };

  const verifyMfa = async (event) => {
    event.preventDefault();
    setError(''); setMfaBusy(true);
    try { await completeMfaLogin(mfaCode); navigate('/superadmin'); }
    catch (err) { setError(err?.message || 'The authenticator code was not accepted.'); }
    finally { setMfaBusy(false); }
  };

  return (
    <div className="auth-shell min-h-screen flex w-full bg-shelf-bg">
      <div
        className="auth-visual-panel hidden lg:flex lg:w-1/2 bg-shelf-primary text-white p-12 flex-col justify-between relative overflow-hidden bg-cover bg-center"
        style={{ backgroundImage: `linear-gradient(rgba(0, 32, 70, 0.88), rgba(0, 32, 70, 0.88)), url(${libraryBg})` }}
      >
        <div className="relative z-10 flex items-center gap-3">
          <img src="/shelf-logo.png" alt="" className="h-10 w-10 object-contain" />
          <span className="text-xl font-bold tracking-wider">SHELF</span>
        </div>

        <div className="relative z-10 space-y-4 max-w-lg">
          <span className="px-3 py-1 bg-amber-400 text-shelf-primary text-xs font-extrabold rounded-full uppercase tracking-wider">
            System Control
          </span>
          <h1 className="text-4xl font-extrabold leading-tight">Central Management & Analytics.</h1>
          <p className="text-sm text-slate-300">
            System configuration, user roles, security access controls, and multi-school library metrics.
          </p>
        </div>

        <div className="relative z-10 text-xs text-slate-400">© SHELF System. All rights reserved.</div>
      </div>

      <div className="auth-form-panel w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12 overflow-y-auto">
        <div className="auth-form-card w-full max-w-md bg-white p-8 rounded-2xl shadow-xl border-2 border-shelf-primary space-y-6 my-auto">
          <div className="text-center lg:text-left space-y-1">
            <h2 className="text-2xl font-bold text-shelf-text">Super-Admin Console</h2>
            <p className="text-xs text-slate-500">Provide root security credentials to authenticate.</p>
          </div>

          {error && (
            <div className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}

          {!mfaPending && <form onSubmit={handleSuperAdminLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 uppercase tracking-wider">Root Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="superadmin@shelf.edu"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 uppercase tracking-wider">System Key</label>
              <input
                type="password"
                required
                value={passkey}
                onChange={(e) => setPasskey(e.target.value)}
                placeholder="Enter system access credentials"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-shelf-primary text-white py-3 rounded-lg font-bold text-sm hover:bg-black transition shadow-sm"
            >
              Authorize system entry
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
            Super-admin access requires a provisioned Supabase Auth account.
          </div>

          <div className="pt-4 border-t border-slate-200 text-center">
            <a href="/admin-login" className="text-xs font-semibold text-slate-500 hover:text-shelf-primary">
              ← Return to Sub-Admin Login
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
