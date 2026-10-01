import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import { AuthProvider } from './context/AuthContext.jsx';
import { LibraryProvider } from './context/LibraryContext.jsx';

import ProtectedRoute from './routes/ProtectedRoute.jsx';

// =========================================================
// ONE LOGIN PAGE
// =========================================================

import VisitorLogin from './pages/visitor/VisitorLogin.jsx';

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
                ONE LOGIN PAGE FOR ALL USERS
               ================================================= */}

            <Route
              path="/"
              element={<VisitorLogin />}
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
