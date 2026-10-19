import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import { AuthProvider } from './context/AuthContext.jsx';
import { LibraryProvider } from './context/LibraryContext.jsx';

import ProtectedRoute from './routes/ProtectedRoute.jsx';

// =========================================================
// PUBLIC & VISITOR PAGES
// =========================================================

import LandingPage from './pages/visitor/LandingPage.jsx'; // INIDAGDAG
import VisitorLogin from './pages/visitor/VisitorLogin.jsx';
import OPACCatalog from './component/OPACCatalog.jsx';

// =========================================================
// DASHBOARDS
// =========================================================

import VisitorDashboard from './pages/visitor/VisitorDashboard.jsx';
import SubAdminDashboard from './pages/subadmin/SubAdminDashboard.jsx';
import SuperAdminDashboard from './pages/superadmin/SuperAdminDashboard.jsx';

export default function App() {
  return (
    <AuthProvider>
      <LibraryProvider>
        <BrowserRouter>

          <Routes>

            {/* =================================================
                MAIN LANDING PAGE (HOMEPAGE FOR GUESTS)
               ================================================= */}

            <Route
              path="/"
              element={<LandingPage />}
            />

            {/* =================================================
                PUBLIC CATALOG
               ================================================= */}

            <Route
              path="/catalog"
              element={<OPACCatalog activeView="catalog" />}
            />

            {/* =================================================
                VISITOR LOGIN / SIGN IN
               ================================================= */}

            <Route
              path="/visitor-login"
              element={<VisitorLogin />}
            />

            {/* =================================================
                PUBLIC VISITOR REGISTER / SIGN UP PAGE
               ================================================= */}

            <Route
              path="/visitor-register"
              element={<Navigate to="/visitor-login" replace />}
            />

            {/* =================================================
                VISITOR DASHBOARD
               ================================================= */}

            <Route
              path="/visitor"
              element={
                <ProtectedRoute allowedRoles={['visitor']}>
                  <VisitorDashboard />
                </ProtectedRoute>
              }
            />

            {/* =================================================
                SUB-ADMIN / CIRCULATION DESK DASHBOARD
               ================================================= */}

            <Route
              path="/subadmin"
              element={
                <ProtectedRoute allowedRoles={['subadmin']}>
                  <SubAdminDashboard />
                </ProtectedRoute>
              }
            />

            {/* =================================================
                SUPER ADMIN DASHBOARD
               ================================================= */}

            <Route
              path="/superadmin"
              element={
                <ProtectedRoute allowedRoles={['superadmin']}>
                  <SuperAdminDashboard />
                </ProtectedRoute>
              }
            />

            {/* =================================================
                FALLBACK
               ================================================= */}

            <Route
              path="*"
              element={<Navigate to="/" replace />}
            />

          </Routes>

        </BrowserRouter>
      </LibraryProvider>
    </AuthProvider>
  );
}