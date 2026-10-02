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
  // LOGIN ORDER:
  //
  // 1. Visitor
  // 2. Staff
  //
  // This prevents a normal visitor account from receiving:
  //
  // "This account has not been provisioned as a
  // SHELF staff account."
  //
  // EMAIL:
  // - Try visitor first.
  // - If visitor fails, try staff.
  //
  // QR:
  // - Go directly to visitor login.
  // =========================================================

  const login = async ({
    identifier,
    password,
  }) => {
    const normalizedIdentifier =
      String(identifier || '').trim();

    const normalizedPassword =
      String(password || '');

    // =======================================================
    // BASIC VALIDATION
    // =======================================================

    if (!normalizedIdentifier) {
      throw new Error(
        'Email or visitor QR pass is required.'
      );
    }

    // =======================================================
    // QR LOGIN
    //
    // QR/pass IDs do not contain "@", so they are handled
    // directly as visitor login.
    // =======================================================

    if (!normalizedIdentifier.includes('@')) {
      try {
        const visitor =
          await store.loginVisitor({
            identifier:
              normalizedIdentifier,
            password: '',
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
      } catch (error) {
        console.error(
          'QR VISITOR LOGIN FAILED:',
          error
        );

        throw error;
      }
    }

    // =======================================================
    // EMAIL LOGIN REQUIRES PASSWORD
    // =======================================================

    if (!normalizedPassword) {
      throw new Error(
        'Password is required.'
      );
    }

    // =======================================================
    // 1. TRY VISITOR LOGIN FIRST
    //
    // Normal visitor accounts should succeed here.
    //
    // If successful, we immediately return the visitor
    // session and never attempt staff authorization.
    // =======================================================

    let visitorError = null;

    try {
      const visitor =
        await store.loginVisitor({
          identifier:
            normalizedIdentifier,
          password:
            normalizedPassword,
        });

      if (visitor) {
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
      }

      visitorError = new Error(
        'Visitor account was not found.'
      );
    } catch (error) {
      visitorError = error;

      console.error(
        'VISITOR LOGIN ATTEMPT FAILED:',
        error
      );
    }

    // =======================================================
    // 2. TRY STAFF LOGIN
    //
    // If visitor login failed, the account may be:
    //
    // - Sub-Admin
    // - Super Admin
    //
    // =======================================================

    try {
      const staff =
        await loginStaffAccount(
          normalizedIdentifier,
          normalizedPassword
        );

      if (!staff) {
        throw new Error(
          'Staff profile was not found.'
        );
      }

      return {
        success: true,
        role: staff.role,
        user: staff,
      };
    } catch (staffError) {
      console.error(
        'STAFF LOGIN ATTEMPT FAILED:',
        staffError
      );

      // =====================================================
      // PRESERVE STAFF-SPECIFIC ERRORS
      // =====================================================

      const staffErrorMessage =
        String(
          staffError?.message || ''
        ).trim();

      // =====================================================
      // INACTIVE STAFF
      //
      // Do not hide this with a visitor error.
      // =====================================================

      if (
        staffErrorMessage ===
        'This staff account is currently inactive.'
      ) {
        throw staffError;
      }

      // =====================================================
      // INVALID STAFF CREDENTIALS
      //
      // Visitor login already failed, so return the visitor
      // error if one exists.
      // =====================================================

      if (
        staffErrorMessage ===
        'Invalid login credentials'
      ) {
        throw visitorError || staffError;
      }

      // =====================================================
      // NOT PROVISIONED AS STAFF
      //
      // This should normally not appear for a visitor anymore
      // because visitor login was already attempted first.
      //
      // If neither visitor nor staff login succeeds, return
      // the visitor-side error instead of exposing the staff
      // provisioning message to a normal visitor.
      // =====================================================

      if (
        staffErrorMessage ===
        'This account has not been provisioned as a SHELF staff account.'
      ) {
        throw visitorError || staffError;
      }

      // =====================================================
      // OTHER STAFF ERROR
      // =====================================================

      throw staffError;
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
