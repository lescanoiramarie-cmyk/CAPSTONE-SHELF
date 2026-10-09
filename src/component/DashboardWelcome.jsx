
import { useEffect, useState } from 'react';
import {
  Wifi,
  WifiOff,
  Sparkles,
  ArrowUpRight,
  CalendarDays,
  Clock3,
} from 'lucide-react';

export default function DashboardWelcome({
  name,
  description,
  actions = [],
}) {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  const [currentTime, setCurrentTime] = useState(() => new Date());

  const hour = currentTime.getHours();

  const greeting =
    hour < 12
      ? 'Good morning'
      : hour < 18
        ? 'Good afternoon'
        : 'Good evening';

  useEffect(() => {
    const updateConnection = () => {
      setIsOnline(navigator.onLine);
    };

    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);

    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, []);

  useEffect(() => {
    const updateTime = () => setCurrentTime(new Date());

    updateTime();

    const intervalId = setInterval(updateTime, 1000);

    return () => clearInterval(intervalId);
  }, []);

  const formattedDate = currentTime.toLocaleDateString('en-PH', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const formattedTime = currentTime.toLocaleTimeString('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  return (
    <section
      aria-labelledby="visitor-welcome-title"
      className="relative isolate overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition-colors dark:border-slate-700 dark:bg-slate-800"
    >
      {/* Decorative background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-amber-400/10 blur-3xl"
      />

      <div className="relative p-5 sm:p-7 lg:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          {/* Welcome information */}
          <div className="min-w-0">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">
              <Sparkles size={14} aria-hidden="true" />
              SHELF ILMS
            </div>

            <h1
              id="visitor-welcome-title"
              className="text-2xl font-extrabold leading-tight tracking-tight text-slate-900 dark:text-white sm:text-3xl lg:text-4xl"
            >
              {greeting},{' '}
              <span className="text-[#174477] dark:text-blue-300">
                {name || 'there'}
              </span>
              !
            </h1>

            {/* Live date and time */}
            <div className="mt-4 flex flex-col gap-3 text-sm text-slate-600 dark:text-slate-300 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5">
              <div className="flex items-center gap-2">
                <CalendarDays
                  size={17}
                  className="shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
                <time dateTime={currentTime.toISOString()}>
                  {formattedDate}
                </time>
              </div>

              <div className="flex items-center gap-2">
                <Clock3
                  size={17}
                  className="shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
                <time dateTime={currentTime.toISOString()}>
                  {formattedTime}
                </time>
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
              </div>
            </div>

            {description && (
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300 sm:text-base">
                {description}
              </p>
            )}
          </div>

          {/* Connection status */}
          <div
            role="status"
            aria-live="polite"
            className={`inline-flex w-fit shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-semibold ${
              isOnline
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300'
            }`}
          >
            {isOnline ? (
              <Wifi size={15} aria-hidden="true" />
            ) : (
              <WifiOff size={15} aria-hidden="true" />
            )}

            <span>{isOnline ? 'Online' : 'Offline'}</span>

            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${
                isOnline ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
            />
          </div>
        </div>

        {/* Quick actions */}
        {actions.length > 0 && (
          <div className="mt-7 border-t border-slate-100 pt-5 dark:border-slate-700 sm:mt-8 sm:pt-6">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Quick actions
            </p>

            <div
              className="grid grid-cols-1 gap-3 sm:grid-cols-3"
              aria-label="Quick actions"
            >
              {actions.map(({ label, Icon, onClick }) => (
                <button
                  key={label}
                  type="button"
                  onClick={onClick}
                  className="group flex min-h-[58px] w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition duration-200 hover:-translate-y-0.5 hover:border-amber-300 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 dark:border-slate-600 dark:bg-slate-700/60 dark:hover:border-amber-500 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-800"
                >
                  {Icon && (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#174477] shadow-sm transition-colors group-hover:bg-amber-100 group-hover:text-amber-900 dark:bg-slate-600 dark:text-blue-200 dark:group-hover:bg-amber-400/20 dark:group-hover:text-amber-300">
                      <Icon size={19} aria-hidden="true" />
                    </span>
                  )}

                  <span className="min-w-0 flex-1 text-sm font-bold text-slate-700 dark:text-slate-100">
                    {label}
                  </span>

                  <ArrowUpRight
                    size={16}
                    aria-hidden="true"
                    className="shrink-0 text-slate-400 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-amber-700 dark:group-hover:text-amber-300"
                  />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
