import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ParticleConstellation from '../../component/ParticleConstellation.jsx';
import { QRCodeSVG } from 'qrcode.react';
import { philippines } from '@ianlabicani/geoph-lite';
import {
  Eye,
  EyeOff,
  ArrowLeft,
  Fingerprint,
} from 'lucide-react';

import { useAuth } from '../../context/useAuth.js';

import { validateVisitorFullName } from '../../lib/visitorValidation.js';
import { fetchLibraries } from '../../data/store.js';

const OTP_CODE_TTL_SECONDS = 10 * 60;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const RESET_CODE_TTL_SECONDS = 10 * 60;
const RESET_CODE_RESEND_COOLDOWN_SECONDS = 60;
const preventPasswordClipboard = (event) => event.preventDefault();

function getInternalReturnPath(from) {
  const returnPath =
    typeof from === 'string'
      ? from
      : from && typeof from.pathname === 'string'
        ? `${from.pathname}${from.search || ''}${from.hash || ''}`
        : '';

  if (
    !returnPath.startsWith('/') ||
    returnPath.startsWith('//') ||
    returnPath.includes('\\')
  ) {
    return null;
  }

  const returnUrl = new URL(returnPath, window.location.origin);
  return returnUrl.origin === window.location.origin
    ? `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`
    : null;
}

// =========================================================
// PASSWORD REQUIREMENT COMPONENT
// =========================================================

function PasswordRequirement({ valid, children }) {
  return (
    <li
      className={`flex items-center gap-2 ${
        valid
          ? 'text-green-600'
          : 'text-slate-500'
      }`}
    >
      <span>{children}</span>
    </li>
  );
}

// =========================================================
// VISITOR LOGIN
// =========================================================

export default function VisitorLogin({ initialView = 'login' }) {
  const navigate = useNavigate();
  const location = useLocation();

  const {
    registerVisitor,
    verifyVisitorOtp,
    resendVisitorOtp,
    resendVisitorOtpByEmail,
    requestPasswordResetCode,
    verifyPasswordResetCode,
    applyPasswordReset,
    login,
    loginVisitorWithPasskey,
    completeMfaLogin,
    cancelMfaLogin,
  } = useAuth();

  // =========================================================
  // STATE
  // =========================================================

  const [view, setView] = useState(initialView);
  const [error, setError] = useState('');
  const [libraries, setLibraries] = useState([]);
  const [librariesLoading, setLibrariesLoading] = useState(true);
  const [libraryLoadError, setLibraryLoadError] = useState('');
  const [selectedLibraryId, setSelectedLibraryId] = useState('');
  const [canResendVisitorOtp, setCanResendVisitorOtp] =
    useState(false);
  const [otpExpiresAt, setOtpExpiresAt] = useState(null);
  const [otpResendAvailableAt, setOtpResendAvailableAt] =
    useState(null);
  const [otpTimeRemaining, setOtpTimeRemaining] = useState(0);
  const [otpResendRemaining, setOtpResendRemaining] = useState(0);
  const [isOtpResending, setIsOtpResending] = useState(false);
  const [mfaPending, setMfaPending] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  const [isMfaSubmitting, setIsMfaSubmitting] = useState(false);

  const [
    isResendingVisitorOtp,
    setIsResendingVisitorOtp,
  ] = useState(false);

  // =========================================================
  // FORGOT PASSWORD
  //
  // Two steps. The code is emailed, then it is exchanged for a
  // new password. resetStep moves between them.
  // =========================================================

  const [
    resetStep,
    setResetStep,
  ] = useState('request');

  const [
    resetEmail,
    setResetEmail,
  ] = useState('');

  const [
    resetCode,
    setResetCode,
  ] = useState('');

  const [
    resetPassword,
    setResetPassword,
  ] = useState('');

  const [
    resetConfirmPassword,
    setResetConfirmPassword,
  ] = useState('');

  const [
    resetNotice,
    setResetNotice,
  ] = useState('');

  const [
    isResetSubmitting,
    setIsResetSubmitting,
  ] = useState(false);

  const [resetExpiresAt, setResetExpiresAt] =
    useState(null);
  const [resetResendAvailableAt, setResetResendAvailableAt] =
    useState(null);
  const [resetTimeRemaining, setResetTimeRemaining] =
    useState(0);
  const [resetResendRemaining, setResetResendRemaining] =
    useState(0);

  const [
    showResetPassword,
    setShowResetPassword,
  ] = useState(false);

  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);

  
