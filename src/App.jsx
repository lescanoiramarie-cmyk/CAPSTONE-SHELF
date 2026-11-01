import { lazy, Suspense, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import { AuthProvider } from './context/AuthContext.jsx';
import { LibraryProvider } from './context/LibraryContext.jsx';
import { LibraryContext } from './context/libraryContext.js';

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
const SuperAdminDashboard = lazy(
  () => import('./pages/superadmin/SuperAdminDashboard.jsx')
);

function RouteLoadingFallback() {
  const library = useContext(LibraryContext);

  if (library?.loading) return null;

  return (
    <main>
      <ShelfLoader screen label="Loading SHELF..." />
    </main>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <LibraryProvider>
        <BrowserRouter>
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