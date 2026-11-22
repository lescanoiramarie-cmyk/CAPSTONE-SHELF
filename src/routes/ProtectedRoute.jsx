import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';
import { getDashboardPath } from './roleHome.js';

const ProtectedRoute = ({
  children,
  allowedRoles,
  unauthenticatedTo = '/',
}) => {
  const { user, authLoading } = useAuth();
  const location = useLocation();

  if (authLoading) {
    return <div role="status" className="grid min-h-[40vh] place-items-center text-sm font-medium text-slate-600">Restoring your secure session…</div>;
  }

  if (!user) {
    return (
      <Navigate
        to={unauthenticatedTo}
        state={{ from: location }}
        replace
      />
    );
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={getDashboardPath(user.role)} replace />;
  }

  return children;
};

export default ProtectedRoute;
