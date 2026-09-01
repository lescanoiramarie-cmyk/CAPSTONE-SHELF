import { createContext, useContext, useState, useEffect } from 'react';
import * as store from '../data/store';

const AuthContext = createContext();
const SESSION_KEY = 'shelf_ilms_session_v1';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (user) {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(SESSION_KEY);
    }
  }, [user]);

  const logout = () => setUser(null);

  // ---- Visitor ----
  const registerVisitor = (formData) => store.registerVisitor(formData);
  const verifyVisitorOtp = (visitorId, code) => store.verifyVisitorOtp(visitorId, code);
  const resendVisitorOtp = (visitorId) => store.resendOtp(visitorId);

  const loginVisitor = ({ identifier, password }) => {
    const visitor = store.loginVisitor({ identifier, password });
    setUser({ role: 'visitor', id: visitor.id, name: visitor.fullName, email: visitor.email, qrCode: visitor.qrCode });
    return visitor;
  };

  const loginAsVisitorSession = (visitor) => {
    setUser({ role: 'visitor', id: visitor.id, name: visitor.fullName, email: visitor.email, qrCode: visitor.qrCode });
  };

  // ---- Staff (hardcoded credentials) ----
  const loginSubAdmin = (email, password) => {
    const staff = store.loginSubAdmin(email, password);
    setUser({ role: 'subadmin', name: staff.name, email: staff.email, libraryId: staff.libraryId });
    return staff;
  };

  const loginSuperAdmin = (email, password) => {
    const staff = store.loginSuperAdmin(email, password);
    setUser({ role: 'superadmin', name: staff.name, email: staff.email });
    return staff;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        logout,
        registerVisitor,
        verifyVisitorOtp,
        resendVisitorOtp,
        loginVisitor,
        loginAsVisitorSession,
        loginSubAdmin,
        loginSuperAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
