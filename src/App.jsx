import { lazy, Suspense, useRef, useState } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from 'react-router-dom';
import { BadgeCheck, ShieldCheck } from 'lucide-react';

import { AuthProvider } from './context/AuthContext.jsx';
import { LibraryProvider } from './context/LibraryContext.jsx';
import { useAuth } from './context/useAuth.js';
import ProtectedRoute from './routes/ProtectedRoute.jsx';
import ShelfLoader from './component/ShelfLoader.jsx';

const LandingPage = lazy(() => import('./pages/visitor/LandingPage.jsx'));
const VisitorLogin = lazy(() => import('./pages/visitor/VisitorLogin.jsx'));
const OPACCatalog = lazy(() => import('./component/OPACCatalog.jsx'));
const VisitorDashboard = lazy(
  () => import('./pages/visitor/VisitorDashboard.jsx')
);
const SubAdminDashboard = lazy(
  () => import('./pages/subadmin/SubAdminDashboard.jsx')
);
const AttendanceKiosk = lazy(
  () => import('./pages/subadmin/AttendanceKiosk.jsx')
);
const SuperAdminDashboard = lazy(
  () => import('./pages/superadmin/SuperAdminDashboard.jsx')
);

function RouteLoadingFallback() {
  return (
    <main>
      <ShelfLoader screen label="Loading SHELF..." />
    </main>
  );
}

