import { useCallback, useEffect, useRef, useState } from 'react';
import * as store from '../data/store.js';
import { AuthContext } from './authContext.js';
import { supabase } from '../lib/supabaseClient.js';
import {
  normalizeVisitorRegistrationType,
  validateVisitorRegistrationEmail,
  VISITOR_REGISTRATION_TYPES,
} from '../lib/visitorRegistration.js';

const SESSION_KEY = 'shelf_ilms_session_v1';
const SESSION_ACTIVITY_KEY = 'shelf_ilms_last_activity_v1';
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const IDLE_WARNING_TIMEOUT_MS = 5 * 60 * 1000;

const reportClientError = (context, error = null, correlationId = null) => {
  // Avoid logging tokens, credentials, OTPs, PII, or raw provider errors.
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    const cid = correlationId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null);
    const cidPrefix = cid ? `[cid:${cid}] ` : '';
    if (error && typeof error === 'object') {
      const sanitizedStatus = error.status || error.statusCode || error.status_code || null;
      const sanitizedCode = error.code || error.name || null;
      const details = [
        sanitizedStatus ? `status=${sanitizedStatus}` : null,
        sanitizedCode ? `code=${sanitizedCode}` : null,
      ].filter(Boolean).join(' ');
      console.error(`[SHELF] ${cidPrefix}${context}${details ? ` (${details})` : ''}`);
    } else {
      console.error(`[SHELF] ${cidPrefix}${context}`);
    }
  }
};

const notifyVisitorSessionChanged = () => {
  try {
    window.dispatchEvent(new Event('shelf:visitor-session-changed'));
  } catch {
    reportClientError('Visitor session event dispatch failed.');
  }
};

function getUserIdentityKey(user) {
  if (!user) return 'anonymous';
  return `${user.id}|${user.role}|${user.libraryId || 'none'}`;
}

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
      // Staff profiles are only a UI snapshot; they do not prove that the
      // current Supabase token has completed MFA. Always require staff to
      // establish a fresh Supabase session so protected staff RPCs run with
      // the AAL2 token produced by the MFA challenge.
      if (['subadmin', 'superadmin'].includes(restoredUser?.role)) {
        globalThis.localStorage.removeItem(SESSION_KEY);
        return null;
      }
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
    } catch {
      reportClientError('Failed to restore local session state.');
      try {
        globalThis.localStorage.removeItem(SESSION_KEY);
      } catch {
        // Ignore cleanup errors.
      }
      return null;
    }
  });
  const [authLoading, setAuthLoading] = useState(Boolean(supabase?.auth));
  const persistedUserSnapshotRef = useRef(JSON.stringify(user));
  const pendingMfaLoginRef = useRef(null);
  const [idleSecondsRemaining, setIdleSecondsRemaining] = useState(null);
  const resetIdleTimerRef = useRef(null);
  const idleWarningActiveRef = useRef(false);
  const sessionGenerationRef = useRef(0);
  const previousUserIdentityRef = useRef(getUserIdentityKey(user));

  const clearClientSessionState = useCallback(() => {
    pendingMfaLoginRef.current = null;
    setIdleSecondsRemaining(null);
    setUser(null);
    try {
      store.invalidateClientCaches();
    } catch {
      reportClientError('Failed to clear client caches.');
    }
    try {
      globalThis.localStorage.removeItem(SESSION_KEY);
      globalThis.localStorage.removeItem(SESSION_ACTIVITY_KEY);
      globalThis.sessionStorage.clear();
    } catch {
      reportClientError('Failed to clear browser session state.');
    }
  }, []);

  const setUserWithIdentityTracking = useCallback((newUser) => {
    const nextIdentity = getUserIdentityKey(newUser);
    const prevIdentity = previousUserIdentityRef.current;

    if (nextIdentity !== prevIdentity) {
      // User identity changed (different user, role, or library) - increment generation
      // to invalidate any in-flight requests from the previous session
      sessionGenerationRef.current += 1;
      previousUserIdentityRef.current = nextIdentity;

      // Clear caches when user/role/library changes
      try {
        store.invalidateClientCaches();
      } catch {
        reportClientError('Failed to clear client caches on identity change.');
      }
    }

    setUser(newUser);
  }, []);

  const logout = useCallback(async () => {
    try {
      if (supabase?.auth) {
        await supabase.auth.signOut();
      }
    } catch {
      reportClientError('Sign-out request failed.');
    }
    clearClientSessionState();
  }, [clearClientSessionState]);

  const keepSessionAlive = useCallback(() => {
    resetIdleTimerRef.current?.();
  }, []);

  useEffect(() => {
    if (!supabase?.auth) {
      return undefined;
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        clearClientSessionState();
        setAuthLoading(false);
        return;
      }
      if (event === 'INITIAL_SESSION' && !session) {
        setUser((current) => (current ? null : current));
        setAuthLoading(false);
      }
      if (event === 'INITIAL_SESSION' && session?.user?.id) {
        // Reload-safe staff auth: only restore a DB-backed active profile when
        // the persisted Supabase access token still carries verified AAL2.
        queueMicrotask(async () => {
          try {
            const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
            if (assurance?.currentLevel === 'aal2') {
              const staff = await store.getAuthenticatedStaffProfile();
              if (staff && staff.id === session.user.id) {
                setUserWithIdentityTracking({
                  id: staff.id,
                  role: staff.role,
                  name: staff.name,
                  email: staff.email,
                  libraryId: staff.libraryId,
                });
              }
            }
          } catch {
            reportClientError('Staff session restore failed.');
          } finally {
            setAuthLoading(false);
          }
        });
      }
    });

    return () => subscription.unsubscribe();
  }, [clearClientSessionState, setUserWithIdentityTracking]);

  useEffect(() => {
    if (!user?.id) return undefined;

    // The attendance kiosk is a continuously running staff workstation. Its
    // dedicated route should not sign the librarian out while the camera is
    // waiting for visitors to scan their QR passes.
    const isSubadminAttendanceKiosk = user.role === 'subadmin'
      && window.location.pathname.replace(/\/+$/, '') === '/subadmin/attendance-kiosk';
    if (isSubadminAttendanceKiosk) {
      resetIdleTimerRef.current = null;
      return undefined;
    }

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
        } catch {
      reportClientError('');
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
    window.addEventListener('pointermove', handleActivity, { passive: true });
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('touchstart', handleActivity, { passive: true });
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
      window.removeEventListener('storage', handleStorage);
    };
  }, [user?.id, user?.role, logout]);

