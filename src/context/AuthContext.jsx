import { useEffect, useState } from 'react';

import * as store from '../data/store.js';
import { AuthContext } from './authContext.js';
import { supabase } from '../lib/supabaseClient.js';

const SESSION_KEY = 'shelf_ilms_session_v1';

const notifyVisitorSessionChanged = () => {
  try {
    window.dispatchEvent(
      new Event(
        'shelf:visitor-session-changed'
      )
    );
  } catch (error) {
    console.warn(
      'SHELF visitor session event failed:',
      error
    );
  }
};

export const AuthProvider = ({ children }) => {
  // =========================================================
  // RESTORE SHELF SESSION
  // =========================================================

  const [user, setUser] = useState(() => {
    try {
      const raw =
        globalThis.localStorage.getItem(SESSION_KEY);

      if (!raw) {
        return null;
      }

      return JSON.parse(raw);
    } catch (error) {
      console.error(
        'Failed to restore SHELF session:',
        error
      );

      try {
        globalThis.localStorage.removeItem(
          SESSION_KEY
        );
      } catch {
        // Ignore cleanup errors.
      }

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

      notifyVisitorSessionChanged();
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
      // Only remove SHELF's own session.
      // Do NOT clear the entire localStorage because
      // other application/browser data may be stored there.
      globalThis.localStorage.removeItem(
        SESSION_KEY
      );

      globalThis.sessionStorage.clear();
    } catch (error) {
      console.error(
        'Failed to clear SHELF browser session:',
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
  // VISITOR OTP VERIFICATION
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

  // =========================================================
  // RESEND VISITOR OTP
  // =========================================================

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
  // BUILD VISITOR SESSION
  //
  // Centralized helper so email login, QR login, and
  // visitor-session login all use exactly the same shape.
  // =========================================================

  const createVisitorSession = (visitor) => {
    if (!visitor?.id) {
      throw new Error(
        'Visitor information is incomplete.'
      );
    }

    return {
      role: 'visitor',
      id: visitor.id,
      name: visitor.fullName,
      email: visitor.email,
      qrCode: visitor.qrCode,
    };
  };

  // =========================================================
  // BUILD STAFF SESSION
  // =========================================================

  const createStaffSession = (staff) => {
    if (!staff?.id) {
      throw new Error(
        'Staff information is incomplete.'
      );
    }

    return {
      id: staff.id,
      role: staff.role,
      name: staff.name,
      email: staff.email,
      libraryId: staff.libraryId,
    };
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

      const visitorSession =
        createVisitorSession(visitor);

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
  //
  // Used when the application already has verified visitor
  // information, such as after OTP verification or QR flow.
  // =========================================================

  const loginAsVisitorSession = (
    visitor
  ) => {
    if (!visitor) {
      throw new Error(
        'Visitor information is required.'
      );
    }
    const visitorSession =
      createVisitorSession(visitor);
      createVisitorSession(visitor);
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

      const staffSession =
        createStaffSession(staff);

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
    // SHELF QR codes such as:
    //
    // SHELF-QR-404725
    //
    // do not contain "@", so they are handled directly
    // as visitor login.
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

        const visitorSession =
          createVisitorSession(visitor);

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
    // This prevents a normal visitor from receiving a staff
    // provisioning error.
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
        const visitorSession =
          createVisitorSession(visitor);

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
      // error when available.
      // =====================================================

      if (
        staffErrorMessage ===
        'Invalid login credentials'
      ) {
        throw visitorError || staffError;
      }

      // =====================================================
      // NOT PROVISIONED AS STAFF
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

        // -----------------------------------------------------
        // Visitor
        // -----------------------------------------------------

        registerVisitor,
        verifyVisitorOtp,
        resendVisitorOtp,
        loginVisitor,
        loginAsVisitorSession,

        // -----------------------------------------------------
        // Staff
        // -----------------------------------------------------

        loginStaffAccount,
        loginSubAdmin,
        loginSuperAdmin,

        // -----------------------------------------------------
        // Unified login
        // -----------------------------------------------------

        login,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
