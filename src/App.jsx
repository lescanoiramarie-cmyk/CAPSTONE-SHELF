import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import { AuthProvider } from './context/AuthContext';
import { LibraryProvider } from './context/LibraryContext';

import ProtectedRoute from './routes/ProtectedRoute';
import { autoCancelExpiredRequests } from './lib/supabaseClient';

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
  useEffect(() => {
    // 1. I-run agad ang cancellation check pagka-load ng app
    autoCancelExpiredRequests();

    // 2. Mag-check ulit bawat 5 minuto (300,000 milliseconds)
    const interval = setInterval(() => {
      autoCancelExpiredRequests();
    }, 300000);

    return () => clearInterval(interval);
  }, []);

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