useEffect(() => {
  if (view !== 'forgot' || resetStep !== 'verify') {
    return undefined;
  }

  const updateResetCountdown = () => {
    const now = Date.now();

    const remaining = resetExpiresAt
      ? Math.max(0, Math.ceil((resetExpiresAt - now) / 1000))
      : 0;

    const resendRemaining = resetResendAvailableAt
      ? Math.max(0, Math.ceil((resetResendAvailableAt - now) / 1000))
      : 0;

    setResetTimeRemaining((previous) =>
      previous === remaining ? previous : remaining
    );

    setResetResendRemaining((previous) =>
      previous === resendRemaining ? previous : resendRemaining
    );
  };

  updateResetCountdown();

  const timer = setInterval(updateResetCountdown, 1000);

  return () => clearInterval(timer);
}, [
  view,
  resetStep,
  resetExpiresAt,
  resetResendAvailableAt,
]);

  useEffect(() => {
    if (view !== 'otp') {
      return undefined;
    }

    const updateOtpCountdown = () => {
      const now = Date.now();
      setOtpTimeRemaining(
        otpExpiresAt
          ? Math.max(0, Math.ceil((otpExpiresAt - now) / 1000))
          : 0
      );
      setOtpResendRemaining(
        otpResendAvailableAt
          ? Math.max(0, Math.ceil((otpResendAvailableAt - now) / 1000))
          : 0
      );
    };

    updateOtpCountdown();
    const timer = setInterval(updateOtpCountdown, 1000);
    return () => clearInterval(timer);
  }, [otpExpiresAt, otpResendAvailableAt, view]);

  const resetPasswordValid =
    resetPassword.length >= 12 &&
    /[A-Z]/.test(resetPassword) &&
    /[a-z]/.test(resetPassword) &&
    /[0-9]/.test(resetPassword) &&
    /[^A-Za-z0-9]/.test(resetPassword);

  const resetPasswordsMatch =
    resetPassword.length > 0 &&
    resetPassword ===
      resetConfirmPassword;

  const [fieldErrors, setFieldErrors] = useState({
    fullName: '',
    contactNumber: '',
    email: '',
    libraryId: '',
    province: '',
    city: '',
    barangay: '',
    password: '',
    confirmPassword: '',
  });

  useEffect(() => {
    let cancelled = false;
    fetchLibraries()
      .then((libraryList) => {
        if (!cancelled) {
          setLibraries(
            libraryList.filter((library) =>
              String(library.emailDomain || '').trim()
            )
          );
        }
      })
      .catch((loadError) => {
        console.error('Failed to load registration library list:', loadError);
        if (!cancelled) {
          setLibraryLoadError(
            'Unable to load library branches. Please refresh and try again.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLibrariesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // IMPORTANT:
  // This is a synchronous lock.
  // It prevents two submit events from entering
  // registerVisitor before React has rendered again.
  const registrationLockRef = useRef(false);

  const loginRequestLockRef = useRef(false);

  const [isRegistering, setIsRegistering] =
    useState(false);

  const [showLoginPassword, setShowLoginPassword] =
    useState(false);

  const [
    showRegisterPassword,
    setShowRegisterPassword,
  ] = useState(false);

  const [
    showConfirmPassword,
    setShowConfirmPassword,
  ] = useState(false);

  const [formData, setFormData] = useState({
    fullName: '',
    contactNumber: '',
    email: '',
    address: '',
    password: '',
    confirmPassword: '',
  });

  
  const [selectedProvince, setSelectedProvince] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [barangay, setBarangay] = useState('');

  const [provinceOptions, setProvinceOptions] = useState([]);
  const [cityOptions, setCityOptions] = useState([]);
  const [barangayOptions, setBarangayOptions] = useState([]);
  const [locationLoading, setLocationLoading] = useState(false);

  
  // Load all Philippine provinces on mount.
  useEffect(() => {
    let cancelled = false;

    const loadProvinces = async () => {
      try {
        setLocationLoading(true);

        const regions = philippines.regions();

        const provinceGroups = await Promise.all(
          regions.map((region) =>
            philippines.provinces(region.psgc_code)
          )
        );

        if (!cancelled) {
          const provinces = provinceGroups
            .flat()
            .sort((a, b) => a.name.localeCompare(b.name));

          setProvinceOptions(provinces);
        }
      } catch (err) {
        console.error('Failed to load provinces:', err);
        if (!cancelled) {
          setError('Unable to load the province list. Please refresh and try again.');
        }
      } finally {
        if (!cancelled) {
          setLocationLoading(false);
        }
      }
    };

    loadProvinces();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load cities and municipalities for the selected province.
  useEffect(() => {
    let cancelled = false;

    const loadCities = async () => {
      setCityOptions([]);
      setBarangayOptions([]);

      if (!selectedProvince) return;

      const province = provinceOptions.find(
        (item) => item.name === selectedProvince
      );

      if (!province) return;

      try {
        setLocationLoading(true);

        const localities = await philippines.localities(
          province.psgc_code
        );

        if (!cancelled) {
          setCityOptions(
            localities.sort((a, b) => a.name.localeCompare(b.name))
          );
        }
      } catch (err) {
        console.error('Failed to load cities/municipalities:', err);
      } finally {
        if (!cancelled) {
          setLocationLoading(false);
        }
      }
    };

    loadCities();

    return () => {
      cancelled = true;
    };
  }, [selectedProvince, provinceOptions]);

  // Load barangays for the selected city or municipality.
  useEffect(() => {
    let cancelled = false;

    const loadBarangays = async () => {
      setBarangayOptions([]);

      if (!selectedCity) return;

      const locality = cityOptions.find(
        (item) => item.name === selectedCity
      );

      if (!locality) return;

      try {
        setLocationLoading(true);

        const barangays = await philippines.barangays(
          locality.psgc_code
        );

        if (!cancelled) {
          setBarangayOptions(
            barangays.sort((a, b) => a.name.localeCompare(b.name))
          );
        }
      } catch (err) {
        console.error('Failed to load barangays:', err);
      } finally {
        if (!cancelled) {
          setLocationLoading(false);
        }
      }
    };

    loadBarangays();

    return () => {
      cancelled = true;
    };
  }, [selectedCity, cityOptions]);

  const [loginData, setLoginData] = useState({
    identifier: '',
    password: '',
  });
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [otpInput, setOtpInput] =
    useState('');

  const [
    pendingVisitorId,
    setPendingVisitorId,
  ] = useState(null);

  const [pendingEmail, setPendingEmail] =
    useState('');

  const [
    registeredVisitor,
    setRegisteredVisitor,
  ] = useState(null);

  // =========================================================
  // PASSWORD VALIDATION
  // =========================================================

  const passwordRequirements = {
    minLength:
      formData.password.length >= 12,

    uppercase:
      /[A-Z]/.test(formData.password),

    lowercase:
      /[a-z]/.test(formData.password),

    number:
      /[0-9]/.test(formData.password),

    special:
      /[^A-Za-z0-9]/.test(
        formData.password
      ),
  };

  const isPasswordValid =
    passwordRequirements.minLength &&
    passwordRequirements.uppercase &&
    passwordRequirements.lowercase &&
    passwordRequirements.number &&
    passwordRequirements.special;

  const passwordsMatch =
    formData.password.length > 0 &&
    formData.password ===
      formData.confirmPassword;

  // =========================================================

  const handleLogin = async (
    event
  ) => {
    event.preventDefault();

    if (loginRequestLockRef.current) return;

    setError('');
    setCanResendVisitorOtp(false);

    const identifier =
      loginData.identifier.trim();

    const password =
      loginData.password;

    if (!identifier) {
      setError(
        'Please enter your school email address.'
      );

      return;
    }

    if (!password) {
      setError(
        'Please enter your password.'
      );

      return;
    }

    loginRequestLockRef.current = true;

    try {
      setIsLoggingIn(true);
      const result =
        await login({
          identifier,
          password,
        });

      if (result?.mfaRequired) {
        setMfaPending(result);
        setMfaCode('');
        setView('mfa');
        return;
      }

      if (
        result?.role ===
        'visitor'
      ) {
        navigate(
          getInternalReturnPath(location.state?.from) || '/visitor'
        );
      } else if (
        result?.role ===
        'subadmin'
      ) {
        navigate('/subadmin');
      } else if (
        result?.role ===
        'superadmin'
      ) {
        navigate('/superadmin');
      } else {
        setError(
          'Unknown account role.'
        );
      }
    } catch (err) {
      const message = String(
        err?.message ||
          'Invalid email/ID or password.'
      );

      const lowerMessage =
        message.toLowerCase();

      if (
        lowerMessage.includes(
          'email has not been confirmed'
        ) ||
        lowerMessage.includes(
          'email not confirmed'
        ) ||
        lowerMessage.includes(
          'email is not confirmed'
        ) ||
        lowerMessage.includes(
          'verify your otp code before logging in'
        )
      ) {
        setCanResendVisitorOtp(
          true
        );

        setError(
          'This visitor account has not completed verification. Request a new verification code to continue.'
        );
      } else {
        setError(message);
      }
    } finally {
      loginRequestLockRef.current = false;
      setIsLoggingIn(false);
    }
  };

  const handlePasskeyLogin = async () => {
    if (loginRequestLockRef.current) return;
    loginRequestLockRef.current = true;
    setError('');
    setCanResendVisitorOtp(false);
    try {
      setIsLoggingIn(true);
      const result = await loginVisitorWithPasskey();
      if (result?.mfaRequired) {
        setMfaPending(result);
        setMfaCode('');
        setView('mfa');
      } else if (result?.role === 'visitor') {
        navigate(getInternalReturnPath(location.state?.from) || '/visitor');
      } else {
        setError('This passkey is not linked to a visitor account.');
      }
    } catch (err) {
      setError(err?.message || 'Passkey sign-in failed. Use your password or try again.');
    } finally {
      setIsLoggingIn(false);
      loginRequestLockRef.current = false;
    }
  };

  const handleVerifyLoginMfa = async (event) => {
    event.preventDefault();
    if (isMfaSubmitting) return;
    setError('');
    setIsMfaSubmitting(true);
    try {
      const verified = await completeMfaLogin(mfaCode);
      setMfaPending(null);
      setMfaCode('');
      if (verified?.role === 'visitor') navigate(getInternalReturnPath(location.state?.from) || '/visitor');
      else if (verified?.role === 'subadmin') navigate('/subadmin');
      else if (verified?.role === 'superadmin') navigate('/superadmin');
      else setError('Unknown account role.');
    } catch (verifyError) {
      setError(verifyError?.message || 'The verification code is invalid or expired.');
    } finally {
      setIsMfaSubmitting(false);
    }
  };

  const handleCancelMfaLogin = async () => {
    setIsMfaSubmitting(true);
    try { await cancelMfaLogin(); } finally {
      setMfaPending(null);
      setMfaCode('');
      setView('login');
      setIsMfaSubmitting(false);
    }
  };

  // =========================================================
  // UNCONFIRMED EMAIL MESSAGE
  // =========================================================

  const handleResendUnconfirmedVisitorOtp =
    async () => {
      const email =
        loginData.identifier
          .trim()
          .toLowerCase();

      if (!email.includes('@')) {
        return;
      }

      setError('');

      setIsResendingVisitorOtp(
        true
      );

      try {
        const result =
          await resendVisitorOtpByEmail(
            email
          );

        setCanResendVisitorOtp(
          false
        );

        // Only route to the code entry screen when a
        // registration was actually found. The response
        // is intentionally the same either way so the form
        // does not reveal which emails are registered.
        if (result?.visitorId) {
          setPendingVisitorId(
            result.visitorId
          );

          setPendingEmail(email);
          setOtpInput('');
          setError('');
          setView('otp');

          return;
        }

        setError(
          'If an unverified registration exists for that address, a new verification code is on its way.'
        );
      } catch (err) {
        console.error(
          'RESEND UNCONFIRMED VISITOR OTP ERROR:',
          err
        );

        setError(
          err?.message ||
            'Unable to send a new verification code. Please try again.'
        );
      } finally {
        setIsResendingVisitorOtp(
          false
        );
      }
    };

  // =========================================================
  // REGISTRATION
  // =========================================================

  const handleRegister = async (
    event
  ) => {
    event.preventDefault();

    // -------------------------------------------------------
    // CRITICAL FIX:
    // Prevent duplicate form submission immediately.
    // useRef changes synchronously and does not wait for
    // React's next render.
    // -------------------------------------------------------

    if (
      registrationLockRef.current
    ) {
      console.warn(
        'Visitor registration already in progress. Duplicate submission ignored.'
      );

      return;
    }

    setError('');

    const errors = {
      fullName: '',
      contactNumber: '',
      email: '',
      province: '',
      city: '',
      barangay: '',
      password: '',
      confirmPassword: '',
    };

    const trimmedFullName =
      formData.fullName.normalize('NFC').trim().replace(/\s+/g, ' ');

    const trimmedContactNumber =
      formData.contactNumber.trim();

    const trimmedEmail =
      formData.email.trim();

    const trimmedBarangay =
      barangay.trim();

    // -------------------------------------------------------
    // FULL NAME
    // -------------------------------------------------------

    errors.fullName = validateVisitorFullName(trimmedFullName);

    // -------------------------------------------------------
    // CONTACT NUMBER
    // -------------------------------------------------------

    if (!trimmedContactNumber) {
      errors.contactNumber =
        'Contact number is required.';
    } else if (
      !/^09\d{9}$/.test(
        trimmedContactNumber
      )
    ) {
      errors.contactNumber =
        'Contact number must be exactly 11 digits and start with 09.';
    }

    // -------------------------------------------------------
    // EMAIL
    // -------------------------------------------------------

    if (!trimmedEmail) {
      errors.email =
        'Email address is required.';
    } else if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        trimmedEmail
      )
    ) {
      errors.email =
        'Please enter a valid email address.';
    }

    if (!selectedLibraryId) {
      errors.libraryId =
        'Please select your participating library or school.';
    } else if (!libraries.some((library) => library.id === selectedLibraryId)) {
      errors.libraryId =
        'Select a participating library with a configured email domain.';
    } else {
      const selectedLibrary = libraries.find(
        (library) => library.id === selectedLibraryId
      );
      const emailDomain = trimmedEmail.toLowerCase().split('@')[1] || '';
      const allowedDomain = String(selectedLibrary?.emailDomain || '')
        .toLowerCase()
        .trim()
        .replace(/^@+/, '')
        .replace(/\.+$/, '');
      if (
        emailDomain === 'gmail.com' ||
        !allowedDomain ||
        (emailDomain !== allowedDomain &&
          !emailDomain.endsWith(`.${allowedDomain}`))
      ) {
        errors.email =
          'Use an email address belonging to the selected partner library or school.';
      }
    }

    // -------------------------------------------------------
    // LOCATION
    // -------------------------------------------------------

    if (!selectedProvince) {
      errors.province =
        'Province is required.';
    }

    if (!selectedCity) {
      errors.city =
        'City or municipality is required.';
    }

    if (!trimmedBarangay) {
      errors.barangay =
        'Barangay is required.';
    }

    // -------------------------------------------------------
    // PASSWORD
    // -------------------------------------------------------

    if (!formData.password) {
      errors.password =
        'Password is required.';
    } else if (
      !isPasswordValid
    ) {
      errors.password =
        'Password must be at least 12 characters and include uppercase, lowercase, number, and special character.';
    }

    // -------------------------------------------------------
    // CONFIRM PASSWORD
    // -------------------------------------------------------

    if (!formData.confirmPassword) {
      errors.confirmPassword =
        'Please confirm your password.';
    } else if (
      formData.password !==
      formData.confirmPassword
    ) {
      errors.confirmPassword =
        'Passwords do not match.';
    }

    setFieldErrors(errors);

    const hasErrors =
      Object.values(errors).some(
        (message) => Boolean(message)
      );

    if (hasErrors) {
      return;
    }

    // -------------------------------------------------------
    // LOCK BEFORE ASYNC REQUEST
    // -------------------------------------------------------

    registrationLockRef.current =
      true;

    setIsRegistering(true);

    const completeAddress =
      `${trimmedBarangay}, ${selectedCity}, ${selectedProvince}`;

    try {
      console.log(
        'VISITOR REGISTRATION STARTED:',
        trimmedEmail
      );

      // IMPORTANT:
      // Do not spread ...formData here.
      // confirmPassword is frontend-only and should not
      // be sent to the registration function.
      const result =
        await registerVisitor({
          fullName:
            trimmedFullName,

          contactNumber:
            trimmedContactNumber,

          email:
            trimmedEmail,

          address:
            completeAddress,

          libraryId:
            selectedLibraryId,

          password:
            formData.password,
        });

      console.log(
        'VISITOR REGISTRATION SUCCESS:',
        result
      );

      if (
        !result?.visitorId
      ) {
        throw new Error(
          'Registration was created, but no registration session was returned. Please try again.'
        );
      }

      setPendingVisitorId(
        result.visitorId
      );

      setPendingEmail(
        trimmedEmail
      );

      const now = Date.now();
      const expiresAt =
        result?.otpExpiresAt
          ? Date.parse(result.otpExpiresAt)
          : now + OTP_CODE_TTL_SECONDS * 1000;
      setOtpExpiresAt(
        Number.isFinite(expiresAt)
          ? expiresAt
          : now + OTP_CODE_TTL_SECONDS * 1000
      );
      setOtpResendAvailableAt(
        now + OTP_RESEND_COOLDOWN_SECONDS * 1000
      );
      setOtpTimeRemaining(
  Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
);
setOtpResendRemaining(
  Math.max(
    0,
    Math.ceil(
      (now + OTP_RESEND_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000
    )
  )
);
      setOtpInput('');
      setError('');
      setView('otp');
    } catch (err) {
      console.error(
        'VISITOR REGISTRATION ERROR:',
        err
      );

      const registrationMessage =
        err?.message ||
        err?.error_description ||
        err?.details ||
        err?.hint ||
        'Registration could not be completed. Please try again.';

      setError(
        String(
          registrationMessage
        )
      );
    } finally {
      // -----------------------------------------------------
      // Always release the lock.
      // -----------------------------------------------------

      registrationLockRef.current =
        false;

      setIsRegistering(false);

      console.log(
        'VISITOR REGISTRATION LOCK RELEASED'
      );
    }
  };

  // =========================================================
  // VERIFY OTP
  // =========================================================

  const handleVerifyOtp = async (
    event
  ) => {
    event.preventDefault();

    setError('');

    const cleanOtp =
      otpInput.trim();

    if (!otpExpiresAt || Date.now() >= otpExpiresAt) {
      setOtpTimeRemaining(0);
      setError(
        'This verification code has expired. Please request a new one.'
      );
      return;
    }

    if (!/^\d{6}$/.test(cleanOtp)) {
      setError(
        'Please enter the complete 6-digit verification code.'
      );

      return;
    }

    if (!pendingVisitorId) {
      setError(
        'Registration session not found. Please register again.'
      );

      return;
    }

    try {
      const visitor =
        await verifyVisitorOtp(
          pendingVisitorId,
          cleanOtp
        );

      setRegisteredVisitor(
        visitor
      );

      setError('');
      setView('success');
    } catch (err) {
      console.error(
        'VERIFY OTP ERROR:',
        err
      );

      setError(
        err?.message ||
          'Invalid or expired verification code.'
      );
    }
  };

  // =========================================================
  // RESEND OTP
  // =========================================================

  const handleResendOtp =
    async () => {
      setError('');

      if (!pendingVisitorId) {
        setError(
          'Registration session not found.'
        );

        return;
      }

      setIsOtpResending(true);

      try {
        const result = await resendVisitorOtp(
          pendingVisitorId
        );

        const now = Date.now();
        const expiresAt =
          result?.expiresAt
            ? Date.parse(result.expiresAt)
            : now + OTP_CODE_TTL_SECONDS * 1000;
        setOtpExpiresAt(
          Number.isFinite(expiresAt)
            ? expiresAt
            : now + OTP_CODE_TTL_SECONDS * 1000
        );
        setOtpResendAvailableAt(
          now + OTP_RESEND_COOLDOWN_SECONDS * 1000
        );
        setOtpTimeRemaining(
  Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
);
setOtpResendRemaining(
  Math.max(
    0,
    Math.ceil(
      (now + OTP_RESEND_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000
    )
  )
);
        setOtpInput('');

        setError(
          'A new verification code has been sent to your email.'
        );
      } catch (err) {
        console.error(
          'RESEND OTP ERROR:',
          err
        );

        setError(
          err?.message ||
            'Unable to resend verification code.'
        );
      } finally {
        setIsOtpResending(false);
      }
    };

  // =========================================================
  // FORGOT PASSWORD
  // =========================================================

  const handleOpenForgotPassword = () => {
    // Pre-fill with whatever identifier was typed so the visitor does not
    // retype an address they already entered.
    setResetEmail(
      loginData.identifier
        .trim()
        .includes('@')
        ? loginData.identifier
            .trim()
            .toLowerCase()
        : ''
    );

    setResetStep('request');
    setResetCode('');
    setResetPassword('');
    setResetConfirmPassword('');
    setResetNotice('');
    setError('');
    setCanResendVisitorOtp(false);
    setView('forgot');
  };

  const handleRequestResetCode =
    async (event) => {
      event.preventDefault();

      const email =
        resetEmail
          .trim()
          .toLowerCase();

      if (!email.includes('@')) {
        setError(
          'Please enter a valid email address.'
        );

        return;
      }

      setError('');
      setResetNotice('');
      setIsResetSubmitting(
        true
      );

      try {
        const result =
          await requestPasswordResetCode(
            email
          );

        setResetNotice(
          result?.message ||
            'If that address belongs to a SHELF account, a verification code is on its way.'
        );

        const now = Date.now();
        const returnedExpiresInSeconds =
          Number(result?.expiresInSeconds);
        const expiresInSeconds =
          Number.isFinite(returnedExpiresInSeconds) &&
          returnedExpiresInSeconds >= 0
            ? returnedExpiresInSeconds
            : RESET_CODE_TTL_SECONDS;
        setResetExpiresAt(
          now + expiresInSeconds * 1000
        );
        setResetResendAvailableAt(
          now + RESET_CODE_RESEND_COOLDOWN_SECONDS * 1000
        );
        setResetTimeRemaining(expiresInSeconds);
        setResetResendRemaining(
          RESET_CODE_RESEND_COOLDOWN_SECONDS
        );

        // Move to the code step either way. The response is identical for
        // unknown addresses, so this reveals nothing and still matches what
        // the visitor was told to expect.
        setResetStep('verify');
      } catch (err) {
        console.error(
          'REQUEST RESET CODE ERROR:',
          err
        );

        setError(
          err?.message ||
            'Unable to send the verification code. Please try again.'
        );
      } finally {
        setIsResetSubmitting(
          false
        );
      }
    };

  const handleResendResetCode = async () => {
    if (
      isResetSubmitting ||
      (resetTimeRemaining > 0 && resetResendRemaining > 0)
    ) {
      return;
    }

    setError('');
    setResetNotice('');
    setIsResetSubmitting(true);

    try {
      const result = await requestPasswordResetCode(resetEmail);
      const now = Date.now();
      const returnedExpiresInSeconds =
        Number(result?.expiresInSeconds);
      const expiresInSeconds =
        Number.isFinite(returnedExpiresInSeconds) &&
        returnedExpiresInSeconds >= 0
          ? returnedExpiresInSeconds
          : RESET_CODE_TTL_SECONDS;

      setResetCode('');
      setResetExpiresAt(now + expiresInSeconds * 1000);
      setResetResendAvailableAt(
        now + RESET_CODE_RESEND_COOLDOWN_SECONDS * 1000
      );
      setResetTimeRemaining(expiresInSeconds);
      setResetResendRemaining(
        RESET_CODE_RESEND_COOLDOWN_SECONDS
      );
      setResetNotice(
        'A new verification code has been requested. Any previous code is no longer valid.'
      );
    } catch (err) {
      console.error('RESEND RESET CODE ERROR:', err);
      setError(
        err?.message ||
          'Unable to resend the verification code. Please try again.'
      );
    } finally {
      setIsResetSubmitting(false);
    }
  };

  const handleVerifyResetCode =
    async (event) => {
      event.preventDefault();

      if (!resetExpiresAt || Date.now() >= resetExpiresAt) {
        setError(
          'This verification code has expired. Please request a new one.'
        );
        setResetTimeRemaining(0);
        return;
      }

      const code =
        resetCode.trim();

      if (!/^\d{6}$/.test(code)) {
        setError(
          'Please enter the complete 6-digit verification code.'
        );

        return;
      }

      setError('');
      setResetNotice('');
      setIsResetSubmitting(
        true
      );

      try {
        const result =
          await verifyPasswordResetCode(
            resetEmail,
            code
          );

        if (!result?.success) {
          setError(
            'That verification code is not valid or has expired. Please request a new one.'
          );

          return;
        }

        setError('');
        setResetStep('password');
      } catch (err) {
        console.error(
          'VERIFY RESET CODE ERROR:',
          err
        );

        setError(
          err?.message ||
            'Unable to verify the code. Please try again.'
        );
      } finally {
        setIsResetSubmitting(
          false
        );
      }
    };

  const handleApplyNewPassword =
    async (event) => {
      event.preventDefault();

      if (!resetPasswordValid) {
        setError(
          'Password must be at least 12 characters and include an uppercase letter, a lowercase letter, a number and a symbol.'
        );

        return;
      }

      if (
        !resetPasswordsMatch
      ) {
        setError(
          'The passwords do not match.'
        );

        return;
      }

      setError('');
      setIsResetSubmitting(
        true
      );

      try {
        const result =
          await applyPasswordReset({
            email:
              resetEmail,
            code:
              resetCode,
            newPassword:
              resetPassword,
          });

        // Drop the credentials immediately so they cannot linger in state
        // after a successful reset.
        setResetPassword('');
        setResetConfirmPassword('');
        setResetCode('');

        setLoginData({
          identifier:
            resetEmail,
          password: '',
        });

        setResetNotice(
          result?.message ||
            'Your password has been updated. You can now sign in with your new password.'
        );

        setResetStep('done');
      } catch (err) {
        console.error(
          'APPLY NEW PASSWORD ERROR:',
          err
        );

        setError(
          err?.message ||
            'Unable to update your password. Please try again.'
        );
      } finally {
        setIsResetSubmitting(
          false
        );
      }
    };

  // =========================================================
  // RESET TO LOGIN
  // =========================================================

  const resetToLogin = () => {
    // Release registration lock in case the user
    // navigates away from the registration screen.
    registrationLockRef.current =
      false;

    setView('login');
    setError('');

    setFieldErrors({
      fullName: '',
      contactNumber: '',
      email: '',
      libraryId: '',
      province: '',
      city: '',
      barangay: '',
      password: '',
      confirmPassword: '',
    });

    setFormData({
      fullName: '',
      contactNumber: '',
      email: '',
      address: '',
      password: '',
      confirmPassword: '',
    });

    setSelectedProvince('');
    setSelectedCity('');
    setBarangay('');
    setSelectedLibraryId('');

    setLoginData({
      identifier: '',
      password: '',
    });

    setOtpInput('');
    setPendingVisitorId(null);
    setPendingEmail('');
    setRegisteredVisitor(null);

    setIsRegistering(false);
    setCanResendVisitorOtp(false);

    setResetStep('request');
    setResetEmail('');
    setResetCode('');
    setResetPassword('');
    setResetConfirmPassword('');
    setResetNotice('');
    setIsResetSubmitting(false);
    setShowResetPassword(false);
  };

  // =========================================================
  // BACK BUTTON
  // =========================================================

  const handleBack = () => {
  setError('');
  setCanResendVisitorOtp(false);
  setView('login');
};

  // =========================================================
  // UI
  // =========================================================

  return (
    <div className="auth-shell min-h-screen flex w-full bg-shelf-bg">
      <style>{`
        input[type="password"]::-ms-reveal,
        input[type="password"]::-ms-clear {
          display: none;
        }
      `}</style>

      {/* =====================================================
          LEFT PANEL
      ===================================================== */}

      <div
        className="auth-visual-panel shelf-landing-backdrop hidden lg:flex lg:w-1/2 text-white p-12 flex-col justify-between relative overflow-hidden"
      >
        <ParticleConstellation />
        <div className="relative z-10 flex items-center gap-3">
          <span className="text-xl font-bold tracking-wider">
            SHELF
          </span>
        </div>

        <div className="relative z-10 space-y-4 max-w-lg">
          <span className="inline-block px-3 py-1 bg-white/10 backdrop-blur-md text-xs font-semibold rounded-full border border-white/20">
            Digital Library Management System
          </span>

          <h1 className="text-4xl font-extrabold leading-tight">
            Explore Learning Resources
            & Campus Libraries.
          </h1>

          <p className="text-sm text-slate-300">
            Access your library account,
            explore available resources,
            manage your borrowing activity,
            and use your digital library pass.
          </p>
        </div>

        <div className="relative z-10 text-xs text-slate-400">
          © SHELF System. All rights reserved.
        </div>
      </div>

      {/* =====================================================
          RIGHT PANEL
      ===================================================== */}

      <div className="auth-form-panel relative w-full lg:w-1/2 flex items-center justify-center p-4 sm:p-8 lg:p-12 overflow-y-auto">
        <div className="auth-form-card w-full max-w-md bg-white p-6 sm:p-8 rounded-2xl shadow-xl border border-slate-200 space-y-6 my-auto">
          <div className="sticky top-0 z-20 -mt-1 flex items-center justify-between gap-2 bg-white pb-1">
            {view !== 'register' && view !== 'forgot' && (
              <button
                type="button"
                onClick={() => navigate('/')}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-shelf-primary"
              >
                <ArrowLeft size={16} aria-hidden="true" />
                Back to home
              </button>
            )}
            {(view === 'register' || view === 'forgot') && (
              <button
                type="button"
                onClick={() => {
                  if (view === 'register') {
                    handleBack();
                  } else {
                    setError('');
                    setResetStep('request');
                    setResetNotice('');
                    setView('login');
                  }
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-shelf-primary"
                aria-label={view === 'register' ? 'Back to Login' : 'Go back'}
                title={view === 'register' ? 'Back to Login' : 'Go back'}
              >
                <ArrowLeft size={16} aria-hidden="true" />
                {view === 'register' ? 'Back to login' : 'Back'}
              </button>
            )}
          </div>

          {/* HEADER */}

          <div className="text-center lg:text-left space-y-1">
            <h2 className="text-2xl font-bold text-shelf-text">
              {view === 'login' &&
                'SHELF Login'}

              {view === 'register' &&
                'Visitor Registration'}

              {view === 'otp' &&
                'Verify Your Email'}

              {view === 'success' &&
                'Registration Successful'}

              {view === 'forgot' &&
                resetStep === 'request' &&
                'Reset Your Password'}

              {view === 'forgot' &&
                resetStep === 'verify' &&
                'Enter Verification Code'}

              {view === 'forgot' &&
                resetStep === 'password' &&
                'Choose a New Password'}

              {view === 'forgot' &&
                resetStep === 'done' &&
                'Password Updated'}
            </h2>

            <p className="text-xs text-slate-500">
              {view === 'login' &&
                'Sign in using your school email address and password.'}

              {view === 'register' &&
                'Fill in your personal details to receive your digital library pass.'}

              {view === 'otp' &&
                'Enter the one-time verification code sent to your email.'}

              {view === 'success' &&
                'Your QR pass is for library attendance, borrowing, and returns. Keep it private and present it at the library when requested.'}

              {view === 'forgot' &&
                resetStep === 'request' &&
                'Enter the email address linked to your account and we will send a verification code.'}

              {view === 'forgot' &&
                resetStep === 'verify' &&
                `Enter the 6-digit code sent to ${resetEmail}.`}

              {view === 'forgot' &&
                resetStep === 'password' &&
                'Use at least 12 characters with an uppercase letter, a lowercase letter, a number and a symbol.'}

              {view === 'forgot' &&
                resetStep === 'done' &&
                'Sign in below with your new password.'}
            </p>
          </div>

          {/* ERROR */}

          {error && (
            <div
              className={`text-xs font-semibold rounded-lg px-3 py-2 ${
                error.includes(
                  'sent to your email'
                )
                  ? 'text-blue-700 bg-blue-50 border border-blue-200'
                  : 'text-red-600 bg-red-50 border border-red-200'
              }`}
            >
              {error}
            </div>
          )}

          {view === 'login' &&
            canResendVisitorOtp && (
              <button
                type="button"
                onClick={
                  handleResendUnconfirmedVisitorOtp
                }
                disabled={
                  isResendingVisitorOtp
                }
                className="w-full text-xs font-semibold text-shelf-primary hover:underline disabled:opacity-60 disabled:hover:no-underline"
              >
                {isResendingVisitorOtp
                  ? 'Sending verification code...'
                  : 'Resend visitor verification code'}
              </button>
            )}

          {/* =================================================
              SUCCESS VIEW
          ================================================= */}

          {view === 'success' &&
            registeredVisitor && (
              <div className="space-y-4 bg-slate-50 p-6 rounded-xl border border-slate-200 text-center">
                <h3 className="text-sm font-bold text-shelf-text">
                  Welcome,{' '}
                  {
                    registeredVisitor.fullName
                  }
                  !
                </h3>

                <div className="flex justify-center">
                  <div className="p-4 bg-white rounded-lg shadow-sm inline-block border border-slate-200 max-w-full overflow-hidden">
                    <QRCodeSVG
                      value={
                        registeredVisitor.qrCode
                      }
                      size={220}
                      level="H"
                      includeMargin
                      fgColor="#000000"
                      bgColor="#FFFFFF"
                      className="w-full h-auto max-w-50"
                    />
                  </div>
                </div>

                <p className="text-xs font-mono font-bold text-shelf-primary break-all">
                  {
                    registeredVisitor.qrCode
                  }
                </p>

                <p className="text-xs text-slate-500">
                  Your QR pass is for library attendance, book pickup, and returns. Sign in with your school email and password.
                </p>

                <button
                  type="button"
                  onClick={() => {
                    setLoginData({
                      identifier:
                        registeredVisitor.email || pendingEmail,
                      password: '',
                    });
                    setError('');
                    setView('login');
                  }}
                  className="w-full bg-shelf-primary text-white py-2.5 rounded-lg text-sm font-bold hover:opacity-95 transition"
                >
                  Sign in to library portal
                </button>
              </div>
            )}

          {/* =================================================
              OTP VIEW
          ================================================= */}

          {view === 'otp' && (
            <form
              onSubmit={handleVerifyOtp}
              className="space-y-4"
              autoComplete="off"
            >
              <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs px-4 py-3 rounded-lg">
                <p className="font-semibold">
                  Verification code sent
                </p>

                <p className="mt-1">
                  We sent a 6-digit code to:{' '}
                  <span className="font-bold break-all">
                    {pendingEmail}
                  </span>
                </p>
              </div>

              <p
                className={`text-center text-xs font-semibold ${
                  otpTimeRemaining > 0
                    ? 'text-slate-600'
                    : 'text-red-700'
                }`}
                role="status"
                aria-live="polite"
              >
                {otpTimeRemaining > 0
                  ? `Code expires in ${String(Math.floor(otpTimeRemaining / 60)).padStart(2, '0')}:${String(otpTimeRemaining % 60).padStart(2, '0')}.`
                  : 'This code has expired. Request a new code to continue.'}
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  6-Digit Code
                </label>

                <input
                  type="text"
                  name="otp_code"
                  inputMode="numeric"
                  autoComplete="off"
                  required
                  maxLength={6}
                  value={otpInput}
                  onChange={(event) => {
                    const value =
                      event.target.value.replace(
                        /\D/g,
                        ''
                      );

                    setOtpInput(value);
                  }}
                  placeholder="000000"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm tracking-[0.35em] text-center font-mono focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                />
              </div>

              <button
                type="submit"
                disabled={
                  otpInput.length !== 6 ||
                  otpTimeRemaining === 0
                }
                className={`w-full py-2.5 rounded-lg font-bold text-sm transition shadow-sm ${
                  otpInput.length === 6 &&
                  otpTimeRemaining > 0
                    ? 'bg-shelf-primary text-white hover:opacity-95'
                    : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                }`}
              >
                Verify & activate
              </button>

              <button
                type="button"
                onClick={
                  handleResendOtp
                }
                disabled={
                  isOtpResending ||
                  otpResendRemaining > 0
                }
                className="w-full text-xs font-semibold text-shelf-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isOtpResending
                  ? 'Sending code...'
                  : otpResendRemaining > 0
                    ? `Resend Code in ${otpResendRemaining}s`
                    : 'Resend code'}
              </button>
            </form>
          )}

          {/* =================================================
              REGISTER VIEW
          ================================================= */}

          {view === 'register' && (
            <form
              onSubmit={handleRegister}
              className="space-y-3"
              autoComplete="off"
            >
              {/* FULL NAME */}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name
                </label>

                <input
                  type="text"
                  name="user_fullname"
                  autoComplete="off"
                  placeholder="Juan Dela Cruz"
                  value={formData.fullName}
                  onChange={(event) => {
                    const value = event.target.value
                      .normalize('NFC')
                      .replace(/\s{2,}/g, ' ');

                    setFormData({
                      ...formData,
                      fullName: value,
                    });

                    setFieldErrors({
                      ...fieldErrors,
                      fullName: value ? validateVisitorFullName(value) : '',
                    });
                  }}
                  onBlur={() => {
                    if (formData.fullName.trim()) {
                      setFieldErrors({
                        ...fieldErrors,
                        fullName: validateVisitorFullName(formData.fullName),
                      });
                    }
                  }}
                  className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 ${
                    fieldErrors.fullName
                      ? 'border-red-400'
                      : 'border-slate-300'
                  }`}
                />

                {fieldErrors.fullName && (
                  <p className="mt-1 text-xs font-medium text-red-600">
                    {fieldErrors.fullName}
                  </p>
                )}
              </div>

              {/* CONTACT NUMBER */}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Contact Number
                </label>

                <input
                  type="tel"
                  name="user_contact"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={11}
                  placeholder="09123456789"
                  value={
                    formData.contactNumber
                  }
                  onChange={(event) => {
                    const value =
                      event.target.value
                        .replace(/\D/g, '')
                        .slice(0, 11);
                    const contactNumberError = value
                      ? !value.startsWith('09')
                        ? 'Contact number must start with 09.'
                        : value.length < 11
                          ? 'Contact number must contain exactly 11 digits.'
                          : ''
                      : '';

                    setFormData({
                      ...formData,
                      contactNumber: value,
                    });

                    setFieldErrors({
                      ...fieldErrors,
                      contactNumber: contactNumberError,
                    });
                  }}
                  aria-invalid={Boolean(fieldErrors.contactNumber)}
                  className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 ${
                    fieldErrors.contactNumber
                      ? 'border-red-400'
                      : 'border-slate-300'
                  }`}
                />

                {fieldErrors.contactNumber && (
                  <p className="mt-1 text-xs font-medium text-red-600">
                    {
                      fieldErrors.contactNumber
                    }
                  </p>
                )}
              </div>

              {/* EMAIL */}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  School email address
                </label>

                <input
                  type="email"
                  name="user_email"
                  autoComplete="off"
                  placeholder="visitor@email.com"
                  value={formData.email}
                  onChange={(event) => {
                    const value =
                      event.target.value;

                    setFormData({
                      ...formData,
                      email: value,
                    });

                    setFieldErrors({
                      ...fieldErrors,
                      email: '',
                    });
                  }}
                  className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 ${
                    fieldErrors.email
                      ? 'border-red-400'
                      : 'border-slate-300'
                  }`}
                />

                {fieldErrors.email && (
                  <p className="mt-1 text-xs font-medium text-red-600">
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              {/* LIBRARY BRANCH */}
              <div>
                <label
                  htmlFor="visitor-library-branch"
                  className="mb-1 block text-xs font-semibold text-slate-700"
                >
                  Library Branch
                </label>
                <select
                  id="visitor-library-branch"
                  value={selectedLibraryId}
                  onChange={(event) => {
                    setSelectedLibraryId(event.target.value);
                    setFieldErrors((previous) => ({ ...previous, libraryId: '' }));
                  }}
                  disabled={librariesLoading || Boolean(libraryLoadError)}
                  aria-invalid={Boolean(fieldErrors.libraryId)}
                  className={`w-full rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 disabled:bg-slate-100 ${
                    fieldErrors.libraryId ? 'border-red-400' : 'border-slate-300'
                  }`}
                >
                  <option value="">
                    {librariesLoading ? 'Loading partner schools…' : 'Select your participating library or school'}
                  </option>
                  {libraries.map((library) => (
                    <option key={library.id} value={library.id}>
                      {library.name}
                    </option>
                  ))}
                </select>
                {libraryLoadError ? (
                  <p role="alert" className="mt-1 text-xs font-medium text-red-600">
                    {libraryLoadError}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">
                    Registration is limited to email domains configured for participating libraries and schools.
                  </p>
                )}
                {fieldErrors.libraryId && (
                  <p className="mt-1 text-xs font-medium text-red-600">
                    {fieldErrors.libraryId}
                  </p>
                )}
              </div>

              {/* STRUCTURED LOCATION */}

              <div className="space-y-3">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Residential Location
                </label>

              {/* PROVINCE */}

              <select
                id="visitor-province"
                aria-label="Province"
                aria-required="true"
                aria-invalid={Boolean(fieldErrors.province)}
                aria-describedby={fieldErrors.province ? 'visitor-province-error' : undefined}
                value={selectedProvince}
                onChange={(event) => {
                  const provinceName = event.target.value;

                  setSelectedProvince(provinceName);
                  setSelectedCity('');
                  setBarangay('');
                  setCityOptions([]);
                  setBarangayOptions([]);

                  setFieldErrors((previous) => ({
                    ...previous,
                    province: '',
                    city: '',
                    barangay: '',
                  }));
                }}
                disabled={locationLoading && provinceOptions.length === 0}
                className={`w-full px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 ${
                  fieldErrors.province
                    ? 'border-red-400'
                    : 'border-slate-300'
                }`}
              >
                <option value="">
                  {provinceOptions.length > 0
                    ? 'Select Province'
                    : 'Loading provinces...'}
                </option>

                {provinceOptions.map((province) => (
                  <option
                    key={province.psgc_code}
                    value={province.name}
                  >
                    {province.name}
                  </option>
                ))}
              </select>

              {fieldErrors.province && (
                <p id="visitor-province-error" role="alert" className="mt-1 text-xs font-medium text-red-600">
                  {fieldErrors.province}
                </p>
              )}
               
              {/* CITY / MUNICIPALITY */}

              <select
                id="visitor-city"
                aria-label="City / Municipality"
                aria-required="true"
                aria-invalid={Boolean(fieldErrors.city)}
                aria-describedby={fieldErrors.city ? 'visitor-city-error' : undefined}
                value={selectedCity}
                onChange={(event) => {
                  setSelectedCity(event.target.value);
                  setBarangay('');
                  setBarangayOptions([]);

                  setFieldErrors((previous) => ({
                    ...previous,
                    city: '',
                    barangay: '',
                  }));
                }}
                disabled={!selectedProvince || locationLoading}
                className={`w-full px-3 py-2 border rounded-lg text-sm bg-white disabled:bg-slate-100 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 ${
                  fieldErrors.city
                    ? 'border-red-400'
                    : 'border-slate-300'
                }`}
              >
                <option value="">
                  {!selectedProvince
                    ? 'Select province first'
                    : locationLoading && cityOptions.length === 0
                      ? 'Loading cities / municipalities...'
                      : 'Select City / Municipality'}
                </option>

                {cityOptions.map((city) => (
                  <option
                    key={city.psgc_code}
                    value={city.name}
                  >
                    {city.name}
                  </option>
                ))}
              </select>

              {fieldErrors.city && (
                <p id="visitor-city-error" role="alert" className="mt-1 text-xs font-medium text-red-600">
                  {fieldErrors.city}
                </p>
              )}
                
              {/* BARANGAY */}

              <select
                id="visitor-barangay"
                name="user_barangay"
                aria-label="Barangay"
                aria-required="true"
                aria-invalid={Boolean(fieldErrors.barangay)}
                aria-describedby={fieldErrors.barangay ? 'visitor-barangay-error' : undefined}
                value={barangay}
                onChange={(event) => {
                  setBarangay(event.target.value);

                  setFieldErrors((previous) => ({
                    ...previous,
                    barangay: '',
                  }));
                }}
                disabled={!selectedCity || barangayOptions.length === 0}
                className={`w-full px-3 py-2 border rounded-lg text-sm bg-white disabled:bg-slate-100 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 ${
                  fieldErrors.barangay
                    ? 'border-red-400'
                    : 'border-slate-300'
                }`}
              >
                <option value="">
                  {!selectedCity
                    ? 'Select city / municipality first'
                    : barangayOptions.length === 0
                      ? 'Loading barangays...'
                      : 'Select Barangay'}
                </option>

                {barangayOptions.map((item) => (
                  <option
                    key={item.psgc_code}
                    value={item.name}
                  >
                    {item.name}
                  </option>
                ))}
              </select>

              {fieldErrors.barangay && (
                <p id="visitor-barangay-error" role="alert" className="mt-1 text-xs font-medium text-red-600">
                  {fieldErrors.barangay}
                </p>
              )}

              <p className="text-xs text-slate-500">
                Select your province and city/municipality, then choose your barangay.
              </p>
              </div>

              {/* PASSWORD */}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Create Password
                </label>

                <div className="relative">
                  <input
                    type={
                      showRegisterPassword
                        ? 'text'
                        : 'password'
                    }
                    name="new_password"
                    minLength={12}
                    autoComplete="new-password"
                    onCopy={preventPasswordClipboard}
                    onCut={preventPasswordClipboard}
                    onPaste={preventPasswordClipboard}
                    onDrop={preventPasswordClipboard}
                    placeholder="Enter Password"
                    value={
                      formData.password
                    }
                    onChange={(event) => {
                      const value =
                        event.target.value;

                      setFormData({
                        ...formData,
                        password: value,
                      });

                      setFieldErrors({
                        ...fieldErrors,
                        password: '',
                      });
                    }}
                    className={`w-full px-3 py-2 pr-12 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 ${
                      fieldErrors.password
                        ? 'border-red-400'
                        : 'border-slate-300'
                    }`}
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setShowRegisterPassword(
                        !showRegisterPassword
                      )
                    }
                    aria-label={
                      showRegisterPassword
                        ? 'Hide password'
                        : 'Show password'
                    }
                    className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-slate-500 hover:text-shelf-primary"
                  >
                    {showRegisterPassword ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>

                <div className="mt-2 bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <p className="text-xs font-semibold text-slate-700 mb-1">
                    Password requirements:
                  </p>

                  <ul className="text-xs space-y-1">
                    <PasswordRequirement
                      valid={
                        passwordRequirements.minLength
                      }
                    >
                      At least 12 characters
                    </PasswordRequirement>

                    <PasswordRequirement
                      valid={
                        passwordRequirements.uppercase
                      }
                    >
                      At least 1 uppercase letter
                    </PasswordRequirement>

                    <PasswordRequirement
                      valid={
                        passwordRequirements.lowercase
                      }
                    >
                      At least 1 lowercase letter
                    </PasswordRequirement>

                    <PasswordRequirement
                      valid={
                        passwordRequirements.number
                      }
                    >
                      At least 1 number
                    </PasswordRequirement>

                    <PasswordRequirement
                      valid={
                        passwordRequirements.special
                      }
                    >
                      At least 1 special character
                    </PasswordRequirement>
                  </ul>
                </div>

                {fieldErrors.password && (
                  <p className="mt-1 text-xs font-medium text-red-600">
                    {fieldErrors.password}
                  </p>
                )}
              </div>

              {/* CONFIRM PASSWORD */}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Confirm Password
                </label>

                <div className="relative">
                  <input
                    type={
                      showConfirmPassword
                        ? 'text'
                        : 'password'
                    }
                    name="confirm_password"
                    minLength={12}
                    autoComplete="new-password"
                    onCopy={preventPasswordClipboard}
                    onCut={preventPasswordClipboard}
                    onPaste={preventPasswordClipboard}
                    onDrop={preventPasswordClipboard}
                    placeholder="Re-enter password"
                    value={
                      formData.confirmPassword
                    }
                    onChange={(event) => {
                      const value =
                        event.target.value;

                      setFormData({
                        ...formData,
                        confirmPassword: value,
                      });

                      setFieldErrors({
                        ...fieldErrors,
                        confirmPassword: '',
                      });
                    }}
                    className={`w-full px-3 py-2 pr-12 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 ${
                      formData
                        .confirmPassword
                        .length > 0
                        ? passwordsMatch
                          ? 'border-green-400'
                          : 'border-red-300'
                        : 'border-slate-300'
                    }`}
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setShowConfirmPassword(
                        !showConfirmPassword
                      )
                    }
                    aria-label={
                      showConfirmPassword
                        ? 'Hide confirm password'
                        : 'Show confirm password'
                    }
                    className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-slate-500 hover:text-shelf-primary"
                  >
                    {showConfirmPassword ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>

                {fieldErrors.confirmPassword && (
                  <p className="mt-1 text-xs font-medium text-red-600">
                    {
                      fieldErrors.confirmPassword
                    }
                  </p>
                )}
              </div>

              {/* SUBMIT */}

              <button
                type="submit"
                disabled={
                  isRegistering
                }
                aria-busy={
                  isRegistering
                }
                className="w-full bg-shelf-primary text-white py-2.5 rounded-lg font-bold text-sm transition shadow-sm hover:opacity-95 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isRegistering
                  ? 'Creating account...'
                  : 'Send verification code'}
              </button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={
                    resetToLogin
                  }
                  className="text-xs font-semibold text-slate-600 hover:text-shelf-primary"
                >
                  Already have an account?
                  Sign in
                </button>
              </div>
            </form>
          )}

          {/* =================================================
              LOGIN VIEW
          ================================================= */}

          {view === 'login' && (
            <form
              onSubmit={handleLogin}
              className="space-y-4"
              autoComplete="off"
            >
                  {/* LOGIN IDENTIFIER */}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1 uppercase tracking-wider">
                      School email address
                    </label>

                    <input
                      type="email"
                      name="visitor_login_identifier"
                      required
                      autoComplete="email"
                      placeholder="email@example.com"
                      value={
                        loginData.identifier
                      }
                      onChange={(event) => {
                        setCanResendVisitorOtp(
                          false
                        );

                        setLoginData({
                          ...loginData,
                          identifier:
                            event.target.value,
                        });
                      }}
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                    />
                  </div>

                  {/* LOGIN PASSWORD */}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1 uppercase tracking-wider">
                      Password
                    </label>

                    <div className="relative">
                      <input
                        type={
                          showLoginPassword
                            ? 'text'
                            : 'password'
                        }
                        name="visitor_login_password"
                        required
                        autoComplete="current-password"
                        placeholder="Enter password"
                        value={
                          loginData.password
                        }
                        onChange={(event) =>
                          setLoginData({
                            ...loginData,
                            password:
                              event.target.value,
                          })
                        }
                        className="w-full px-4 py-2.5 pr-12 border border-slate-300 rounded-lg text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                      />

                      <button
                        type="button"
                        onClick={() =>
                          setShowLoginPassword(
                            !showLoginPassword
                          )
                        }
                        aria-label={
                          showLoginPassword
                            ? 'Hide password'
                            : 'Show password'
                        }
                        className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-slate-500 hover:text-shelf-primary"
                      >
                        {showLoginPassword ? (
                          <EyeOff
                            size={18}
                          />
                        ) : (
                          <Eye
                            size={18}
                          />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* SIGN IN */}
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={handleOpenForgotPassword}
                      className="text-xs font-semibold text-shelf-primary hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoggingIn}
                    aria-busy={isLoggingIn}
                    className="w-full bg-shelf-primary text-white py-2.5 rounded-lg text-sm font-bold hover:opacity-95 transition shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isLoggingIn ? 'Signing in...' : 'Sign in'}
                  </button>

                  <div className="relative py-1 text-center text-xs text-slate-500">
                    <span className="relative z-10 bg-white px-3">or</span>
                    <span className="absolute inset-x-0 top-1/2 border-t border-slate-200" aria-hidden="true" />
                  </div>
                  <button
                    type="button"
                    onClick={handlePasskeyLogin}
                    disabled={isLoggingIn}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-shelf-primary transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                  >
                    <Fingerprint size={18} aria-hidden="true" />
                    {isLoggingIn ? 'Checking passkey…' : 'Sign in with passkey'}
                  </button>
                  <p className="-mt-2 text-center text-xs leading-5 text-slate-500">
                    Use fingerprint, Face ID, or your phone’s screen lock. Set up a passkey in Account security first.
                  </p>

                  {/* REGISTER LINK */}

                  <div className="text-center pt-2">
                    <p className="text-xs text-slate-600">
                      Don’t have an account?{' '}

                      <button
                        type="button"
                        onClick={() => {
                          setError('');
                          setCanResendVisitorOtp(
                            false
                          );
                          setView(
                            'register'
                          );
                        }}
                        className="font-bold text-shelf-primary hover:underline"
                      >
                        Register as visitor
                      </button>
                    </p>
                  </div>
            </form>
          )}

          {view === 'mfa' && mfaPending && (
            <form onSubmit={handleVerifyLoginMfa} className="space-y-4" autoComplete="off">
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                <p className="font-bold">{mfaPending.mfaSetupRequired ? 'Secure your administrator account' : 'Verify your identity'}</p>
                <p className="mt-1 text-xs leading-5">{mfaPending.mfaSetupRequired ? 'Scan this QR code with an authenticator app, then enter the six-digit code to finish securing your account. To use another phone, scan this same QR code on it before continuing.' : 'Enter the current six-digit code from your authenticator app to continue.'}</p>
              </div>
              {mfaPending.mfaSetupRequired && mfaPending.mfaQrCode && (
                <div className="mx-auto w-fit rounded-xl border border-slate-200 bg-white p-3"><img src={mfaPending.mfaQrCode} alt="Scan this QR code with your authenticator app" className="h-44 w-44" /><p className="mt-2 max-w-52 break-all text-center font-mono text-xs text-slate-500">{mfaPending.mfaSecret}</p></div>
              )}
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700" htmlFor="login-mfa-code">6-digit authenticator code</label>
              <input id="login-mfa-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" className="w-full rounded-lg border border-slate-300 px-4 py-3 text-center text-2xl font-bold tracking-[0.5em] text-slate-900 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20" />
              <button type="submit" disabled={isMfaSubmitting || mfaCode.length !== 6} className="w-full rounded-lg bg-shelf-primary px-4 py-3 text-sm font-bold text-white hover:opacity-95 disabled:opacity-50">{isMfaSubmitting ? 'Verifying…' : mfaPending.mfaSetupRequired ? 'Enable MFA and continue' : 'Verify and sign in'}</button>
              <button type="button" disabled={isMfaSubmitting} onClick={() => void handleCancelMfaLogin()} className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel sign-in</button>
            </form>
          )}

          {/* =====================================================
              FORGOT PASSWORD
          ===================================================== */}

          {view === 'forgot' &&
            (resetStep === 'request' ||
              resetStep === 'verify' ||
              resetStep === 'password') && (
              <form
                onSubmit={
                  resetStep === 'request'
                    ? handleRequestResetCode
                    : resetStep === 'verify'
                      ? handleVerifyResetCode
                      : handleApplyNewPassword
                }
                className="space-y-4"
                autoComplete="off"
              >
                {/* STEP 1: EMAIL */}

                {resetStep ===
                  'request' && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1 uppercase tracking-wider">
                        School email address
                      </label>

                      <input
                        type="email"
                        name="reset_email"
                        required
                        autoComplete="email"
                        placeholder="email@example.com"
                        value={
                          resetEmail
                        }
                        onChange={(event) =>
                          setResetEmail(
                            event.target
                              .value
                          )
                        }
                        className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={
                        isResetSubmitting
                      }
                      className="w-full bg-shelf-primary text-white py-2.5 rounded-lg text-sm font-bold hover:opacity-95 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isResetSubmitting
                        ? 'Sending code...'
                        : 'Send verification code'}
                    </button>
                  </>
                )}

                {/* STEP 2: CODE */}

                {resetStep ===
                  'verify' && (
                  <>
                    {resetNotice && (
                      <div className="text-xs font-semibold rounded-lg px-3 py-2 bg-blue-50 text-blue-800 border border-blue-200">
                        {resetNotice}
                      </div>
                    )}

                    <p
                      className={`text-center text-xs font-semibold ${
                        resetTimeRemaining > 0
                          ? 'text-slate-600'
                          : 'text-red-700'
                      }`}
                      role="status"
                      aria-live="polite"
                    >
                      {resetTimeRemaining > 0
                        ? `Code expires in ${String(Math.floor(resetTimeRemaining / 60)).padStart(2, '0')}:${String(resetTimeRemaining % 60).padStart(2, '0')}.`
                        : 'This code has expired. Request a new code to continue.'}
                    </p>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1 uppercase tracking-wider">
                        Verification code
                      </label>

                      <input
                        type="text"
                        name="reset_code"
                        required
                        inputMode="numeric"
                        maxLength={6}
                        autoComplete="one-time-code"
                        placeholder="000000"
                        value={
                          resetCode
                        }
                        onChange={(event) =>
                          setResetCode(
                            event.target
                              .value
                              .replace(
                                /\D/g,
                                '',
                              )
                          )
                        }
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg text-center text-2xl font-bold tracking-[0.5em] text-slate-800 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={
                        isResetSubmitting ||
                        resetTimeRemaining === 0
                      }
                      className="w-full bg-shelf-primary text-white py-2.5 rounded-lg text-sm font-bold hover:opacity-95 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isResetSubmitting
                        ? 'Verifying...'
                        : 'Verify code'}
                    </button>

                    <button
                      type="button"
                      onClick={handleResendResetCode}
                      disabled={
                        isResetSubmitting ||
                        (resetTimeRemaining > 0 &&
                          resetResendRemaining > 0)
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-bold text-shelf-primary transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isResetSubmitting
                        ? 'Sending code...'
                        : resetTimeRemaining === 0 ||
                            resetResendRemaining === 0
                          ? 'Resend code'
                          : `Resend Code in ${resetResendRemaining}s`}
                    </button>

                    <div className="text-center">
                      <button
                        type="button"
                        onClick={() => {
                          setError('');
                          setResetCode('');
                          setResetStep(
                            'request'
                          );
                        }}
                        className="text-xs font-semibold text-shelf-primary hover:underline"
                      >
                        Use a different email
                      </button>
                    </div>
                  </>
                )}

                {/* STEP 3: NEW PASSWORD */}

                {resetStep ===
                  'password' && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1 uppercase tracking-wider">
                        New password
                      </label>

                      <div className="relative">
                        <input
                          type={
                            showResetPassword
                              ? 'text'
                              : 'password'
                          }
                          name="reset_new_password"
                          required
                          autoComplete="new-password"
                          onCopy={preventPasswordClipboard}
                          onCut={preventPasswordClipboard}
                          onPaste={preventPasswordClipboard}
                          onDrop={preventPasswordClipboard}
                          placeholder="••••••••"
                          value={
                            resetPassword
                          }
                          onChange={(event) =>
                            setResetPassword(
                              event.target
                                .value
                            )
                          }
                          className="w-full px-4 py-2.5 pr-12 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                        />

                        <button
                          type="button"
                          onClick={() =>
                            setShowResetPassword(
                              !showResetPassword
                            )
                          }
                          className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-slate-400 hover:text-slate-600"
                          aria-label={
                            showResetPassword
                              ? 'Hide password'
                              : 'Show password'
                          }
                        >
                          {showResetPassword
                            ? (
                                <EyeOff
                                  size={18}
                                />
                              )
                            : (
                                <Eye
                                  size={18}
                                />
                              )}
                        </button>
                      </div>
                    </div>
                       
                    {/* PASSWORD REQUIREMENTS CHECKLIST */}
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                      <p className="text-xs font-bold text-slate-700">
                        Password requirements
                      </p>

                      {[
                        {
                          label: 'At least 12 characters',
                          met: resetPassword.length >= 12,
                        },
                        {
                          label: 'At least one uppercase letter (A–Z)',
                          met: /[A-Z]/.test(resetPassword),
                        },
                        {
                          label: 'At least one lowercase letter (a–z)',
                          met: /[a-z]/.test(resetPassword),
                        },
                        {
                          label: 'At least one number (0–9)',
                          met: /[0-9]/.test(resetPassword),
                        },
                        {
                          label: 'At least one special character (!@#$...)',
                          met: /[^A-Za-z0-9]/.test(resetPassword),
                        },
                      ].map((rule) => (
                        <div
                          key={rule.label}
                          className={`flex items-center gap-2 text-xs ${
                            rule.met
                              ? 'text-green-700'
                              : 'text-slate-500'
                          }`}
                        >
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                              rule.met
                                ? 'bg-green-100 text-green-700'
                                : 'bg-slate-200 text-slate-500'
                            }`}
                            aria-hidden="true"
                          >
                            {rule.met ? '✓' : '•'}
                          </span>
                          <span>{rule.label}</span>
                        </div>
                      ))}
                    </div>     
                    
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1 uppercase tracking-wider">
                        Confirm new password
                      </label>

                      <div className="relative">
                        <input
                          type={
                            showResetConfirmPassword
                              ? 'text'
                              : 'password'
                          }
                          name="reset_confirm_password"
                          required
                          autoComplete="new-password"
                          onCopy={preventPasswordClipboard}
                          onCut={preventPasswordClipboard}
                          onPaste={preventPasswordClipboard}
                          onDrop={preventPasswordClipboard}
                          placeholder="••••••••"
                          value={resetConfirmPassword}
                          onChange={(event) =>
                            setResetConfirmPassword(event.target.value)
                          }
                          className="w-full px-4 py-2.5 pr-12 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                        />

                        <button
                          type="button"
                          onClick={() =>
                            setShowResetConfirmPassword(
                              !showResetConfirmPassword
                            )
                          }
                          className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-slate-400 hover:text-slate-600"
                          aria-label={
                            showResetConfirmPassword
                              ? 'Hide confirm password'
                              : 'Show confirm password'
                          }
                        >
                          {showResetConfirmPassword ? (
                            <EyeOff size={18} />
                          ) : (
                            <Eye size={18} />
                          )}
                        </button>
                      </div>
                    </div>

                    {resetPassword.length >
                      0 &&
                      !resetPasswordsMatch && (
                        <p className="text-xs font-semibold text-red-600">
                          The passwords do not
                          match.
                        </p>
                      )}

                    <button
                      type="submit"
                      disabled={
                        isResetSubmitting
                      }
                      className="w-full bg-shelf-primary text-white py-2.5 rounded-lg text-sm font-bold hover:opacity-95 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isResetSubmitting
                        ? 'Updating password...'
                        : 'Update password'}
                    </button>
                  </>
                )}
              </form>
            )}

          {/* =====================================================
              FORGOT PASSWORD: DONE
          ===================================================== */}

          {view === 'forgot' &&
            resetStep === 'done' && (
              <>
                <div className="text-xs font-semibold rounded-lg px-3 py-2 bg-green-50 text-green-800 border border-green-200">
                  {resetNotice}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    resetToLogin();
                  }}
                  className="w-full bg-shelf-primary text-white py-2.5 rounded-lg text-sm font-bold hover:opacity-95 transition shadow-sm"
                >
                  Back to sign in
                </button>
              </>
            )}
        </div>
      </div>
    </div>
  );
}
