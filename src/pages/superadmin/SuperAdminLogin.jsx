import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { SUPER_ADMIN_CREDENTIALS } from '../../data/store';
import libraryBg from '../../assets/library.jpg';

export default function SuperAdminLogin() {
  const [email, setEmail] = useState('');
  const [passkey, setPasskey] = useState('');
  const [error, setError] = useState('');
  const { loginSuperAdmin } = useAuth();
  const navigate = useNavigate();

  const handleSuperAdminLogin = (e) => {
    e.preventDefault();
    setError('');
    try {
      loginSuperAdmin(email, passkey);
      navigate('/superadmin');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen flex w-full bg-[#f8fafc]">
      <div
        className="hidden lg:flex lg:w-1/2 bg-[#002046] text-white p-12 flex-col justify-between relative overflow-hidden bg-cover bg-center"
        style={{ backgroundImage: `linear-gradient(rgba(0, 32, 70, 0.88), rgba(0, 32, 70, 0.88)), url(${libraryBg})` }}
      >
        <div className="relative z-10 flex items-center gap-3">
          <span className="text-xl font-bold tracking-wider">SHELF ILMS</span>
        </div>

        <div className="relative z-10 space-y-4 max-w-lg">
          <span className="px-3 py-1 bg-amber-400 text-[#002046] text-xs font-extrabold rounded-full uppercase tracking-wider">
            System Control
          </span>
          <h1 className="text-4xl font-extrabold leading-tight">Central Management & Analytics.</h1>
          <p className="text-sm text-slate-300">
            System configuration, user roles, security access controls, and multi-school library metrics.
          </p>
        </div>

        <div className="relative z-10 text-xs text-slate-400">© SHELF System. All rights reserved.</div>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl border-2 border-[#002046] space-y-6">
          <div className="text-center lg:text-left space-y-1">
            <h2 className="text-2xl font-bold text-[#0f172a]">Super-Admin Console</h2>
            <p className="text-xs text-slate-500">Provide root security credentials to authenticate.</p>
          </div>

          {error && (
            <div className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}

          <form onSubmit={handleSuperAdminLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 uppercase tracking-wider">Root Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="superadmin@shelf.edu"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
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
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-[#002046] text-white py-3 rounded-lg font-bold text-sm hover:bg-black transition shadow-sm"
            >
              Authorize System Entry
            </button>
          </form>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-[11px] text-slate-500 space-y-1">
            <p className="font-bold text-slate-600">Demo credentials (hardcoded):</p>
            {SUPER_ADMIN_CREDENTIALS.map((c) => (
              <p key={c.email} className="font-mono">{c.email} / {c.password}</p>
            ))}
          </div>

          <div className="pt-4 border-t border-slate-200 text-center">
            <a href="/admin-login" className="text-xs font-semibold text-slate-500 hover:text-[#002046]">
              ← Return to Sub-Admin Login
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
