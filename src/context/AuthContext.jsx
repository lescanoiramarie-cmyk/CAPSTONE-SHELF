import { useEffect, useState } from 'react';

import * as store from '../data/store.js';
import { AuthContext } from './authContext.js';
import { supabase } from '../lib/supabaseClient.js';

const SESSION_KEY = 'shelf_ilms_session_v1';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try {
      const raw =
        globalThis.localStorage.getItem(SESSION_KEY);

      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.error(
        'Failed to restore SHELF session:',
        error
      );

      return null;
    }
  });

  // =========================================================
  // SESSION STORAGE
  // =========================================================

  useEffect(() => {
    try {
      if (user) {
        globalThis.localStorage.setItem(
          SESSION_KEY,
          JSON.stringify(user)
        );
      } else {
        globalThis.localStorage.removeItem(
          SESSION_KEY
        );
      }
    } catch (error) {
      console.error(
        'Failed to save SHELF session:',
        error
      );
    }
  }, [user]);

  // =========================================================
  // LOGOUT
  // =========================================================

  const logout = async () => {
    try {
      if (supabase?.auth) {
        await supabase.auth.signOut();
      }
    } catch (error) {
      console.error(
        'Supabase logout error:',
        error
      );
    }

    setUser(null);

    try {
      globalThis.localStorage.removeItem(
        SESSION_KEY
      );

      globalThis.localStorage.clear();
      globalThis.sessionStorage.clear();
    } catch (error) {
      console.error(
        'Failed to clear browser session:',
        error
      );
    }
  };

  // =========================================================
  // VISITOR REGISTRATION
  // =========================================================

  const registerVisitor = async (formData) => {
    try {
      return await store.registerVisitor(formData);
    } catch (error) {
      console.error(
        'Visitor registration error:',
        error
      );

      throw error;
    }
  };

  // =========================================================
  // VISITOR OTP
  // =========================================================

  const verifyVisitorOtp = async (
    visitorId,
    code
  ) => {
    try {
      return await store.verifyVisitorOtp(
        visitorId,
        code
      );
    } catch (error) {
      console.error(
        'Visitor OTP verification error:',
        error
      );

      throw error;
    }
  };

  const resendVisitorOtp = async (
    visitorId
  ) => {
    try {
      return await store.resendOtp(visitorId);
    } catch (error) {
      console.error(
        'Visitor OTP resend error:',
        error
      );

      throw error;
    }
  };

  // =========================================================
  // VISITOR LOGIN
  // =========================================================

  const loginVisitor = async ({
    identifier,
    password,
  }) => {
    try {
      const visitor =
        await store.loginVisitor({
          identifier,
          password,
        });

      if (!visitor) {
        throw new Error(
          'Visitor account was not found.'
        );
      }

      const visitorSession = {
        role: 'visitor',
        id: visitor.id,
        name: visitor.fullName,
        email: visitor.email,
        qrCode: visitor.qrCode,
      };

      setUser(visitorSession);

      return visitor;
    } catch (error) {
      console.error(
        'Visitor login error:',
        error
      );

      throw error;
    }
  };

  // =========================================================
  // VISITOR SESSION
  // =========================================================

  const loginAsVisitorSession = (
    visitor
  ) => {
    if (!visitor) {
      throw new Error(
        'Visitor information is required.'
      );
    }

    const visitorSession = {
      role: 'visitor',
      id: visitor.id,
      name: visitor.fullName,
      email: visitor.email,
      qrCode: visitor.qrCode,
    };

    setUser(visitorSession);

    return visitorSession;
  };

  // =========================================================
  // STAFF LOGIN
  //
  // Supabase Auth:
  // Authentication
  //
  // staff_profiles:
  // Authorization
  // =========================================================

  const loginStaffAccount = async (
    email,
    password
  ) => {
    const normalizedEmail =
      String(email || '')
        .trim()
        .toLowerCase();

    const normalizedPassword =
      String(password || '');

    if (!normalizedEmail) {
      throw new Error(
        'Email is required.'
      );
    }

    if (!normalizedPassword) {
      throw new Error(
        'Password is required.'
      );
    }

    try {
      const staff =
        await store.loginStaffAccount(
          normalizedEmail,
          normalizedPassword
        );

      if (!staff) {
        throw new Error(
          'Staff profile was not found.'
        );
      }

      const staffSession = {
        id: staff.id,
        role: staff.role,
        name: staff.name,
        email: staff.email,
        libraryId: staff.libraryId,
      };

      setUser(staffSession);

      return staff;
    } catch (error) {
      console.error(
        'STAFF LOGIN ERROR:',
        error
      );

      throw error;
    }
  };

  // =========================================================
  // SUB-ADMIN LOGIN
  // =========================================================

  const loginSubAdmin = async (
    email,
    password
  ) => {
    const staff =
      await loginStaffAccount(
        email,
        password
      );

    if (
      !staff ||
      staff.role !== 'subadmin'
    ) {
      try {
        if (supabase?.auth) {
          await supabase.auth.signOut();
        }
      } catch (error) {
        console.error(
          'Sub-Admin sign-out error:',
          error
        );
      }

      setUser(null);

      throw new Error(
        'This account is not registered as a Sub-Admin.'
      );
    }

    return staff;
  };

  // =========================================================
  // SUPER ADMIN LOGIN
  // =========================================================

  const loginSuperAdmin = async (
    email,
    password
  ) => {
    const staff =
      await loginStaffAccount(
        email,
        password
      );

    if (
      !staff ||
      staff.role !== 'superadmin'
    ) {
      try {
        if (supabase?.auth) {
          await supabase.auth.signOut();
        }
      } catch (error) {
        console.error(
          'Super Admin sign-out error:',
          error
        );
      }

      setUser(null);

      throw new Error(
        'This account is not registered as a Super Admin.'
      );
    }

    return staff;
  };

  // =========================================================
  // UNIFIED LOGIN
  //
  // STAFF FIRST
  // VISITOR SECOND
  //
  // IMPORTANT:
  //
  // Visitor fallback is allowed ONLY when the staff login
  // fails because the credentials are invalid.
  //
  // If the account is an actual staff account but is:
  // - inactive
  // - not provisioned
  // - invalid staff role
  //
  // the staff-specific error is returned directly.
  // =========================================================

  const login = async ({
    identifier,
    password,
  }) => {
    const normalizedIdentifier =
      String(identifier || '').trim();

    const normalizedPassword =
      String(password || '');

    if (!normalizedIdentifier) {
      throw new Error(
        'Email or ID is required.'
      );
    }

    if (!normalizedPassword) {
      throw new Error(
        'Password is required.'
      );
    }

    // =======================================================
    // 1. TRY STAFF LOGIN FIRST
    // =======================================================

    let staffError = null;

    try {
      const staff =
        await loginStaffAccount(
          normalizedIdentifier,
          normalizedPassword
        );

      return {
        success: true,
        role: staff.role,
        user: staff,
      };
    } catch (error) {
      staffError = error;

      console.error(
        'STAFF LOGIN ATTEMPT FAILED:',
        error
      );
    }

    // =======================================================
    // IMPORTANT STAFF ERROR HANDLING
    //
    // Only "Invalid login credentials" should fall through
    // to visitor login.
    //
    // Any other staff error means that authentication reached
    // a staff-related condition and should be shown directly.
    // =======================================================

    const staffErrorMessage =
      String(staffError?.message || '')
        .trim();

    const shouldTryVisitorLogin =
      staffErrorMessage ===
      'Invalid login credentials';

    if (!shouldTryVisitorLogin) {
      throw staffError;
    }

    // =======================================================
    // 2. TRY VISITOR LOGIN
    //
    // This happens only when Supabase Auth says that the
    // supplied credentials are not valid for a staff account.
    //
    // This allows normal visitor email/password and QR login
    // to continue working.
    // =======================================================

    try {
      const visitor =
        await store.loginVisitor({
          identifier:
            normalizedIdentifier,
          password:
            normalizedPassword,
        });

      if (!visitor) {
        throw new Error(
          'Visitor account was not found.'
        );
      }

      const visitorSession = {
        role: 'visitor',
        id: visitor.id,
        name: visitor.fullName,
        email: visitor.email,
        qrCode: visitor.qrCode,
      };

      setUser(visitorSession);

      return {
        success: true,
        role: 'visitor',
        user: visitor,
      };
    } catch (visitorError) {
      console.error(
        'VISITOR LOGIN ATTEMPT FAILED:',
        visitorError
      );

      throw visitorError;
    }
  };

  // =========================================================
  // AUTH CONTEXT
  // =========================================================

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
        loginStaffAccount,
        loginSubAdmin,
        loginSuperAdmin,

        // Unified login
        login,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
