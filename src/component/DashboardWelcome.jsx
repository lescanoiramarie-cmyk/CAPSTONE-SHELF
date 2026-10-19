
import { useEffect, useState } from 'react';
import {
  Wifi,
  WifiOff,
  Sparkles,
  ArrowUpRight,
  CalendarDays,
  Clock3,
  Bell,
  CheckCheck,
} from 'lucide-react';


export default function DashboardWelcome({
  name,
  description,
  actions = [],
  notifications = [],
  onNotificationClick,
  onNotificationFollowUp,
  showNotifications = true,
}) {

  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  const [currentTime, setCurrentTime] = useState(() => new Date());

  const [notificationsOpen, setNotificationsOpen] = useState(false);
const [readNotificationIds, setReadNotificationIds] = useState(
  () => new Set()
);
const [followUpRequestId, setFollowUpRequestId] = useState(null);
const [followUpSentIds, setFollowUpSentIds] = useState(() => new Set());
const [followUpError, setFollowUpError] = useState('');
const [followUpErrorRequestId, setFollowUpErrorRequestId] = useState(null);

const unreadCount = notifications.filter(
  (notification) => !readNotificationIds.has(notification.id)
).length;

const markAllNotificationsRead = () => {
  setReadNotificationIds(
    (previous) =>
      new Set([
        ...previous,
        ...notifications.map((notification) => notification.id),
      ])
  );
};

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

      <div
        role="status"
        aria-live="polite"
        className={`absolute right-20 top-5 z-10 inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-semibold ${
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

      <div className="relative p-5 pt-16 sm:p-7 sm:pt-16 lg:p-8 lg:pt-16">
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
          {/* Notifications and connection status */}
        </div>

<div className="absolute right-5 top-5 z-20">
  {showNotifications && (
    <div className="relative">
      <button
        type="button"
        onClick={() => setNotificationsOpen((open) => !open)}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : 'Notifications'
        }
        aria-expanded={notificationsOpen}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
      >
        <Bell size={20} aria-hidden="true" />

        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {notificationsOpen && (
        <div className="absolute right-0 top-full z-50 mt-3 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-600 dark:bg-slate-800">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-700">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Notifications
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {unreadCount} unread
              </p>
            </div>

            <button
              type="button"
              onClick={markAllNotificationsRead}
              disabled={unreadCount === 0}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#174477] hover:underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-blue-300"
            >
              <CheckCheck size={14} />
              Mark all read
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                You're all caught up. No current alerts.
              </p>
            ) : (
              notifications.map((notification) => {
                const isRead = readNotificationIds.has(notification.id);

                return (
                  <div
                    key={notification.id}
                    className={`border-b border-slate-100 last:border-b-0 dark:border-slate-700 ${
                      isRead
                        ? 'opacity-65'
                        : 'bg-amber-50/60 dark:bg-amber-400/5'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setReadNotificationIds((previous) => {
                          const next = new Set(previous);
                          next.add(notification.id);
                          return next;
                        });
                        setNotificationsOpen(false);
                        onNotificationClick?.(notification);
                      }}
                      className="block w-full px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-700/70"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                            isRead ? 'bg-slate-300' : 'bg-amber-500'
                          }`}
                        />

                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-bold text-slate-800 dark:text-slate-100">
                            {notification.title}
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-slate-600 dark:text-slate-300">
                            {notification.message}
                          </span>
                          <span className="mt-1 block text-[11px] font-medium text-slate-400">
                            {notification.timeLabel}
                          </span>
                        </span>
                      </div>
                    </button>
                    {notification.followUp && onNotificationFollowUp && (
                      <div className="flex items-center justify-between gap-3 px-4 pb-3 pl-9">
                        <p className="min-w-0 text-[11px] text-red-700 dark:text-red-300" role="status">
                          {followUpError && followUpErrorRequestId === notification.requestId
                            ? followUpError
                            : followUpSentIds.has(notification.id)
                              ? 'Follow-up sent today.'
                              : ''}
                        </p>
                        <button
                          type="button"
                          disabled={followUpRequestId === notification.requestId || followUpSentIds.has(notification.id)}
                          onClick={async () => {
                            setFollowUpRequestId(notification.requestId);
                            setFollowUpError('');
                            setFollowUpErrorRequestId(null);
                            try {
                              await onNotificationFollowUp(notification);
                              setFollowUpSentIds((previous) => new Set([...previous, notification.id]));
                            } catch (error) {
                              setFollowUpError(error?.message || 'Unable to send follow-up.');
                              setFollowUpErrorRequestId(notification.requestId);
                            } finally {
                              setFollowUpRequestId(null);
                            }
                          }}
                          className="shrink-0 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                        >
                          {followUpRequestId === notification.requestId
                            ? 'Sending...'
                            : followUpSentIds.has(notification.id)
                              ? 'Sent'
                              : 'Follow up'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  )}

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
                  className="group flex min-h-14.5 w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition duration-200 hover:-translate-y-0.5 hover:border-amber-300 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 dark:border-slate-600 dark:bg-slate-700/60 dark:hover:border-amber-500 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-800"
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
