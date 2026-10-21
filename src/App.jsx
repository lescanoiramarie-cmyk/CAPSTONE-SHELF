import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import { AuthProvider } from './context/AuthContext.jsx';
import { LibraryProvider } from './context/LibraryContext.jsx';

import ProtectedRoute from './routes/ProtectedRoute.jsx';

const LandingPage = lazy(() => import('./pages/visitor/LandingPage.jsx'));
const VisitorLogin = lazy(() => import('./pages/visitor/VisitorLogin.jsx'));
const OPACCatalog = lazy(() => import('./component/OPACCatalog.jsx'));
const VisitorDashboard = lazy(
  () => import('./pages/visitor/VisitorDashboard.jsx')
);
const SubAdminDashboard = lazy(
  () => import('./pages/subadmin/SubAdminDashboard.jsx')
);
const SuperAdminDashboard = lazy(
  () => import('./pages/superadmin/SuperAdminDashboard.jsx')
);

export default function App() {
  return (
    <AuthProvider>
      <LibraryProvider>
        <BrowserRouter>
          <Suspense
            fallback={
              <main
                role="status"
                className="flex min-h-screen items-center justify-center text-sm font-semibold text-slate-600"
              >
                Loading SHELF...
              </main>
            }
          >
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route
                path="/catalog"
                element={<OPACCatalog activeView="catalog" />}
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
        </BrowserRouter>
      </LibraryProvider>
    </AuthProvider>
  );
}