useEffect(() => {
    if (user?.role !== 'visitor' || !user.id) return undefined;

    let cancelled = false;
    const refreshForUserId = user.id;
    const refreshGeneration = sessionGenerationRef.current;

    const refreshVisitorProfile = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.user?.id) {
          if (!cancelled) clearClientSessionState();
          return;
        }

        const visitor = await store.getVisitor(session.user.id);
        if (cancelled) return;
        if (!visitor || String(visitor.id) !== String(refreshForUserId)) {
          // Session/profile mismatch or missing profile: fail closed.
          clearClientSessionState();
          return;
        }

        // Prevent stale response from overwriting newer session state
        if (refreshGeneration !== sessionGenerationRef.current) {
          return;
        }

        // If visitor became a pending community visitor (should not happen for active sessions),
        // clear the session and redirect to pending-approval.
        if (visitor.communityApprovalPending === true) {
          if (!cancelled) {
            try {
              globalThis.sessionStorage.setItem('pending_visitor_id', visitor.id);
            } catch {
              // Ignore
            }
            clearClientSessionState();
          }
          return;
        }

        setUserWithIdentityTracking((current) => {
          if (!current || current.role !== 'visitor' || current.id !== visitor.id) {
            return current;
          }
          // Validate critical eligibility fields - fail closed if account becomes ineligible
          if (visitor.isActive === false) {
            // Account deactivated: log out
            setTimeout(() => clearClientSessionState(), 0);
            return current;
          }
          if (visitor.otpVerified !== true) {
            // Email verification revoked: log out
            setTimeout(() => clearClientSessionState(), 0);
            return current;
          }
          // Only update if the Supabase session still belongs to this visitor.
          return {
            ...current,
            name: visitor.fullName,
            email: visitor.email,
            qrCode: visitor.qrCode,
            libraryId: visitor.libraryId,
            registrationType: visitor.registrationType || current.registrationType,
            communityApprovalPending: false,
          };
        });
      } catch {
        reportClientError('Visitor profile refresh failed.');
      }
    };

    void refreshVisitorProfile();

    return () => {
      cancelled = true;
    };
  }, [user?.role, user?.id, clearClientSessionState, setUserWithIdentityTracking]);

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
    } catch {
      reportClientError('');
    }
  }, [user]);

  // =========================================================
  // VISITOR REGISTRATION: server-side validation remains authoritative.
  // =========================================================
  const registerVisitor = async (formData) => {
    try {
      const targetEmail = (formData.email || formData.studentEmail || '').toLowerCase().trim();
      const selectedLibraryId = String(formData.libraryId || '').trim();
      const registrationType = formData.registrationType == null
        ? VISITOR_REGISTRATION_TYPES.INSTITUTIONAL
        : normalizeVisitorRegistrationType(formData.registrationType);
      if (!registrationType) throw new Error('Select a valid visitor registration type.');

      if (!targetEmail) {
        throw new Error('Please enter a valid email address.');
      }
      if (!selectedLibraryId) {
        throw new Error('Select your preferred library.');
      }

      const { data: libraryRecords } = await supabase
        .from('libraries')
        .select('id, email_domain')
        .eq('id', selectedLibraryId);

      if (!libraryRecords) { throw new Error('Failed to verify the selected library.'); }

      const selectedLibrary = libraryRecords?.[0];
      if (!selectedLibrary) throw new Error('Select a valid preferred library.');
      const emailError = validateVisitorRegistrationEmail(
        targetEmail,
        registrationType,
        selectedLibrary.email_domain,
      );
      if (emailError) throw new Error(emailError);

      return await store.registerVisitor({ ...formData, registrationType });
    } catch (e) {
      reportClientError('Operation failed.');
      throw e;
    }
  };

  // =========================================================
  // VISITOR OTP VERIFICATION
  // =========================================================
  const verifyVisitorOtp = async (visitorId, code) => {
    try {
      return await store.verifyVisitorOtp(visitorId, code);
    } catch (e) {
      reportClientError('Operation failed.');
      throw e;
    }
  };

  // =========================================================
  // RESEND VISITOR OTP
  // =========================================================
  const resendVisitorOtp = async (visitorId) => {
    try {
      return await store.resendOtp(visitorId);
    } catch (e) {
      reportClientError('Operation failed.');
      throw e;
    }
  };

  // =========================================================
  // RESEND VISITOR OTP BY EMAIL
  // =========================================================
  const resendVisitorOtpByEmail = async (email) => {
    try {
      return await store.resendVisitorOtpByEmail(email);
    } catch (e) {
      reportClientError('Operation failed.');
      throw e;
    }
  };

  // =========================================================
  // PASSWORD RESET
  // =========================================================
  const requestPasswordResetCode = async (email, accountKind) => {
    try {
      return await store.requestPasswordResetCode(email, accountKind);
    } catch (e) {
      reportClientError('Operation failed.');
      throw e;
    }
  };

  const verifyPasswordResetCode = async (email, code) => {
    try {
      return await store.verifyPasswordResetCode(email, code);
    } catch (e) {
      reportClientError('Operation failed.');
      throw e;
    }
  };

  const applyPasswordReset = async (input) => {
    try {
      return await store.applyPasswordReset(input);
    } catch (e) {
      reportClientError('Operation failed.');
      throw e;
    }
  };

