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

  // =========================================================
  // VISITOR
  // =========================================================

  const registerVisitor = (formData) =>
    store.registerVisitor(formData);

  const verifyVisitorOtp = (visitorId, code) =>
    store.verifyVisitorOtp(visitorId, code);

  const resendVisitorOtp = (visitorId) =>
    store.resendOtp(visitorId);

  const loginVisitor = async ({ identifier, password }) => {
    const visitor = await store.loginVisitor({
      identifier,
      password,
    });

    setUser({
      role: 'visitor',
      id: visitor.id,
      name: visitor.fullName,
      email: visitor.email,
      qrCode: visitor.qrCode,
    });

    return visitor;
  };

  const loginAsVisitorSession = (visitor) => {
    setUser({
      role: 'visitor',
      id: visitor.id,
      name: visitor.fullName,
      email: visitor.email,
      qrCode: visitor.qrCode,
    });
  };

  // =========================================================
  // SUB-ADMIN / CIRCULATION DESK
  // =========================================================

  const loginSubAdmin = (email, password) => {
    const staff = store.loginSubAdmin(email, password);

    setUser({
      role: 'subadmin',
      name: staff.name,
      email: staff.email,
      libraryId: staff.libraryId,
    });

    return staff;
  };

  // =========================================================
  // SUPER ADMIN
  // =========================================================

  const loginSuperAdmin = (email, password) => {
    const staff = store.loginSuperAdmin(email, password);

    setUser({
      role: 'superadmin',
      name: staff.name,
      email: staff.email,
    });

    return staff;
  };

  // =========================================================
  // UNIFIED LOGIN
  // Automatically detects the user's role
  // =========================================================

  const login = async ({ identifier, password }) => {
    const email = identifier.trim().toLowerCase();

    // ---------------------------------------------------------
    // 1. SUPER ADMIN
    // ---------------------------------------------------------

    try {
      const staff = store.loginSuperAdmin(email, password);

      setUser({
        role: 'superadmin',
        name: staff.name,
        email: staff.email,
      });

      return {
        success: true,
        role: 'superadmin',
        user: staff,
      };
    } catch {
      // Not Super Admin.
      // Continue checking.
    }

    // ---------------------------------------------------------
    // 2. SUB-ADMIN / CIRCULATION DESK
    // ---------------------------------------------------------

    try {
      const staff = store.loginSubAdmin(email, password);

      setUser({
        role: 'subadmin',
        name: staff.name,
        email: staff.email,
        libraryId: staff.libraryId,
      });

      return {
        success: true,
        role: 'subadmin',
        user: staff,
      };
    } catch {
      // Not Sub-Admin.
      // Continue checking.
    }

    // ---------------------------------------------------------
    // 3. VISITOR
    // ---------------------------------------------------------

    try {
      const visitor = await store.loginVisitor({
        identifier,
        password,
      });

      setUser({
        role: 'visitor',
        id: visitor.id,
        name: visitor.fullName,
        email: visitor.email,
        qrCode: visitor.qrCode,
      });

      return {
        success: true,
        role: 'visitor',
        user: visitor,
      };
    } catch {
      // No matching account.
    }

    // ---------------------------------------------------------
    // 4. LOGIN FAILED
    // ---------------------------------------------------------

    throw new Error('Invalid email/ID or password.');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        logout,

        // Visitor
        registerVisitor,
        verifyVisitorOtp,
        resendVisitorOtp,
        loginVisitor,
        loginAsVisitorSession,

        // Staff
        loginSubAdmin,
        loginSuperAdmin,

        // Unified Login
        login,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
