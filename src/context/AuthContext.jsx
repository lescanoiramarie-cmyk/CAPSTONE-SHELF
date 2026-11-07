import { useCallback, useEffect, useRef, useState } from 'react';
import * as store from '../data/store.js';
import { AuthContext } from './authContext.js';
import { supabase } from '../lib/supabaseClient.js';

const SESSION_KEY = 'shelf_ilms_session_v1';
const SESSION_ACTIVITY_KEY = 'shelf_ilms_last_activity_v1';
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const IDLE_WARNING_TIMEOUT_MS = 5 * 60 * 1000;

const notifyVisitorSessionChanged = () => {
  try {
    window.dispatchEvent(
      new Event('shelf:visitor-session-changed')
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
      const raw = globalThis.localStorage.getItem(SESSION_KEY);
      if (!raw) {
        return null;
      }
      const restoredUser = JSON.parse(raw);
      if (
        restoredUser?.role === 'visitor' &&
        !/^SHELF-QR-[0-9]{6}$/.test(
          String(restoredUser.qrCode || '')
        )
      ) {
        return {
          ...restoredUser,
          qrCode: null,
        };
      }
      return restoredUser;
    } catch (error) {
      console.error(
        'Failed to restore SHELF session:',
        error
      );
      try {
        globalThis.localStorage.removeItem(SESSION_KEY);
      } catch {
        // Ignore cleanup errors.
      }
      return null;
    }
  });
  const persistedUserSnapshotRef = useRef(JSON.stringify(user));
  const pendingMfaLoginRef = useRef(null);
  const [idleSecondsRemaining, setIdleSecondsRemaining] = useState(null);
  const resetIdleTimerRef = useRef(null);
  const idleWarningActiveRef = useRef(false);

  const logout = useCallback(async () => {
    setIdleSecondsRemaining(null);
    try {
      if (supabase?.auth) {
        await supabase.auth.signOut();
      }
    } catch (error) {
      console.error('Supabase logout error:', error);
    }
    setUser(null);
    try {
      globalThis.localStorage.removeItem(SESSION_KEY);
      globalThis.sessionStorage.clear();
    } catch (error) {
      console.error(
        'Failed to clear SHELF browser session:',
        error
      );
    }
  }, []);

  const keepSessionAlive = useCallback(() => {
    resetIdleTimerRef.current?.();
  }, []);

  useEffect(() => {
    if (!supabase?.auth) return undefined;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !session)) {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user?.id) return undefined;

    let idleTimeout;
    let warningTimeout;
    let countdownInterval;
    let lastActivityAt = 0;
    let lastBroadcastAt = 0;

    const clearWarning = (updateState = true) => {
      window.clearTimeout(warningTimeout);
      window.clearInterval(countdownInterval);
      warningTimeout = undefined;
      countdownInterval = undefined;
      idleWarningActiveRef.current = false;
      if (updateState) {
        setIdleSecondsRemaining(null);
      }
    };

    const markActivity = (broadcast = true) => {
      lastActivityAt = Date.now();
      clearWarning();
      window.clearTimeout(idleTimeout);
      idleTimeout = window.setTimeout(() => {
        idleWarningActiveRef.current = true;
        const deadline = Date.now() + IDLE_WARNING_TIMEOUT_MS;
        setIdleSecondsRemaining(
          Math.ceil(IDLE_WARNING_TIMEOUT_MS / 1000)
        );
        countdownInterval = window.setInterval(() => {
          setIdleSecondsRemaining(
            Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
          );
        }, 1000);
        warningTimeout = window.setTimeout(() => {
          void logout();
        }, IDLE_WARNING_TIMEOUT_MS);
      }, IDLE_TIMEOUT_MS);

      if (broadcast && Date.now() - lastBroadcastAt >= 1000) {
        lastBroadcastAt = Date.now();
        try {
          window.localStorage.setItem(
            SESSION_ACTIVITY_KEY,
            String(lastBroadcastAt)
          );
        } catch (error) {
          console.error('Failed to sync SHELF session activity:', error);
        }
      }
    };

    const handleActivity = (event) => {
      if (
        idleWarningActiveRef.current &&
        event?.target?.closest?.('[data-idle-session-warning]')
      ) {
        return;
      }
      if (
        event?.type === 'pointermove' &&
        Date.now() - lastActivityAt < 1000
      ) {
        return;
      }
      if (!idleWarningActiveRef.current) {
        markActivity();
      }
    };

    const handleStorage = (event) => {
      if (event.key !== SESSION_ACTIVITY_KEY) return;
      const activityAt = Number(event.newValue);
      if (Number.isFinite(activityAt) && activityAt > lastActivityAt) {
        markActivity(false);
      }
    };

    const stayLoggedIn = () => markActivity();
    resetIdleTimerRef.current = stayLoggedIn;
    window.addEventListener('pointerdown', handleActivity, { passive: true });
    window.addEventListener('pointerdown', handleActivity, { passive: true });
    window.addEventListener('pointermove', handleActivity, { passive: true });
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('touchstart', handleActivity, { passive: true });
    window.addEventListener('storage', handleStorage);
    window.addEventListener('storage', handleStorage);
    markActivity();

    return () => {
      window.clearTimeout(idleTimeout);
      clearWarning(false);
      resetIdleTimerRef.current = null;
      window.removeEventListener('pointerdown', handleActivity);
      window.removeEventListener('pointermove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('scroll', handleActivity);
      window.removeEventListener('storage', handleStorage);
    };
  }, [user?.id, user?.role, logout]);

  useEffect(() => {
    if (user?.role !== 'visitor' || !user.id) return undefined;

    let cancelled = false;

    const refreshVisitorProfile = async () => {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          throw sessionError;
        }

        if (!session?.user?.id) return;

        const visitor = await store.getVisitor(session.user.id);
        if (!visitor || cancelled) return;

        setUser((current) => {
          if (
            current?.role !== 'visitor' ||
            current.id !== visitor.id
          ) {
            return current;
          }

          return {
            ...current,
            name: visitor.fullName,
            email: visitor.email,
            qrCode: visitor.qrCode,
            libraryId: visitor.libraryId,
          };
        });
      } catch (error) {
        console.error('Refresh visitor profile error:', error);
      }
    };

    void refreshVisitorProfile();

    return () => {
      cancelled = true;
    };
  }, [user?.role, user?.id]);

  // =========================================================
  // SESSION STORAGE
  // =========================================================
  useEffect(() => {
    try {
      const nextSnapshot = JSON.stringify(user);
      if (user) {
        globalThis.localStorage.setItem(
          SESSION_KEY,
          JSON.stringify(user)
        );
      } else {
        globalThis.localStorage.removeItem(SESSION_KEY);
      }
      if (nextSnapshot !== persistedUserSnapshotRef.current) {
        persistedUserSnapshotRef.current = nextSnapshot;
        notifyVisitorSessionChanged();
      }
    } catch (error) {
      console.error(
        'Failed to save SHELF session:',
        error
      );
    }
  }, [user]);

  // =========================================================
  // VISITOR REGISTRATION WITH STRICT DOMAIN CHECKING
  // =========================================================
  const registerVisitor = async (formData) => {
    try {
      const targetEmail = (formData.email || formData.studentEmail || '').toLowerCase().trim();
      const emailDomain = targetEmail.split('@')[1];
      const selectedLibraryId = String(formData.libraryId || '').trim();

      if (!targetEmail || !emailDomain) {
        throw new Error('Please enter a valid email address.');
      }
      if (!selectedLibraryId) {
        throw new Error('Select your participating library or school.');
      }

      const { data: libraryRecords, error: libError } = await supabase
        .from('libraries')
        .select('id, email_domain')
        .eq('id', selectedLibraryId)
        .not('email_domain', 'is', null)
        .neq('email_domain', '');

      if (libError) {
        throw new Error(`Failed to verify your partner school email domain: ${libError.message}`);
      }

      const selectedLibrary = libraryRecords?.[0];
      const allowedDomain = String(selectedLibrary?.email_domain || '')
        .toLowerCase()
        .trim()
        .replace(/^@+/, '')
        .replace(/\.+$/, '');
      const isDomainAllowed =
        allowedDomain &&
        emailDomain !== 'gmail.com' &&
        (emailDomain === allowedDomain ||
          emailDomain.endsWith(`.${allowedDomain}`));

      if (!isDomainAllowed) {
        throw new Error(
          allowedDomain
            ? `Use an email address belonging to your selected partner school domain (@${allowedDomain}).`
            : 'The selected partner school does not have an email domain configured. Please contact the library.'
        );
      }

      return await store.registerVisitor(formData);
    } catch (error) {
      console.error('Visitor registration error:', error);
      throw error;
    }
  };

  // =========================================================
  // VISITOR OTP VERIFICATION
  // =========================================================
  const verifyVisitorOtp = async (visitorId, code) => {
    try {
      return await store.verifyVisitorOtp(visitorId, code);
    } catch (error) {
      console.error('Visitor OTP verification error:', error);
      throw error;
    }
  };

  // =========================================================
  // RESEND VISITOR OTP
  // =========================================================
  const resendVisitorOtp = async (visitorId) => {
    try {
      return await store.resendOtp(visitorId);
    } catch (error) {
      console.error('Visitor OTP resend error:', error);
      throw error;
    }
  };

  // =========================================================
  // RESEND VISITOR OTP BY EMAIL
  // =========================================================
  const resendVisitorOtpByEmail = async (email) => {
    try {
      return await store.resendVisitorOtpByEmail(email);
    } catch (error) {
      console.error('Visitor OTP resend by email error:', error);
      throw error;
    }
  };

  // =========================================================
  // ESTABLISH VISITOR SESSION FROM QR PASS
  // =========================================================
  const establishVisitorSessionFromQr = async (qrCode, password) => {
    try {
      return await store.establishVisitorSessionFromQr(qrCode, password);
    } catch (error) {
      console.error('Establish visitor session error:', error);
      throw error;
    }
  };

  // =========================================================
  // PASSWORD RESET
  // =========================================================
  const requestPasswordResetCode = async (email, accountKind) => {
    try {
      return await store.requestPasswordResetCode(email, accountKind);
    } catch (error) {
      console.error('Request password reset code error:', error);
      throw error;
    }
  };

  const verifyPasswordResetCode = async (email, code) => {
    try {
      return await store.verifyPasswordResetCode(email, code);
    } catch (error) {
      console.error('Verify password reset code error:', error);
      throw error;
    }
  };

  const applyPasswordReset = async (input) => {
    try {
      return await store.applyPasswordReset(input);
    } catch (error) {
      console.error('Apply password reset error:', error);
      throw error;
    }
  };

  // =========================================================
  // BUILD VISITOR SESSION
  // =========================================================
  const createVisitorSession = (visitor) => {
    if (!visitor?.id) {
      throw new Error('Visitor information is incomplete.');
    }
    return {
      role: 'visitor',
      id: visitor.id,
      name: visitor.fullName,
      email: visitor.email,
      qrCode: visitor.qrCode,
      libraryId: visitor.libraryId,
    };
  };

  // =========================================================
  // BUILD STAFF SESSION
  // =========================================================
  const createStaffSession = (staff) => {
    if (!staff?.id) {
      throw new Error('Staff information is incomplete.');
    }
    return {
      id: staff.id,
      role: staff.role,
      name: staff.name,
      email: staff.email,
      libraryId: staff.libraryId,
    };
  };

  const beginMfaLogin = async (sessionUser, required) => {
    if (!supabase?.auth?.mfa) {
      if (required) throw new Error('Multi-factor authentication is unavailable. Contact your system administrator.');
      return null;
    }
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;
    const factors = data?.totp || data?.all || [];
    const verifiedFactor = factors.find((factor) => factor.status === 'verified');
    if (!verifiedFactor && !required) return null;

    if (!verifiedFactor) {
      const pendingFactors = factors.filter((factor) => factor.status === 'unverified');
      for (const pendingFactor of pendingFactors) {
        const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: pendingFactor.id });
        if (unenrollError) throw new Error('An unfinished authenticator setup is attached to this account. Sign in again, then retry MFA setup.');
      }
      const { data: enrollment, error: enrollmentError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `SHELF sign-in ${Date.now()}` });
      if (enrollmentError) {
        // Factor names are unique. Refresh once in case a previous setup left an
        // unverified factor behind or another request completed enrollment.
        const { data: refreshed, error: refreshError } = await supabase.auth.mfa.listFactors();
        if (refreshError) throw enrollmentError;
        const refreshedFactors = refreshed?.totp || refreshed?.all || [];
        const alreadyVerified = refreshedFactors.find((factor) => factor.status === 'verified');
        if (alreadyVerified) {
          pendingMfaLoginRef.current = { user: sessionUser, factorId: alreadyVerified.id, isSetup: false };
          return { mfaRequired: true, mfaSetupRequired: false, role: sessionUser.role };
        }
        const staleFactors = refreshedFactors.filter((factor) => factor.status === 'unverified');
        for (const staleFactor of staleFactors) {
          const { error: cleanupError } = await supabase.auth.mfa.unenroll({ factorId: staleFactor.id });
          if (cleanupError) throw enrollmentError;
        }
        const { data: retryEnrollment, error: retryError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `SHELF sign-in ${Date.now()}` });
        if (retryError) throw retryError;
        pendingMfaLoginRef.current = { user: sessionUser, factorId: retryEnrollment.id, isSetup: true };
        return { mfaRequired: true, mfaSetupRequired: true, mfaQrCode: retryEnrollment.totp?.qr_code, mfaSecret: retryEnrollment.totp?.secret, role: sessionUser.role };
      }
      pendingMfaLoginRef.current = { user: sessionUser, factorId: enrollment.id, isSetup: true };
      return { mfaRequired: true, mfaSetupRequired: true, mfaQrCode: enrollment.totp?.qr_code, mfaSecret: enrollment.totp?.secret, role: sessionUser.role };
    }

    pendingMfaLoginRef.current = { user: sessionUser, factorId: verifiedFactor.id, isSetup: false };
    return { mfaRequired: true, mfaSetupRequired: false, role: sessionUser.role };
  };

  const completeMfaLogin = async (code) => {
    const pending = pendingMfaLoginRef.current;
    if (!pending) throw new Error('The MFA verification session expired. Sign in again.');
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: pending.factorId, code: String(code || '').trim() });
    if (error) throw error;
    pendingMfaLoginRef.current = null;
    setUser(pending.user);
    return pending.user;
  };

  const cancelMfaLogin = async () => {
    pendingMfaLoginRef.current = null;
    await logout();
  };

  // =========================================================
  // VISITOR LOGIN
  // =========================================================
  const loginVisitor = async ({ identifier, password }) => {
    try {
      const visitor = await store.loginVisitor({
        identifier,
        password,
      });
      if (!visitor) {
        throw new Error('Visitor account was not found.');
      }
      const visitorSession = createVisitorSession(visitor);
      const mfaStep = await beginMfaLogin(visitorSession, false);
      if (mfaStep) return { ...visitor, ...mfaStep };
      setUser(visitorSession);
      return visitor;
    } catch (error) {
      console.error('Visitor login error:', error);
      throw error;
    }
  };

  const loginVisitorWithPasskey = async () => {
    if (!supabase?.auth?.signInWithPasskey) {
      throw new Error('Passkey sign-in is unavailable in this browser. Use your password instead.');
    }
    try {
      const { data, error } = await supabase.auth.signInWithPasskey();
      if (error) throw error;
      const visitor = await store.fetchVisitorForPasskey(data?.user?.id);
      const visitorSession = createVisitorSession(visitor);
      const mfaStep = await beginMfaLogin(visitorSession, false);
      if (mfaStep) {
        return { success: true, role: 'visitor', user: visitor, ...mfaStep };
      }
      setUser(visitorSession);
      return { success: true, role: 'visitor', user: visitor };
    } catch (error) {
      await supabase?.auth?.signOut?.();
      const message = String(error?.message || 'Passkey sign-in failed.');
      if (message.includes('passkey_disabled') || /passkeys? (?:are )?disabled/i.test(message)) {
        throw new Error('Passkey sign-in is not enabled for SHELF yet. Use your password instead.', { cause: error });
      }
      if (message.includes('webauthn_credential_not_found')) {
        throw new Error('No passkey is registered for this account yet. Sign in with your password and set up a passkey in Account security.', { cause: error });
      }
      if (message.includes('NotAllowedError') || message.toLowerCase().includes('ceremony')) {
        throw new Error('Passkey sign-in was cancelled or could not be completed. Try again or use your password.', { cause: error });
      }
      throw error;
    }
  };

  // =========================================================
  // VISITOR SESSION
  // =========================================================
  const loginAsVisitorSession = (visitor) => {
    if (!visitor) {
      throw new Error('Visitor information is required.');
    }
    const visitorSession = createVisitorSession(visitor);
    setUser(visitorSession);
    return visitorSession;
  };

  // =========================================================
  // STAFF LOGIN
  // =========================================================
  const loginStaffAccount = async (email, password) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedPassword = String(password || '');

    if (!normalizedEmail) {
      throw new Error('Email is required.');
    }
    if (!normalizedPassword) {
      throw new Error('Password is required.');
    }

    try {
      const staff = await store.loginStaffAccount(
        normalizedEmail,
        normalizedPassword
      );
      if (!staff) {
        throw new Error('Staff profile was not found.');
      }
      const staffSession = createStaffSession(staff);
      const mfaStep = await beginMfaLogin(staffSession, ['subadmin', 'superadmin'].includes(staff.role));
      if (mfaStep) return { ...staff, ...mfaStep };
      setUser(staffSession);
      return staff;
    } catch (error) {
      console.error('STAFF LOGIN ERROR:', error);
      pendingMfaLoginRef.current = null;
      await supabase?.auth?.signOut?.();
      throw error;
    }
  };

  // =========================================================
  // SUB-ADMIN LOGIN
  // =========================================================
  const loginSubAdmin = async (email, password) => {
    const staff = await loginStaffAccount(email, password);
    if (!staff || staff.role !== 'subadmin') {
      try {
        if (supabase?.auth) {
          await supabase.auth.signOut();
        }
      } catch (error) {
        console.error('Sub-Admin sign-out error:', error);
      }
      setUser(null);
      throw new Error('This account is not registered as a Sub-Admin.');
    }
    return staff;
  };

  // =========================================================
  // SUPER ADMIN LOGIN
  // =========================================================
  const loginSuperAdmin = async (email, password) => {
    const staff = await loginStaffAccount(email, password);
    if (!staff || staff.role !== 'superadmin') {
      try {
        if (supabase?.auth) {
          await supabase.auth.signOut();
        }
      } catch (error) {
        console.error('Super Admin sign-out error:', error);
      }
      setUser(null);
      throw new Error('This account is not registered as a Super Admin.');
    }
    return staff;
  };

  // =========================================================
  // UNIFIED LOGIN
  // =========================================================
  const login = async ({ identifier, password }) => {
    const normalizedIdentifier = String(identifier || '').trim();
    const normalizedPassword = String(password || '');

    if (!normalizedIdentifier) {
      throw new Error('Email or visitor QR pass is required.');
    }

    // QR LOGIN
    if (!normalizedIdentifier.includes('@')) {
      try {
        const visitor = await store.loginVisitor({
          identifier: normalizedIdentifier,
          password: normalizedPassword,
        });
        if (!visitor) {
          throw new Error('Visitor account was not found.');
        }
        const visitorSession = createVisitorSession(visitor);
        const mfaStep = await beginMfaLogin(visitorSession, false);
        if (mfaStep) return { success: true, ...mfaStep, user: visitor };
        setUser(visitorSession);
        return {
          success: true,
          role: 'visitor',
          user: visitor,
        };
      } catch (error) {
        console.error('QR VISITOR LOGIN FAILED:', error);
        throw error;
      }
    }

    if (!normalizedPassword) {
      throw new Error('Password is required.');
    }

    // 1. TRY VISITOR LOGIN FIRST
    let visitorError;
    try {
      const visitor = await store.loginVisitor({
        identifier: normalizedIdentifier,
        password: normalizedPassword,
      });
      if (visitor) {
        const visitorSession = createVisitorSession(visitor);
        const mfaStep = await beginMfaLogin(visitorSession, false);
        if (mfaStep) return { success: true, ...mfaStep, user: visitor };
        setUser(visitorSession);
        return {
          success: true,
          role: 'visitor',
          user: visitor,
        };
      }
      visitorError = new Error('Visitor account was not found.');
    } catch (error) {
      visitorError = error;
      console.error('VISITOR LOGIN ATTEMPT FAILED:', error);
    }

    // Email/password authentication is shared by visitor and staff accounts.
    // If it failed, trying the staff path repeats the same request and counts
    // as another failed attempt against the same lockout record.
    const visitorLoginMessage = String(visitorError?.message || '').trim();
    if (
      /invalid email or password|too many failed login attempts|unable to (?:process|complete) login/i.test(
        visitorLoginMessage
      )
    ) {
      throw visitorError;
    }

    // 2. TRY STAFF LOGIN
    try {
      const staff = await loginStaffAccount(
        normalizedIdentifier,
        normalizedPassword
      );
      if (!staff) {
        throw new Error('Staff profile was not found.');
      }
      return {
        success: true,
        role: staff.role,
        user: staff,
        mfaRequired: staff.mfaRequired,
        mfaSetupRequired: staff.mfaSetupRequired,
        mfaQrCode: staff.mfaQrCode,
        mfaSecret: staff.mfaSecret,
      };
    } catch (staffError) {
      console.error('STAFF LOGIN ATTEMPT FAILED:', staffError);

      const staffErrorMessage = String(staffError?.message || '').trim();

      if (staffErrorMessage === 'This staff account is currently inactive.') {
        throw staffError;
      }

      if (staffErrorMessage === 'Invalid login credentials') {
        throw visitorError || staffError;
      }

      if (
        staffErrorMessage ===
        'This account has not been provisioned as a SHELF staff account.'
      ) {
        throw visitorError || staffError;
      }

      throw staffError;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        logout,
        keepSessionAlive,
        registerVisitor,
        verifyVisitorOtp,
        resendVisitorOtp,
        resendVisitorOtpByEmail,
        establishVisitorSessionFromQr,
        requestPasswordResetCode,
        verifyPasswordResetCode,
        applyPasswordReset,
        loginVisitor,
        loginVisitorWithPasskey,
        loginAsVisitorSession,
        loginStaffAccount,
        loginSubAdmin,
        loginSuperAdmin,
        login,
        completeMfaLogin,
        cancelMfaLogin,
      }}
    >
      {children}
      {user && idleSecondsRemaining !== null && (
        <div
          className="fixed inset-0 z-[9999] grid place-items-center bg-slate-950/60 p-4"
          data-idle-session-warning
        >
          <section
            aria-labelledby="idle-session-title"
            aria-describedby="idle-session-description"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            role="dialog"
          >
            <h2
              className="text-xl font-semibold text-slate-900"
              id="idle-session-title"
            >
              Are you still there?
            </h2>
            <p
              className="mt-2 text-sm leading-6 text-slate-600"
              id="idle-session-description"
            >
              You have been inactive for 5 minutes. You will be logged out in{' '}
              <span className="font-semibold tabular-nums">
                {Math.floor(idleSecondsRemaining / 60)}:
                {String(idleSecondsRemaining % 60).padStart(2, '0')}
              </span>{' '}
              unless you choose to stay logged in.
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                onClick={() => void logout()}
                type="button"
              >
                Log out
              </button>
              <button
                autoFocus
                className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                onClick={() => resetIdleTimerRef.current?.()}
                type="button"
              >
                Stay logged in
              </button>
            </div>
          </section>
        </div>
      )}
    </AuthContext.Provider>
  );
};
