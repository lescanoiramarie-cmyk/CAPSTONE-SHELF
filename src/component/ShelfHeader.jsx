import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';
import { getDashboardPath } from '../routes/roleHome.js';
import {
  Moon,
  Sun,
  Bell,
  LogOut,
  Menu,
  X,
  ShieldCheck,
  BookOpen,
  LayoutDashboard,
  Settings,
  UserRound,
  CheckCheck,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import { fetchVisitorNotifications, markVisitorNotificationRead, markAllVisitorNotificationsRead } from '../data/store.js';

/**
 * @typedef {Object} ShelfHeaderProps
 * @property {React.ReactNode} [children] - Additional actions to show in the header center (role-specific breadcrumbs, page title)
 * @property {number} [notificationCount=0] - Custom notification count (for staff/subadmin custom notifications)
 * @property {Array<{id: string|number, message: string, created_at: string, read?: boolean}>} [notificationItems=[]] - Custom notification items (for staff/subadmin)
 * @property {(item: any) => void} [onNotificationClick] - Callback when notification item is clicked
 * @property {React.ReactNode} [profileMenuContent] - Custom profile menu content
 * @property {boolean} [showMobileMenu=false] - Whether to show the mobile menu button
 * @property {() => void} [onMobileMenuToggle] - Callback for mobile menu toggle
 * @property {boolean} [isMobileMenuOpen=false] - Whether mobile menu is open
 * @property {string} [className=''] - Custom className
 * @property {boolean} [showDarkModeToggle=true] - Whether to show dark mode toggle
 */

/**
 * Global SHELF header component.
 * Provides consistent branding, navigation, and user controls across all pages.
 * The logo always routes to the role-aware dashboard.
 * For visitors, notifications are loaded from the database (visitor_notifications table).
 * For staff, custom notification props can be used.
 */
export default function ShelfHeader({
  children,
  notificationCount = 0,
  notificationItems = [],
  onNotificationClick,
  profileMenuContent,
  showMobileMenu = false,
  onMobileMenuToggle,
  isMobileMenuOpen = false,
  className = '',
  showDarkModeToggle = true,
} ) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isDarkAppearance, setIsDarkAppearance] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [visitorNotifications, setVisitorNotifications] = useState([]);
  const [visitorUnreadCount, setVisitorUnreadCount] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState(null);
  const profileMenuRef = useRef(null);
  const notificationsButtonRef = useRef(null);
  const loadTriggerRef = useRef(0);
  const userIdRef = useRef(null);

  // Load dark mode preference
  useEffect(() => {
    const saved = globalThis.localStorage.getItem('shelf_dark_mode');
    if (saved !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsDarkAppearance(saved === 'true');
    } else if (globalThis.matchMedia('(prefers-color-scheme: dark)').matches) {
      setIsDarkAppearance(true);
    }
  }, []);

  // Apply dark mode to document
  useEffect(() => {
    if (isDarkAppearance) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    globalThis.localStorage.setItem('shelf_dark_mode', String(isDarkAppearance));
  }, [isDarkAppearance]);

  // Load visitor notifications from database
  const loadVisitorNotifications = useCallback(async () => {
    // Guard: only load for authenticated visitors
    if (user?.role !== 'visitor' || !user?.id) {
      setVisitorNotifications([]);
      setVisitorUnreadCount(0);
      return;
    }

    // Capture current user ID to detect stale responses after account switch
    const currentUserId = user.id;
    userIdRef.current = currentUserId;

    // Increment trigger to track this load request
    const triggerId = ++loadTriggerRef.current;

    setNotificationsLoading(true);
    setNotificationsError(null);

    try {
      const notifications = await fetchVisitorNotifications({ limit: 20 });

      // Discard stale response if user switched or another load started
      if (triggerId !== loadTriggerRef.current || userIdRef.current !== currentUserId) {
        return;
      }

      setVisitorNotifications(notifications);
      setVisitorUnreadCount(notifications.filter(n => !n.readAt).length);
    } catch (error) {
      // Discard stale error if user switched or another load started
      if (triggerId !== loadTriggerRef.current || userIdRef.current !== currentUserId) {
        return;
      }

      console.error('Failed to load visitor notifications:', error);
      setNotificationsError(error.message || 'Failed to load notifications');
      setVisitorNotifications([]);
      setVisitorUnreadCount(0);
    } finally {
      // Only clear loading if this is still the latest request
      if (triggerId === loadTriggerRef.current) {
        setNotificationsLoading(false);
      }
    }
  }, [user]);

  // Initial load and refresh on focus/visibility change (with debounce)
  useEffect(() => {
    if (user?.role === 'visitor') {
      // Initial load
      const initialTimeoutId = setTimeout(() => {
        loadVisitorNotifications();
      }, 0);

      let focusTimeoutId = null;
      let visibilityTimeoutId = null;

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          // Debounce rapid visibility changes
          clearTimeout(visibilityTimeoutId);
          visibilityTimeoutId = setTimeout(() => {
            loadVisitorNotifications();
          }, 500);
        }
      };

      const handleFocus = () => {
        // Debounce rapid focus events
        clearTimeout(focusTimeoutId);
        focusTimeoutId = setTimeout(() => {
          loadVisitorNotifications();
        }, 500);
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('focus', handleFocus);

      return () => {
        clearTimeout(initialTimeoutId);
        clearTimeout(focusTimeoutId);
        clearTimeout(visibilityTimeoutId);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('focus', handleFocus);
      };
    }
  }, [loadVisitorNotifications, user?.role]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setIsProfileMenuOpen(false);
      }
      if (notificationsButtonRef.current && !notificationsButtonRef.current.contains(event.target)) {
        setIsNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogoClick = () => {
    if (user?.id) {
      navigate(getDashboardPath(user.role));
    } else {
      navigate('/');
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleNotificationClick = async (item) => {
    setIsNotificationsOpen(false);

    // If it's a visitor notification, mark as read
    if (user?.role === 'visitor' && item.id) {
      try {
        await markVisitorNotificationRead(item.id);
        setVisitorNotifications(prev => prev.map(n =>
          n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n
        ));
        setVisitorUnreadCount(prev => Math.max(0, prev - 1));
      } catch (error) {
        console.error('Failed to mark notification as read:', error);
      }
    }

    if (onNotificationClick) {
      onNotificationClick(item);
    }
  };

  const handleMarkAllRead = async () => {
    if (user?.role !== 'visitor') return;

    try {
      await markAllVisitorNotificationsRead();
      setVisitorNotifications(prev => prev.map(n => ({ ...n, readAt: new Date().toISOString() })));
      setVisitorUnreadCount(0);
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
    }
  };

  // Retry handler for error state
  const handleRetry = useCallback(() => {
    loadVisitorNotifications();
  }, [loadVisitorNotifications]);

  // Determine which notification system to use
  const isVisitor = user?.role === 'visitor';
  const displayNotificationCount = isVisitor ? visitorUnreadCount : notificationCount;
  const displayNotificationItems = isVisitor ? visitorNotifications : notificationItems;
  const displayOnNotificationClick = isVisitor ? handleNotificationClick : onNotificationClick;

  return (
    <header
      className={`sticky top-0 z-40 border-b border-slate-200/80 bg-shelf-bg/95 px-4 py-2 backdrop-blur sm:px-6 lg:px-8 ${className}`}
      role="banner"
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        {/* LEFT: LOGO AND HOME LINK */}
        <button
          type="button"
          onClick={handleLogoClick}
          aria-label="Go to SHELF home"
          className="flex min-w-0 items-center gap-2 text-left shrink-0"
        >
          <img src="/shelf-logo.png" alt="" className="h-8 w-8 shrink-0 object-contain" />
          <span className="shrink-0 text-base font-extrabold tracking-wider sm:text-lg text-shelf-primary">
            SHELF
          </span>
        </button>

        {/* CENTER: ROLE-SPECIFIC CONTENT (breadcrumbs, page title, etc.) */}
        <div className="flex-1 min-w-0 flex items-center justify-center sm:justify-start">
          {children}
        </div>

        {/* RIGHT: USER CONTROLS */}
        <div className="flex shrink-0 items-center justify-end gap-2">
          {/* DARK MODE TOGGLE */}
          {showDarkModeToggle && (
            <button
              type="button"
              onClick={() => setIsDarkAppearance((prev) => !prev)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              aria-label={isDarkAppearance ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-pressed={isDarkAppearance}
            >
              {isDarkAppearance ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
            </button>
          )}

          {/* NOTIFICATIONS BELL */}
          {(displayNotificationCount > 0 || displayNotificationItems.length > 0 || isVisitor) && (
            <div className="relative" ref={notificationsButtonRef}>
              <button
                type="button"
                onClick={() => setIsNotificationsOpen((open) => !open)}
                className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                aria-label={isVisitor
                  ? `Notifications${displayNotificationCount > 0 ? `, ${displayNotificationCount} unread` : ''}${notificationsLoading ? ', loading' : ''}${notificationsError ? ', error' : ''}`
                  : `Notifications${displayNotificationCount > 0 ? `, ${displayNotificationCount} unread` : ''}`}
                aria-expanded={isNotificationsOpen}
                aria-busy={notificationsLoading}
              >
                {notificationsLoading && isVisitor ? (
                  <Loader2 size={19} aria-hidden="true" className="animate-spin text-shelf-primary" />
                ) : (
                  <Bell size={19} aria-hidden="true" />
                )}
                {displayNotificationCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">
                    {displayNotificationCount > 99 ? '99+' : displayNotificationCount}
                  </span>
                )}
                {notificationsError && isVisitor && displayNotificationCount === 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-xs font-bold text-white" aria-label="Notification error">
                    !
                  </span>
                )}
              </button>

              {isNotificationsOpen && (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-40"
                    aria-label="Close notifications"
                    onClick={() => setIsNotificationsOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden z-50 dark:border-slate-700 dark:bg-slate-800">
                    <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">Notifications</h3>
                      {isVisitor && visitorUnreadCount > 0 && (
                        <button
                          type="button"
                          onClick={handleMarkAllRead}
                          disabled={notificationsLoading}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#174477] hover:underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-blue-300"
                        >
                          <CheckCheck size={14} />
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {notificationsLoading && isVisitor && displayNotificationItems.length === 0 ? (
                        <div className="px-4 py-6 text-center flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                          Loading notifications...
                        </div>
                      ) : notificationsError && isVisitor && displayNotificationItems.length === 0 ? (
                        <div className="px-4 py-6 text-center flex flex-col items-center gap-2 text-sm">
                          <AlertCircle size={24} className="text-amber-500" aria-hidden="true" />
                          <p className="text-slate-500 dark:text-slate-400">{notificationsError}</p>
                          <button
                            type="button"
                            onClick={handleRetry}
                            className="text-xs font-semibold text-[#174477] hover:underline dark:text-blue-300"
                          >
                            Retry
                          </button>
                        </div>
                      ) : displayNotificationItems.length === 0 ? (
                        <p className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">No notifications</p>
                      ) : (
                        <ul role="list" className="divide-y divide-slate-200 dark:divide-slate-700">
                          {displayNotificationItems.map((n) => (
                            <li
                              key={n.id}
                              className={`px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer ${!n.readAt ? 'bg-slate-50/50 dark:bg-slate-700/30' : ''}`}
                              onClick={() => displayOnNotificationClick(n)}
                              tabIndex={0}
                              role="button"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  displayOnNotificationClick(n);
                                }
                              }}
                            >
                              <p className={`text-sm ${!n.readAt ? 'font-semibold' : ''} text-slate-900 dark:text-white`}>
                                {n.title || n.message}
                              </p>
                              {n.message && n.message !== n.title && (
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{n.message}</p>
                              )}
                              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                {new Date(n.createdAt || n.created_at).toLocaleString()}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* PROFILE MENU */}
          {user?.id && (
            <div className="relative" ref={profileMenuRef}>
              <button
                type="button"
                onClick={() => setIsProfileMenuOpen((open) => !open)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                aria-label="User menu"
                aria-expanded={isProfileMenuOpen}
                aria-haspopup="true"
              >
                <UserRound size={20} aria-hidden="true" />
              </button>

              {isProfileMenuOpen && (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-40"
                    aria-label="Close menu"
                    onClick={() => setIsProfileMenuOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden z-50 dark:border-slate-700 dark:bg-slate-800">
                    <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{user.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 capitalize mt-1">{user.role?.replace('_', ' ')}</p>
                    </div>
                    <ul role="menu" className="list-none m-0 p-0 py-1">
                      {profileMenuContent ? (
                        profileMenuContent
                      ) : (
                        <>
                          {user.role === 'visitor' && (
                            <>
                              <li>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigate(getDashboardPath(user.role));
                                    setIsProfileMenuOpen(false);
                                  }}
                                  role="menuitem"
                                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50"
                                >
                                  <LayoutDashboard size={16} aria-hidden="true" />
                                  Dashboard
                                </button>
                              </li>
                              <li>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigate('/catalog');
                                    setIsProfileMenuOpen(false);
                                  }}
                                  role="menuitem"
                                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50"
                                >
                                  <BookOpen size={16} aria-hidden="true" />
                                  Browse Catalog
                                </button>
                              </li>
                              <li>
                                <hr className="my-1 border-slate-200 dark:border-slate-700" />
                              </li>
                            </>
                          )}
                          {user.role === 'subadmin' && (
                            <>
                              <li>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigate('/subadmin');
                                    setIsProfileMenuOpen(false);
                                  }}
                                  role="menuitem"
                                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50"
                                >
                                  <ShieldCheck size={16} aria-hidden="true" />
                                  Sub-Admin Dashboard
                                </button>
                              </li>
                              <li>
                                <hr className="my-1 border-slate-200 dark:border-slate-700" />
                              </li>
                            </>
                          )}
                          {user.role === 'superadmin' && (
                            <>
                              <li>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigate('/superadmin');
                                    setIsProfileMenuOpen(false);
                                  }}
                                  role="menuitem"
                                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50"
                                >
                                  <Settings size={16} aria-hidden="true" />
                                  Super Admin Dashboard
                                </button>
                              </li>
                              <li>
                                <hr className="my-1 border-slate-200 dark:border-slate-700" />
                              </li>
                            </>
                          )}
                        </>
                      )}
                      <li>
                        <hr className="my-1 border-slate-200 dark:border-slate-700" />
                      </li>
                      <li>
                        <button
                          type="button"
                          onClick={() => {
                            setIsProfileMenuOpen(false);
                            handleLogout();
                          }}
                          role="menuitem"
                          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                        >
                          <LogOut size={16} aria-hidden="true" />
                          Sign out
                        </button>
                      </li>
                    </ul>
                  </div>
                </>
              )}
            </div>
          )}

          {/* MOBILE MENU TOGGLE */}
          {showMobileMenu && onMobileMenuToggle && (
            <button
              type="button"
              onClick={onMobileMenuToggle}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={isMobileMenuOpen}
            >
              {isMobileMenuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

ShelfHeader.propTypes = {
  children: PropTypes.node,
  notificationCount: PropTypes.number,
  notificationItems: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    message: PropTypes.string.isRequired,
    created_at: PropTypes.string.isRequired,
    read: PropTypes.bool,
  })),
  onNotificationClick: PropTypes.func,
  profileMenuContent: PropTypes.node,
  showMobileMenu: PropTypes.bool,
  onMobileMenuToggle: PropTypes.func,
  isMobileMenuOpen: PropTypes.bool,
  className: PropTypes.string,
  showDarkModeToggle: PropTypes.bool,
};

ShelfHeader.defaultProps = {
  notificationCount: 0,
  notificationItems: [],
  showMobileMenu: false,
  isMobileMenuOpen: false,
  className: '',
  showDarkModeToggle: true,
};