// =========================================================
  // BUILD VISITOR SESSION
  // =========================================================
  const createVisitorSession = (visitor) => {
    if (!visitor?.id) {
      throw new Error('Visitor information is incomplete.');
    }
    const communityApprovalPending = visitor.communityApprovalPending === true;
    // Pending community visitors do NOT get a full session.
    // They are redirected to the pending-approval page with visitor_id in query params.
    if (communityApprovalPending) {
      try {
        globalThis.sessionStorage.setItem('pending_visitor_id', visitor.id);
      } catch {
        // Ignore storage errors
      }
      return null;
    }
    return {
      role: 'visitor',
      id: visitor.id,
      name: visitor.fullName,
      email: visitor.email,
      qrCode: visitor.qrCode,
      libraryId: visitor.libraryId,
      registrationType: visitor.registrationType || VISITOR_REGISTRATION_TYPES.INSTITUTIONAL,
      communityApprovalPending: false,
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
    const { data } = await supabase.auth.mfa.listFactors();
    const factors = data?.totp || data?.all || [];
    const verifiedFactor = factors.find((factor) => factor.status === 'verified');
    if (!verifiedFactor && !required) return null;

    if (!verifiedFactor) {
      const pendingFactors = factors.filter((factor) => factor.status === 'unverified');
      for (const pendingFactor of pendingFactors) {
        const { error: _unenrollError } = await supabase.auth.mfa.unenroll({ factorId: pendingFactor.id });
        if (_unenrollError) throw new Error('An unfinished authenticator setup is attached to this account. Sign in again, then retry MFA setup.');
      }
      const { data: enrollment, error: enrollmentError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `SHELF sign-in ${Date.now()}` });
      if (enrollmentError) {
        // Factor names are unique. Refresh once in case a previous setup left an
        // unverified factor behind or another request completed enrollment.
        const { data: refreshed } = await supabase.auth.mfa.listFactors(); if (!refreshed) throw enrollmentError;
        const refreshedFactors = refreshed?.totp || refreshed?.all || [];
        const alreadyVerified = refreshedFactors.find((factor) => factor.status === 'verified');
        if (alreadyVerified) {
          pendingMfaLoginRef.current = { user: sessionUser, factorId: alreadyVerified.id, isSetup: false };
          return { mfaRequired: true, mfaSetupRequired: false, role: sessionUser.role };
        }
        const staleFactors = refreshedFactors.filter((factor) => factor.status === 'unverified');
        for (const staleFactor of staleFactors) {
          const { error: _cleanupError } = await supabase.auth.mfa.unenroll({ factorId: staleFactor.id });
          if (_cleanupError) throw enrollmentError;
        }
        const { data: retryEnrollment } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `SHELF sign-in ${Date.now()}` });
        if (!retryEnrollment) throw enrollmentError;
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
    const { error: _challengeError } = await supabase.auth.mfa.challengeAndVerify({ factorId: pending.factorId, code: String(code || '').trim() });
    if (_challengeError) throw _challengeError;

    if (['subadmin', 'superadmin'].includes(pending.user?.role)) {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id || session.user.id !== pending.user.id) {
        throw new Error('The verified staff session could not be confirmed. Sign in again.');
      }

      const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance?.currentLevel !== 'aal2') {
        throw new Error('AAL2 verification was not confirmed. Complete MFA and try again.');
      }
    }

    pendingMfaLoginRef.current = null;
    setUserWithIdentityTracking(pending.user);
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
      if (!visitorSession) {
        // Pending community visitor - no session created, redirect to pending-approval
        return { pendingApproval: true, visitorId: visitor.id };
      }
      const mfaStep = await beginMfaLogin(visitorSession, false);
      if (mfaStep) return { ...visitor, ...mfaStep };
      setUserWithIdentityTracking(visitorSession);
      return visitorSession;
    } catch (e) {
      reportClientError('Operation failed.');
      throw e;
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
      if (!visitorSession) {
        return { pendingApproval: true, visitorId: visitor.id };
      }
      const mfaStep = await beginMfaLogin(visitorSession, false);
      if (mfaStep) {
        return { success: true, role: visitorSession.role, user: visitor, ...mfaStep };
      }
      setUserWithIdentityTracking(visitorSession);
      return { success: true, role: visitorSession.role, user: visitor };
    } catch (e) {
      await supabase?.auth?.signOut?.().catch(() => {});
      const message = String(e?.message || 'Passkey sign-in failed.');
      if (message.includes('passkey_disabled') || /passkeys? (?:are )?disabled/i.test(message)) {
        throw new Error('Passkey sign-in is not enabled for SHELF yet. Use your password instead.', { cause: e });
      }
      if (message.includes('webauthn_credential_not_found')) {
        throw new Error('No passkey is registered for this account yet. Sign in with your password and set up a passkey in Account security.', { cause: e });
      }
      if (message.includes('NotAllowedError') || message.toLowerCase().includes('ceremony')) {
        throw new Error('Passkey sign-in was cancelled or could not be completed. Try again or use your password.', { cause: e });
      }
      reportClientError('Passkey sign-in failed.');
      throw e;
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
    if (!visitorSession) {
      return { pendingApproval: true, visitorId: visitor.id };
    }
    setUserWithIdentityTracking(visitorSession);
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
      setUserWithIdentityTracking(staffSession);
      return staff;
    } catch (e) {
      reportClientError('Staff login failed.');
      pendingMfaLoginRef.current = null;
      await supabase?.auth?.signOut?.().catch(() => {});
      throw e;
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
      } catch {
      reportClientError('');
      }
      setUserWithIdentityTracking(null);
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
      } catch {
      reportClientError('');
      }
      setUserWithIdentityTracking(null);
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
      throw new Error('Email is required.');
    }

    if (!normalizedIdentifier.includes('@')) {
      throw new Error('Sign in with your email address. QR passes are for library identification.');
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
        if (!visitorSession) {
          // Pending community visitor
          return { pendingApproval: true, visitorId: visitor.id };
        }
        const mfaStep = await beginMfaLogin(visitorSession, false);
        if (mfaStep) return { success: true, ...mfaStep, user: visitor };
        setUserWithIdentityTracking(visitorSession);
        return {
          success: true,
          role: 'visitor',
          user: visitor,
        };
      }
      visitorError = new Error('Visitor account was not found.');
    } catch (e) {
      visitorError = e;
      reportClientError('Visitor login attempt failed.');
    }

    // Email/password authentication is shared by visitor and staff accounts.
    // If it failed, trying the staff path repeats the same request and counts
    // as another failed attempt against the same lockout record.
    const visitorLoginMessage = String(visitorError?.message || '').trim();
    if (
      /invalid email or password|too many failed login attempts|unable to (?:process|complete) login|email (?:(?:has )?not been|not) confirmed|please verify your otp|account is currently inactive/i.test(
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
      reportClientError('');

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
        authLoading,
        logout,
        keepSessionAlive,
        registerVisitor,
        verifyVisitorOtp,
        resendVisitorOtp,
        resendVisitorOtpByEmail,
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
