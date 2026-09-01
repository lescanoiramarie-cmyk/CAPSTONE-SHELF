import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { SUB_ADMIN_CREDENTIALS } from '../data/store';
import libraryBg from '../assets/library.jpg';

export default function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { loginSubAdmin } = useAuth();
  const navigate = useNavigate();

  const handleSubAdminLogin = (e) => {
    e.preventDefault();
    setError('');
    try {
      loginSubAdmin(email, password);
      navigate('/subadmin');
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
            <h2 className="text-2xl font-bold text-[#0f172a]">Sub-Admin Access</h2>
            <p className="text-xs text-slate-500">Sign in with your staff credentials to manage library inventory.</p>
          </div>

          {error && (
            <div className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}

          <form onSubmit={handleSubAdminLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 uppercase tracking-wider">Staff Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@shelf.edu"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
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
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-[#002046] text-white py-3 rounded-lg font-bold text-sm hover:opacity-95 transition shadow-sm"
            >
              Sign In as Staff
            </button>
          </form>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-[11px] text-slate-500 space-y-1">
            <p className="font-bold text-slate-600">Demo credentials (hardcoded):</p>
            {SUB_ADMIN_CREDENTIALS.map((c) => (
              <p key={c.email} className="font-mono">{c.email} / {c.password}</p>
            ))}
          </div>

          <div className="pt-4 border-t border-slate-200 flex justify-between text-xs font-semibold">
            <a href="/" className="text-slate-500 hover:text-[#002046]">← Visitor Portal</a>
            <a href="/superadmin-login" className="text-[#002046] hover:underline">Super-Admin Access →</a>
          </div>
        </div>
      </div>
    </div>
  );
}
