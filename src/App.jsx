import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import { AuthProvider } from './context/AuthContext';
import { LibraryProvider } from './context/LibraryContext';

import ProtectedRoute from './routes/ProtectedRoute';

// =========================================================
// ONE LOGIN PAGE
// =========================================================

import VisitorLogin from './pages/visitor/VisitorLogin';

// =========================================================
// DASHBOARDS
// =========================================================

import VisitorDashboard from './pages/visitor/VisitorDashboard';
import SubAdminDashboard from './pages/subadmin/SubAdminDashboard';
import SuperAdminDashboard from './pages/superadmin/SuperAdminDashboard';

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
