import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { LibraryProvider } from './context/LibraryContext';
import ProtectedRoute from './routes/ProtectedRoute';

// Login Pages
import VisitorLogin from './pages/visitor/VisitorLogin';
import AdminLogin from './pages/AdminLogin'; // <-- Sub-Admin Login Page
import SuperAdminLogin from './pages/superadmin/SuperAdminLogin';

// Dashboard Pages
import VisitorDashboard from './pages/visitor/VisitorDashboard';
import SubAdminDashboard from './pages/subadmin/SubAdminDashboard';
import SuperAdminDashboard from './pages/superadmin/SuperAdminDashboard';

export default function App() {
  return (
    <AuthProvider>
      <LibraryProvider>
        <BrowserRouter>
          <Routes>
            {/* Public Login Portals */}
            <Route path="/" element={<VisitorLogin />} />
            <Route path="/admin-login" element={<AdminLogin />} /> {/* Sub-Admin Route */}
            <Route path="/superadmin-login" element={<SuperAdminLogin />} />

            {/* Protected Role Dashboards */}
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
                <ProtectedRoute allowedRoles={['subadmin', 'superadmin']}>
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

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </LibraryProvider>
    </AuthProvider>
  );
}