function getMajorActionConfirmation(button) {
  if (
    !button ||
    button.disabled ||
    button.closest('[data-confirmation-dialog]')
  ) {
    return '';
  }

  const label = (
    button.getAttribute('aria-label') ||
    button.textContent ||
    button.title ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim();
  const normalizedLabel = label.toLowerCase();
  const path = window.location.pathname;
  const isAdminModule = path.startsWith('/subadmin') || path === '/superadmin';

  const customMessage = button.getAttribute('data-confirm-message');
  if (customMessage) return customMessage;
  if (button.hasAttribute('data-confirm-borrow')) {
    return 'Are you sure you want to submit this borrow request?';
  }
  if (button.hasAttribute('data-confirm-return')) {
    return 'Are you sure you want to confirm this book return?';
  }
  if (button.hasAttribute('data-confirm-borrowing')) {
    return 'Are you sure you want to confirm this book borrowing?';
  }

  if (
    !normalizedLabel ||
    /\b(qr|image|download|upload|scan|close|cancel)\b/.test(
      normalizedLabel
    )
  ) {
    return '';
  }

  if (/\b(log out|logout|sign out)\b/.test(normalizedLabel)) {
    return 'Are you sure you want to sign out?';
  }

  if (/\b(return|returning)\b/.test(normalizedLabel) && /\b(confirm|complete|mark|process|return)\b/.test(normalizedLabel)) {
    return 'Are you sure you want to confirm this book return?';
  }

  if (/\b(borrow|borrowing|reserve|reservation)\b/.test(normalizedLabel) && /\b(confirm|complete|mark|process|request|borrow|reserve)\b/.test(normalizedLabel)) {
    return normalizedLabel.includes('request')
      ? 'Are you sure you want to submit this borrow request?'
      : 'Are you sure you want to confirm this book borrowing?';
  }

  if (isAdminModule && /\b(delete|remove|disable|enable|archive)\b/.test(normalizedLabel)) {
    if (/\b(delete|remove)\b/.test(normalizedLabel)) {
      return 'Are you sure you want to delete this item?';
    }
    if (/\b(disable|enable)\b/.test(normalizedLabel)) {
      return `Are you sure you want to ${/\bdisable\b/.test(normalizedLabel) ? 'disable' : 'enable'} this account?`;
    }
  }

  return '';
}

function AppRouter() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [pendingConfirmation, setPendingConfirmation] = useState(null);
  const approvedButtonRef = useRef(null);
  const approvedFormRef = useRef(null);

  const confirmMajorButtonAction = (event) => {
    const target = event.target;
    const button = target instanceof Element ? target.closest('button') : null;

    if (!button || (button.type === 'submit' && button.closest('form'))) return;
    if (approvedButtonRef.current === button) {
      approvedButtonRef.current = null;
      return;
    }

    const message = getMajorActionConfirmation(button);
    if (!message) return;
    const isSignOut = /\b(log out|logout|sign out)\b/.test(
      (button.getAttribute('aria-label') || button.textContent || '').toLowerCase()
    );

    event.preventDefault();
    event.stopPropagation();
    setPendingConfirmation({
      message,
      onConfirm: async () => {
        if (isSignOut) {
          await logout();
          navigate('/', { replace: true });
          return;
        }
        approvedButtonRef.current = button;
        button.click();
      },
    });
  };

  const confirmMajorFormAction = (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (approvedFormRef.current === form) {
      approvedFormRef.current = null;
      return;
    }

    const submitter =
      event.nativeEvent.submitter ||
      form.querySelector('button[type="submit"], input[type="submit"]');
    const message = getMajorActionConfirmation(submitter);
    if (!message) return;

    event.preventDefault();
    event.stopPropagation();
    setPendingConfirmation({
      message,
      onConfirm: () => {
        approvedFormRef.current = form;
        if (submitter) {
          form.requestSubmit(submitter);
        } else {
          form.requestSubmit();
        }
      },
    });
  };

  const closeConfirmation = () => setPendingConfirmation(null);
  const acceptConfirmation = () => {
    const confirmation = pendingConfirmation;
    setPendingConfirmation(null);
    confirmation?.onConfirm();
  };

  return (
    <div
            onClickCapture={confirmMajorButtonAction}
            onSubmitCapture={confirmMajorFormAction}
          >
            <Suspense fallback={<RouteLoadingFallback />}>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route
                  path="/catalog"
                  element={
                    <ProtectedRoute unauthenticatedTo="/visitor-login">
                      <OPACCatalog activeView="catalog" />
                    </ProtectedRoute>
                  }
                />
                <Route path="/visitor-login" element={<VisitorLogin />} />
                <Route
                  path="/visitor-register"
                  element={<VisitorLogin initialView="register" />}
                />
                <Route
                  path="/visitor"
                  element={
                    <ProtectedRoute allowedRoles={['visitor']}>
                      <VisitorDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/subadmin"
                  element={
                    <ProtectedRoute allowedRoles={['subadmin']}>
                      <SubAdminDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/subadmin/attendance-kiosk"
                  element={
                    <ProtectedRoute allowedRoles={['subadmin']}>
                      <AttendanceKiosk />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/superadmin"
                  element={
                    <ProtectedRoute allowedRoles={['superadmin']}>
                      <SuperAdminDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
            {pendingConfirmation && (
              <div
                className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm"
                data-confirmation-dialog
              >
                <section
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="action-confirmation-title"
                  aria-describedby="action-confirmation-message"
                  className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
                >
                  <div className="flex items-start gap-4 p-6">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-shelf-primary">
                      <ShieldCheck size={22} aria-hidden="true" />
                    </div>
                    <div className="min-w-0 pt-0.5">
                      <h2
                        id="action-confirmation-title"
                        className="text-base font-bold text-slate-900"
                      >
                        Confirm action
                      </h2>
                      <p
                        id="action-confirmation-message"
                        className="mt-2 text-sm leading-6 text-slate-600"
                      >
                        {pendingConfirmation.message}
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
                    <button
                      type="button"
                      onClick={closeConfirmation}
                      className="min-h-10 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={acceptConfirmation}
                      className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-shelf-primary px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary focus-visible:ring-offset-2"
                    >
                      <BadgeCheck size={16} aria-hidden="true" />
                      Confirm
                    </button>
                  </div>
                </section>
              </div>
            )}
          </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <LibraryProvider>
        <BrowserRouter>
          <AppRouter />
        </BrowserRouter>
      </LibraryProvider>
    </AuthProvider>
  );
}
