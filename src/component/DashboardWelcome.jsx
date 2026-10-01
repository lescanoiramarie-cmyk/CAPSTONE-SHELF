import { useEffect, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';

export default function DashboardWelcome({ name, description, actions = [] }) {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  useEffect(() => {
    const updateConnection = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);

    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, []);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">SHELF ILMS</p>
          <h1 className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white sm:text-2xl">
            {greeting}, {name || 'there'}
          </h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-300">{description}</p>}
        </div>
        <span className={`inline-flex w-fit shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${isOnline ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
          {isOnline ? <Wifi size={14} aria-hidden="true" /> : <WifiOff size={14} aria-hidden="true" />}
          {isOnline ? 'Online' : 'Offline'}
        </span>
      </div>
      {actions.length > 0 && (
        <div className="mt-5 flex gap-2 overflow-x-auto pb-1" aria-label="Quick actions">
          {actions.map(({ label, Icon, onClick }) => (
            <button
              key={label}
              type="button"
              onClick={onClick}
              className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-700 transition hover:-translate-y-0.5 hover:border-amber-300 hover:bg-amber-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}