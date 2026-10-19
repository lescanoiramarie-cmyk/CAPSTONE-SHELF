
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import {
  Check,
  Circle,
  Eye,
  EyeOff,
  Camera,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/useAuth.js';
import libraryBg from '../../assets/library.jpg';
import { philippines } from '@ianlabicani/geoph-lite';
import { validateVisitorFullName } from '../../lib/visitorValidation.js';


function SearchableLocationSelect({
  label,
  options = [],
  value,
  onChange,
  placeholder,
  disabled = false,
}) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const selectedOption = options.find(
    (option) => option.psgc_code === value
  );

  useEffect(() => {
    setQuery(selectedOption?.name || '');
  }, [selectedOption?.name, value]);

  const filteredOptions = options
    .filter((option) =>
      String(option.name || '')
        .toLowerCase()
        .includes(query.toLowerCase())
    )
    .slice(0, 100);

  return (
    <div className="relative w-full min-w-0">
      <label className="mb-1.5 block text-xs font-semibold text-slate-700">
        {label}
      </label>

      <input
        type="text"
        required
        disabled={disabled}
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        onChange={(event) => {
          const nextQuery = event.target.value;
          setQuery(nextQuery);
          setIsOpen(true);

          if (value) onChange('');
        }}
        className="box-border h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
      />

      {isOpen && !disabled && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => (
              <button
                key={option.psgc_code}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.psgc_code);
                  setQuery(option.name);
                  setIsOpen(false);
                }}
                className="block min-h-10 w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              >
                {option.name}
              </button>
            ))
          ) : (
            <p className="px-3 py-3 text-sm text-slate-500">
              No matching location found.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PasswordRequirement({ valid, children }) {
  return (
    <li
      className={`flex items-center gap-2 ${
        valid ? 'text-green-600' : 'text-slate-500'
      }`}
    >
      <span
        className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
          valid ? 'bg-green-100' : 'bg-slate-100'
        }`}
      >
        {valid ? (
          <Check size={11} aria-hidden="true" />
        ) : (
          <Circle size={5} fill="currentColor" aria-hidden="true" />
        )}
      </span>
      <span>{children}</span>
    </li>
  );
}



function validateContactNumber(value) {
  return /^09\d{9}$/.test(value);
}

export default function VisitorLogin() {
  const navigate = useNavigate();
  const scannerRef = useRef(null);
  const scannerStartPromiseRef = useRef(null);
  const scannerCleanupPromiseRef = useRef(null);
  const qrFileInputRef = useRef(null);

  const [view, setView] = useState('login');
  const [error, setError] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [busy, setBusy] = useState(false);

  // Philippine address: Province -> Municipality/City -> Barangay
  const [provinces, setProvinces] = useState([]);
  const [localities, setLocalities] = useState([]);
  const [barangays, setBarangays] = useState([]);

  const [selectedProvince, setSelectedProvince] = useState('');
  const [selectedLocality, setSelectedLocality] = useState('');
  const [selectedBarangay, setSelectedBarangay] = useState('');

  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState('');

  // Password visibility
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] =
    useState(false);

  // Registration form
  const [formData, setFormData] = useState({
    fullName: '',
    contactNumber: '',
    email: '',
    address: '',
    password: '',
    confirmPassword: '',
  });

  // Login form
  const [loginData, setLoginData] = useState({
    identifier: '',
    password: '',
  });

  // Registration OTP
  const [otpInput, setOtpInput] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [registeredVisitor, setRegisteredVisitor] = useState(null);

  // Password reset
  const [resetStep, setResetStep] = useState('request');
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetNotice, setResetNotice] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  const {
    registerVisitor,
    verifyVisitorOtp,
    resendVisitorOtp,
    requestPasswordResetCode,
    verifyPasswordResetCode,
    applyPasswordReset,
    login,
    loginVisitor,
    establishVisitorSessionFromQr,
  } = useAuth();

  const loginVisitorRef = useRef(loginVisitor);
  useEffect(() => {
    loginVisitorRef.current = loginVisitor;
  }, [loginVisitor]);

  const stopVisitorScanner = useCallback(async () => {
    if (scannerCleanupPromiseRef.current) {
      await scannerCleanupPromiseRef.current;
      return;
    }

    const scanner = scannerRef.current;
    if (!scanner) return;

    const cleanup = (async () => {
      try {
        if (scannerStartPromiseRef.current) {
          try {
            await scannerStartPromiseRef.current;
          } catch {
            // A failed start still needs the scanner element cleared.
          }
        }

        if (scannerRef.current !== scanner) return;

        const state = scanner.getState();
        if (
          state === Html5QrcodeScannerState.SCANNING ||
          state === Html5QrcodeScannerState.PAUSED
        ) {
          await scanner.stop();
        }
      } catch (err) {
        console.warn('QR scanner stop warning:', err?.message || err);
      }

      try {
        await scanner.clear();
      } catch (err) {
        console.warn('QR scanner clear warning:', err?.message || err);
      } finally {
        if (scannerRef.current === scanner) {
          scannerRef.current = null;
        }
        scannerStartPromiseRef.current = null;
      }
    })();

    scannerCleanupPromiseRef.current = cleanup;
    try {
      await cleanup;
    } finally {
      if (scannerCleanupPromiseRef.current === cleanup) {
        scannerCleanupPromiseRef.current = null;
      }
    }
  }, []);

  // Registration password validation
  const passwordRequirements = {
    minLength: formData.password.length >= 12,
    uppercase: /[A-Z]/.test(formData.password),
    lowercase: /[a-z]/.test(formData.password),
    number: /\d/.test(formData.password),
    special: /[^A-Za-z0-9]/.test(formData.password),
  };

  const isPasswordValid =
    Object.values(passwordRequirements).every(Boolean);

  const passwordsMatch =
    formData.password.length > 0 &&
    formData.password === formData.confirmPassword;

  // Password reset validation
  const resetPasswordValid =
    resetPassword.length >= 12 &&
    /[A-Z]/.test(resetPassword) &&
    /[a-z]/.test(resetPassword) &&
    /\d/.test(resetPassword) &&
    /[^A-Za-z0-9]/.test(resetPassword);

  const resetPasswordsMatch =
    resetPassword.length > 0 &&
    resetPassword === resetConfirmPassword;

  // Load all provinces without requiring a Region selection.
  
useEffect(() => {
  let cancelled = false;

  const loadProvinces = async () => {
    setLocationLoading(true);
    setLocationError('');

    try {
      const regionList = await philippines.regions();

      const provinceLists = await Promise.all(
        (regionList || []).map(async (region) => {
          const result = await philippines.provinces(region.psgc_code);
          return result || [];
        })
      );

      const allProvinces = provinceLists
        .flat()
        .filter(
          (province, index, array) =>
            array.findIndex(
              (item) => item.psgc_code === province.psgc_code
            ) === index
        )
        .sort((a, b) => a.name.localeCompare(b.name));

      if (!cancelled) {
        setProvinces(allProvinces);

        if (allProvinces.length === 0) {
          setLocationError('No provinces were returned by the location data.');
        }
      }
    } catch (err) {
      console.error('Failed to load provinces:', err);

      if (!cancelled) {
        setLocationError('Unable to load provinces. Please try again.');
      }
    } finally {
      if (!cancelled) setLocationLoading(false);
    }
  };

  loadProvinces();

  return () => {
    cancelled = true;
  };
}, []);

  // Load municipalities/cities when a province is selected.
  useEffect(() => {
    let cancelled = false;

    const loadLocalities = async () => {
      setLocalities([]);
      setBarangays([]);

      if (!selectedProvince) return;

      setLocationLoading(true);
      setLocationError('');

      try {
        const result = await philippines.localities(selectedProvince);

        if (!cancelled) {
          setLocalities(result || []);
        }
      } catch (err) {
        console.error('Failed to load municipalities/cities:', err);

        if (!cancelled) {
          setLocationError(
            'Unable to load municipalities/cities. Please try again.'
          );
        }
      } finally {
        if (!cancelled) setLocationLoading(false);
      }
    };

    loadLocalities();

    return () => {
      cancelled = true;
    };
  }, [selectedProvince]);

  // Load barangays when a municipality/city is selected.
  useEffect(() => {
    let cancelled = false;

    const loadBarangays = async () => {
      setBarangays([]);

      if (!selectedLocality) return;

      setLocationLoading(true);
      setLocationError('');

      try {
        const result = await philippines.barangays(selectedLocality);

        if (!cancelled) {
          setBarangays(result || []);
        }
      } catch (err) {
        console.error('Failed to load barangays:', err);

        if (!cancelled) {
          setLocationError(
            'Unable to load barangays. Please try again.'
          );
        }
      } finally {
        if (!cancelled) setLocationLoading(false);
      }
    };

    loadBarangays();

    return () => {
      cancelled = true;
    };
  }, [selectedLocality]);

  const updateFormField = (field, value) => {
    setFormData((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateLoginField = (field, value) => {
    setLoginData((current) => ({
      ...current,
      [field]: value,
    }));
  };

  // Login
  const handleLogin = async (event) => {
    event.preventDefault();
    setError('');

    const identifier = loginData.identifier.trim();

    if (!identifier || !loginData.password) {
      setError('Please enter your email/account ID and password.');
      return;
    }

    setBusy(true);

    try {
      const result = await login({
        identifier,
        password: loginData.password,
      });

      if (result?.role === 'visitor') {
        navigate('/visitor');
      } else if (result?.role === 'subadmin') {
        navigate('/subadmin');
      } else if (result?.role === 'superadmin') {
        navigate('/superadmin');
      } else {
        setError('Unknown account role.');
      }
    } catch (err) {
      setError(err.message || 'Invalid email/ID or password.');
    } finally {
      setBusy(false);
    }
  };

  // Registration
  const handleRegister = async (event) => {
    event.preventDefault();
    setError('');

    const fullName = formData.fullName.trim();
    const contactNumber = formData.contactNumber.trim();
    const email = formData.email.trim().toLowerCase();

    const provinceName = provinces.find(
      (item) => item.psgc_code === selectedProvince
    )?.name;

    const localityName = localities.find(
      (item) => item.psgc_code === selectedLocality
    )?.name;

    const barangayName = barangays.find(
      (item) => item.psgc_code === selectedBarangay
    )?.name;

    if (!fullName || !contactNumber || !email) {
  setError('Please complete all required fields.');
  return;
}

    const fullNameError = validateVisitorFullName(fullName);

    if (fullNameError) {
      setError(fullNameError);
      return;
    }

    if (!validateContactNumber(contactNumber)) {
      setError(
        'Contact number must start with 09 and contain exactly 11 digits.'
      );
      return;
    }

    if (!provinceName || !localityName || !barangayName) {
      setError(
        'Please select your province, municipality/city, and barangay.'
      );
      return;
    }

    if (!isPasswordValid) {
      setError('Password does not meet all requirements.');
      return;
    }

    if (!passwordsMatch) {
      setError('Passwords do not match.');
      return;
    }

    const completeAddress = [
      barangayName,
      localityName,
      provinceName,
    ].join(', ');

    setBusy(true);

    try {
      const result = await registerVisitor({
        fullName,
        contactNumber,
        email,
        address: completeAddress,
        password: formData.password,
      });

      setRegisteredVisitor(result || null);
      setPendingEmail(email);
      setOtpInput('');
      setView('otp');
      setError('');
    } catch (err) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // Verify registration OTP.
  const handleVerifyOtp = async (event) => {
    event.preventDefault();
    setError('');

    const code = otpInput.trim();

    if (!/^\d{6}$/.test(code)) {
      setError('Please enter the 6-digit verification code.');
      return;
    }

    setBusy(true);

    try {
      const visitorId =
        registeredVisitor?.id ||
        registeredVisitor?.visitor?.id ||
        registeredVisitor?.visitorId ||
        pendingEmail;

      const result = await verifyVisitorOtp(visitorId, code);

      if (result?.success === false) {
        setError(result.message || 'Invalid verification code.');
        return;
      }

      setRegisteredVisitor((current) => ({
        ...(current || {}),
        ...(result || {}),
        email: pendingEmail,
      }));

      setView('success');
      setError('');
    } catch (err) {
      setError(err.message || 'Unable to verify the code.');
    } finally {
      setBusy(false);
    }
  };

  // Resend registration OTP.
  const handleResendOtp = async () => {
    setError('');
    setBusy(true);

    try {
      const visitorId =
        registeredVisitor?.id ||
        registeredVisitor?.visitor?.id ||
        registeredVisitor?.visitorId ||
        pendingEmail;

      await resendVisitorOtp(visitorId);
      setError('A new verification code has been requested.');
    } catch (err) {
      setError(err.message || 'Unable to resend the verification code.');
    } finally {
      setBusy(false);
    }
  };

  // Reset registration and return to login.
  const resetToLogin = async () => {
    await stopVisitorScanner();
    setView('login');
    setError('');

    setFormData({
      fullName: '',
      contactNumber: '',
      email: '',
      address: '',
      password: '',
      confirmPassword: '',
    });

    setLoginData({
      identifier: '',
      password: '',
    });

    setOtpInput('');
    setPendingEmail('');
    setRegisteredVisitor(null);

    setSelectedProvince('');
    setSelectedLocality('');
    setSelectedBarangay('');

    setLocalities([]);
    setBarangays([]);

    setLocationError('');
    setShowLoginPassword(false);
    setShowRegisterPassword(false);
    setShowConfirmPassword(false);
    setShowScanner(false);
  };

  // Open password reset.
  const handleOpenForgotPassword = () => {
    setResetEmail(
      loginData.identifier.trim().includes('@')
        ? loginData.identifier.trim().toLowerCase()
        : ''
    );

    setResetStep('request');
    setResetCode('');
    setResetPassword('');
    setResetConfirmPassword('');
    setResetNotice('');
    setResetError('');
    setError('');
    setView('forgot');
  };

  // Request password reset code.
  const handleRequestResetCode = async (event) => {
    event.preventDefault();
    setResetError('');
    setResetNotice('');

    const email = resetEmail.trim().toLowerCase();

    if (!email) {
      setResetError('Please enter your registered email address.');
      return;
    }

    setResetLoading(true);

    try {
      const result = await requestPasswordResetCode(email);

      if (result?.success === false) {
        setResetError(result.message || 'Unable to send reset code.');
        return;
      }

      setResetStep('verify');
      setResetNotice(
        result?.message || 'If the account is eligible, a reset code will be sent to the email.'
      );
    } catch (err) {
      setResetError(err.message || 'Unable to request a reset code.');
    } finally {
      setResetLoading(false);
    }
  };

  // Verify password reset code.
  const handleVerifyResetCode = async (event) => {
    event.preventDefault();
    setResetError('');
    setResetNotice('');

    if (!/^\d{6}$/.test(resetCode.trim())) {
      setResetError('Please enter the 6-digit verification code.');
      return;
    }

    setResetLoading(true);

    try {
      const result = await verifyPasswordResetCode(
        resetEmail.trim().toLowerCase(),
        resetCode.trim()
      );

      if (result?.success === false) {
        setResetError(
          result.message || 'Invalid verification code. Please try again.'
        );
        return;
      }

      setResetStep('password');
      setResetNotice('Verification successful. Create a new password.');
    } catch (err) {
      setResetError(err.message || 'Unable to verify the code.');
    } finally {
      setResetLoading(false);
    }
  };

  // Apply new password.
  const handleApplyNewPassword = async (event) => {
    event.preventDefault();
    setResetError('');
    setResetNotice('');

    if (!resetPasswordValid) {
      setResetError(
        'Password must be at least 12 characters and include uppercase, lowercase, a number, and a special character.'
      );
      return;
    }

    if (!resetPasswordsMatch) {
      setResetError('Passwords do not match.');
      return;
    }

    setResetLoading(true);

    try {
      const result = await applyPasswordReset({
        email: resetEmail.trim().toLowerCase(),
        code: resetCode.trim(),
        newPassword: resetPassword,
      });

      if (result?.success === false) {
        setResetError(
          result.message || 'Unable to reset your password.'
        );
        return;
      }

      setLoginData({
        identifier: resetEmail.trim().toLowerCase(),
        password: '',
      });

      setResetPassword('');
      setResetConfirmPassword('');
      setResetNotice(
        result?.message || 'Password reset successful. You can now sign in.'
      );
      setResetStep('done');
    } catch (err) {
      setResetError(err.message || 'Unable to reset your password.');
    } finally {
      setResetLoading(false);
    }
  };

  const handleResetBackToLogin = () => {
    setView('login');
    setResetStep('request');
    setResetCode('');
    setResetPassword('');
    setResetConfirmPassword('');
    setResetNotice('');
    setResetError('');
    setError('');
  };

  // QR camera scanner lifecycle.
  useEffect(() => {
    if (!showScanner) return undefined;

    let cancelled = false;
    let processing = false;

    const startCamera = async () => {
      try {
        const scanner = new Html5Qrcode('visitor-qr-reader');
        scannerRef.current = scanner;

        const startPromise = scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          async (decodedText) => {
            if (cancelled || processing) return;

            processing = true;
            const qrValue = decodedText.trim();

            try {
              await stopVisitorScanner();
              if (cancelled) return;
              setShowScanner(false);

              await loginVisitorRef.current({
                identifier: qrValue,
                password: '',
              });
              navigate('/visitor');
            } catch (err) {
              if (!cancelled) {
                setError(
                  err.message || 'QR code scanned, but login failed.'
                );
              }
            }
          },
          () => {}
        );
        scannerStartPromiseRef.current = startPromise;
        await startPromise;

        if (cancelled) {
          await stopVisitorScanner();
        }
      } catch (err) {
        console.error('Camera error:', err);
        await stopVisitorScanner();

        if (!cancelled) {
          setShowScanner(false);
          setError(
            err.message ||
              'Unable to access the camera. Please allow camera permission and try again.'
          );
        }
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      void stopVisitorScanner();
    };
  }, [showScanner, navigate, stopVisitorScanner]);

  // Scan QR image uploaded from the device.
  const handleQrFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    setError('');
    setBusy(true);

    try {
      const scanner = new Html5Qrcode('visitor-qr-file-reader');
      const decodedText = await scanner.scanFile(file, true);

      try {
        await scanner.clear();
      } catch {
        // Ignore scanner cleanup errors.
      }

      await loginVisitor({
        identifier: decodedText.trim(),
        password: '',
      });

      navigate('/visitor');
    } catch (err) {
      setError(
        err.message || 'Unable to read this QR image or sign in with it.'
      );
    } finally {
      setBusy(false);
    }
  };

  const qrPassValue =
    registeredVisitor?.qr_code ||
    registeredVisitor?.visitor?.qr_code ||
    registeredVisitor?.qrCode ||
    registeredVisitor?.visitor?.qrCode ||
    registeredVisitor?.id ||
    registeredVisitor?.visitor?.id ||
    pendingEmail;

  return (
    <div className="flex min-h-screen w-full bg-shelf-bg">
      <style>
        {`
          input[type="password"]::-ms-reveal,
          input[type="password"]::-ms-clear {
            display: none;
          }
        `}
      </style>

      {/* Branding panel */}
      <div
        className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-cover bg-center p-12 text-white lg:flex"
        style={{
          backgroundImage: `
            linear-gradient(
              rgba(0, 32, 70, 0.85),
              rgba(0, 32, 70, 0.85)
            ),
            url(${libraryBg})
          `,
        }}
      >
        <div className="relative z-10 flex items-center gap-3">
          <span className="text-xl font-bold tracking-wider">
            SHELF ILMS
          </span>
        </div>

        <div className="relative z-10 max-w-lg space-y-4">
          <span className="inline-block rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold backdrop-blur-md">
            Digital Library Management System
          </span>

          <h1 className="text-4xl font-extrabold leading-tight">
            Explore Learning Resources &amp; Campus Libraries.
          </h1>

          <p className="text-sm text-slate-300">
            Access your library account, explore available resources,
            manage your borrowing activity, and use your digital library pass.
          </p>
        </div>

        <div className="relative z-10 text-xs text-slate-400">
          © SHELF System. All rights reserved.
        </div>
      </div>

      {/* Main panel */}
      <div className="flex w-full items-center justify-center overflow-y-auto p-4 sm:p-8 lg:w-1/2 lg:p-12">
        <div className="my-auto w-full max-w-md space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
          {/* Header */}
          <div className="space-y-1 text-center lg:text-left">
            <h2 className="text-2xl font-bold text-shelf-text">
              {view === 'register' && 'Visitor Registration'}
              {view === 'otp' && 'Verify Your Email'}
              {view === 'success' && 'Registration Successful'}
              {view === 'login' && 'SHELF ILMS Login'}
              {view === 'forgot' && 'Reset Your Password'}
            </h2>

            <p className="text-xs text-slate-500">
              {view === 'register' &&
                'Enter your details to create your visitor account.'}
              {view === 'otp' &&
                'Enter the verification code sent to your email.'}
              {view === 'success' &&
                'Your registration has been verified.'}
              {view === 'login' &&
                'Sign in using your email, account ID, or QR pass ID.'}
              {view === 'forgot' &&
                'Follow the steps below to reset your account password.'}
            </p>
          </div>

          {/* General error/status */}
          {error && (
            <div
              role="alert"
              className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                error.includes('requested')
                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                  : 'border-red-200 bg-red-50 text-red-600'
              }`}
            >
              {error}
            </div>
          )}

          {/* Login */}
          {view === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Email or Account ID
                </label>
                <input
                  type="text"
                  required
                  autoComplete="username"
                  value={loginData.identifier}
                  onChange={(event) =>
                    updateLoginField('identifier', event.target.value)
                  }
                  placeholder="Enter your email or account ID"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Password
                </label>

                <div className="relative">
                  <input
                    type={showLoginPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={loginData.password}
                    onChange={(event) =>
                      updateLoginField('password', event.target.value)
                    }
                    placeholder="Enter your password"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                  />

                  <button
                    type="button"
                    aria-label={
                      showLoginPassword ? 'Hide password' : 'Show password'
                    }
                    onClick={() =>
                      setShowLoginPassword((current) => !current)
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                  >
                    {showLoginPassword ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>
              </div>

              <div className="text-right">
                <button
                  type="button"
                  onClick={handleOpenForgotPassword}
                  className="text-xs font-semibold text-shelf-primary hover:underline"
                >
                  Forgot Password?
                </button>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-shelf-primary py-2.5 text-sm font-bold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? 'Signing In...' : 'Sign In'}
              </button>

              <div className="space-y-2 border-t border-slate-200 pt-4">
                <p className="text-center text-xs text-slate-500">
                  Prefer to use your digital library pass?
                </p>

                <button
                  type="button"
                  onClick={async () => {
                    setError('');
                    if (showScanner) {
                      await stopVisitorScanner();
                      setShowScanner(false);
                    } else {
                      setShowScanner(true);
                    }
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Camera size={17} />
                  {showScanner ? 'Close QR Scanner' : 'Scan QR Pass'}
                </button>

                <button
                  type="button"
                  onClick={() => qrFileInputRef.current?.click()}
                  disabled={busy}
                  className="w-full rounded-lg border border-slate-300 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Upload QR Image
                </button>

                <input
                  ref={qrFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleQrFileChange}
                />

                <div id="visitor-qr-file-reader" className="hidden" />

                {showScanner && (
                  <div className="space-y-2">
                    <div
                      id="visitor-qr-reader"
                      className="w-full overflow-hidden rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        await stopVisitorScanner();
                        setShowScanner(false);
                      }}
                      className="w-full text-sm font-semibold text-slate-500 hover:text-slate-800"
                    >
                      Close Camera
                    </button>
                  </div>
                )}
              </div>

              <p className="text-center text-sm text-slate-600">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setView('register');
                  }}
                  className="font-bold text-shelf-primary hover:underline"
                >
                  Register here
                </button>
              </p>
            </form>
          )}

          {/* Registration */}
          {view === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3">
              <div>
                <label
                  htmlFor="visitor-full-name"
                  className="mb-1 block text-xs font-semibold text-slate-700"
                >
                  Full Name
                </label>

                <input
                  id="visitor-full-name"
                  type="text"
                  required
                  autoComplete="name"
                  value={formData.fullName}
                  onChange={(event) => {
                    updateFormField(
                      'fullName',
                      event.target.value.replace(/\s{2,}/g, ' ')
                    );
                  }}
                  onBlur={() => {
                    if (formData.fullName.trim()) {
                      const nameError = validateVisitorFullName(formData.fullName);
                      if (nameError) setError(nameError);
                      else setError('');
                    }
                  }}
                  placeholder="Enter your first and last name"
                  aria-describedby="visitor-full-name-help"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                />

                <p
                  id="visitor-full-name-help"
                  className="mt-1 text-[11px] text-slate-500"
                >
                  Enter your first name and last name.
                </p>
              </div>
              <div>
                <label
                  htmlFor="visitor-contact-number"
                  className="mb-1 block text-xs font-semibold text-slate-700"
                >
                  Contact Number
                </label>

                <input
                  id="visitor-contact-number"
                  type="tel"
                  required
                  autoComplete="tel"
                  inputMode="numeric"
                  maxLength={11}
                  pattern="09[0-9]{9}"
                  title="Enter an 11-digit Philippine mobile number starting with 09."
                  value={formData.contactNumber}
                  onChange={(event) => {
                    const digits = event.target.value
                      .replace(/\D/g, '')
                      .slice(0, 11);

                    updateFormField('contactNumber', digits);

                    if (error) setError('');
                  }}
                  onBlur={() => {
                    if (
                      formData.contactNumber &&
                      !validateContactNumber(formData.contactNumber)
                    ) {
                      setError(
                        'Contact number must start with 09 and contain exactly 11 digits.'
                      );
                    }
                  }}
                  placeholder="09123456789"
                  aria-describedby="visitor-contact-help"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                />

                <p
                  id="visitor-contact-help"
                  className={`mt-1 text-[11px] ${
                    formData.contactNumber &&
                    !validateContactNumber(formData.contactNumber)
                      ? 'text-red-600'
                      : 'text-slate-500'
                  }`}
                >
                  {formData.contactNumber &&
                  !validateContactNumber(formData.contactNumber)
                    ? 'Must start with 09 and contain exactly 11 digits.'
                    : `${formData.contactNumber.length}/11 digits`}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Email
                </label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={formData.email}
                  onChange={(event) =>
                    updateFormField('email', event.target.value)
                  }
                  placeholder="visitor@email.com"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                />
              </div>

              {/* Address dropdowns */}
              <div className="w-full space-y-3 rounded-lg border border-slate-200 p-4">
                <h3 className="text-xs font-bold text-slate-700">
                  Address
                </h3>

                <SearchableLocationSelect
                  label="Province"
                  options={provinces}
                  value={selectedProvince}
                  placeholder="Search and select province"
                  onChange={(value) => {
                    setSelectedProvince(value);
                    setSelectedLocality('');
                    setSelectedBarangay('');
                    setLocalities([]);
                    setBarangays([]);
                  }}
                />

                <SearchableLocationSelect
                  label="Municipality / City"
                  options={localities}
                  value={selectedLocality}
                  placeholder="Search and select municipality / city"
                  disabled={!selectedProvince || localities.length === 0}
                  onChange={(value) => {
                    setSelectedLocality(value);
                    setSelectedBarangay('');
                    setBarangays([]);
                  }}
                />

                <div className="relative w-full min-w-0">
                  <label
                    htmlFor="visitor-barangay"
                    className="mb-1.5 block text-xs font-semibold text-slate-700"
                  >
                    Barangay
                  </label>

                  <select
                    id="visitor-barangay"
                    value={selectedBarangay}
                    onChange={(event) => setSelectedBarangay(event.target.value)}
                    disabled={!selectedLocality || barangays.length === 0}
                    required
                    className="box-border h-10 w-full appearance-none rounded-lg border border-slate-300 bg-white px-3 pr-9 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <option value="">
                      {!selectedLocality
                        ? 'Select municipality / city first'
                        : barangays.length === 0
                          ? 'Loading barangays...'
                          : 'Select barangay'}
                    </option>

                    {barangays.map((barangay) => (
                      <option
                        key={barangay.psgc_code}
                        value={barangay.psgc_code}
                      >
                        {barangay.name}
                      </option>
                    ))}
                  </select>

                  <div className="pointer-events-none absolute right-3 top-8.5 text-slate-500">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </div>
                </div>

                {locationLoading && (
                  <p className="text-xs text-slate-500">
                    Loading location data...
                  </p>
                )}

                {locationError && (
                  <p className="text-xs text-red-600">
                    {locationError}
                  </p>
                )}
              </div>

              {/* Password */}
              <div className="w-full min-w-0">
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Password
                </label>

                <div className="relative">                 
                  <input
                    type={showRegisterPassword ? 'text' : 'password'}
                    required
                    minLength={12}
                    autoComplete="new-password"
                    value={formData.password}
                    onChange={(event) =>
                      updateFormField('password', event.target.value)
                    }
                    onCopy={(event) => event.preventDefault()}
                    onCut={(event) => event.preventDefault()}
                    onPaste={(event) => event.preventDefault()}
                    onDrop={(event) => event.preventDefault()}
                    onKeyDown={(event) => {
                      if (
                        (event.ctrlKey || event.metaKey) &&
                        ['c', 'v', 'x'].includes(event.key.toLowerCase())
                      ) {
                        event.preventDefault();
                      }
                    }}
                    placeholder="Create a strong password"
                    className="box-border h-10 w-full rounded-lg border border-slate-300 px-3 pr-12 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />

                  <button
                    type="button"
                    aria-label={
                      showRegisterPassword ? 'Hide password' : 'Show password'
                    }
                    onClick={() =>
                      setShowRegisterPassword((current) => !current)
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                  >
                    {showRegisterPassword ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>

                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-2 text-[11px] font-semibold text-slate-700">
                    Password requirements
                  </p>

                  <ul className="space-y-1 text-[11px]">
                    <PasswordRequirement valid={passwordRequirements.minLength}>
                      At least 12 characters
                    </PasswordRequirement>

                    <PasswordRequirement valid={passwordRequirements.uppercase}>
                      At least 1 uppercase letter
                    </PasswordRequirement>

                    <PasswordRequirement valid={passwordRequirements.lowercase}>
                      At least 1 lowercase letter
                    </PasswordRequirement>

                    <PasswordRequirement valid={passwordRequirements.number}>
                      At least 1 number
                    </PasswordRequirement>

                    <PasswordRequirement valid={passwordRequirements.special}>
                      At least 1 special character
                    </PasswordRequirement>
                  </ul>
                </div>
              </div>

              {/* Confirm Password */}
              <div className="w-full min-w-0">
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Confirm Password
                </label>

                <div className="relative">               
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    minLength={12}
                    autoComplete="new-password"
                    value={formData.confirmPassword}
                    onChange={(event) =>
                      updateFormField('confirmPassword', event.target.value)
                    }
                    onCopy={(event) => event.preventDefault()}
                    onCut={(event) => event.preventDefault()}
                    onPaste={(event) => event.preventDefault()}
                    onDrop={(event) => event.preventDefault()}
                    onKeyDown={(event) => {
                      if (
                        (event.ctrlKey || event.metaKey) &&
                        ['c', 'v', 'x'].includes(event.key.toLowerCase())
                      ) {
                        event.preventDefault();
                      }
                    }}
                    placeholder="Re-enter your password"
                    className={`box-border h-10 w-full rounded-lg border px-3 pr-12 text-sm text-slate-800 outline-none transition focus:ring-2 focus:ring-blue-100 ${
                      !formData.confirmPassword
                        ? 'border-slate-300 focus:border-blue-500'
                        : passwordsMatch
                          ? 'border-green-400 focus:border-green-500'
                          : 'border-red-300 focus:border-red-500'
                    }`}
                  />

                  <button
                    type="button"
                    aria-label={
                      showConfirmPassword ? 'Hide password' : 'Show password'
                    }
                    onClick={() =>
                      setShowConfirmPassword((current) => !current)
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                  >
                    {showConfirmPassword ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>

                {formData.confirmPassword.length > 0 && (
                  <p
                    className={`mt-1.5 text-[11px] font-semibold ${
                      passwordsMatch ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {passwordsMatch ? (
                        <Check size={13} />
                      ) : (
                        <X size={13} />
                      )}

                      {passwordsMatch
                        ? 'Passwords match.'
                        : 'Passwords do not match.'}
                    </span>
                  </p>
                )}
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={
                  busy ||
                  !isPasswordValid ||
                  !passwordsMatch ||
                  !selectedProvince ||
                  !selectedLocality ||
                  !selectedBarangay
                }
                className="h-10 w-full rounded-lg bg-shelf-primary px-4 text-sm font-bold text-white shadow-sm transition hover:opacity-95 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
              >
                {busy ? 'Processing...' : 'Send Verification Code'}
              </button>

              {/* Back to Sign In */}
              <button
                type="button"
                onClick={resetToLogin}
                className="h-10 w-full rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                Back to Sign In
              </button>
              </form>
              )}

          {/* OTP verification */}
          {view === 'otp' && (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <p className="text-sm text-slate-600">
                Verification code sent to{' '}
                <strong>{pendingEmail}</strong>
              </p>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  6-Digit Verification Code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={otpInput}
                  onChange={(event) =>
                    setOtpInput(
                      event.target.value.replace(/\D/g, '').slice(0, 6)
                    )
                  }
                  placeholder="Enter 6-digit code"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-center font-mono text-sm tracking-[0.35em] focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                />
              </div>

              <button
                type="submit"
                disabled={busy || otpInput.length !== 6}
                className="w-full rounded-lg bg-shelf-primary py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {busy ? 'Verifying...' : 'Verify Email'}
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={handleResendOtp}
                className="w-full text-sm font-semibold text-shelf-primary hover:underline disabled:opacity-50"
              >
                Resend Verification Code
              </button>

              <button
                type="button"
                onClick={resetToLogin}
                className="w-full text-sm font-semibold text-slate-600 hover:underline"
              >
                Back to Sign In
              </button>
            </form>
          )}

          {/* Registration success / QR pass */}
          {view === 'success' && (
            <div className="space-y-4 text-center">
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
                Your email verification was successful.
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <p className="mb-1 text-sm font-bold text-slate-800">
                  SHELF Digital Library Pass
                </p>
                <p className="mb-4 text-xs text-slate-500">
                  {registeredVisitor?.fullName ||
                    registeredVisitor?.visitor?.full_name ||
                    formData.fullName}
                </p>

                <div className="flex justify-center">
                  <QRCodeSVG
                    value={String(qrPassValue)}
                    size={190}
                    level="H"
                    includeMargin
                  />
                </div>

                <p className="mt-3 break-all text-xs text-slate-500">
                  {qrPassValue}
                </p>
              </div>

              <p className="text-xs text-slate-500">
                Keep your QR pass for library attendance and circulation
                services.
              </p>

              <button
                type="button"
                onClick={async () => {
                  try {
                    if (establishVisitorSessionFromQr && registeredVisitor) {
                      await establishVisitorSessionFromQr(registeredVisitor);
                    }
                    navigate('/visitor');
                  } catch (err) {
                    setError(
                      err.message ||
                        'Your account is verified. Please sign in to continue.'
                    );
                    setView('login');
                    setLoginData({
                      identifier: pendingEmail,
                      password: '',
                    });
                  }
                }}
                className="w-full rounded-lg bg-shelf-primary py-2.5 text-sm font-bold text-white hover:opacity-95"
              >
                Enter Library Portal
              </button>

              <button
                type="button"
                onClick={resetToLogin}
                className="w-full text-sm font-semibold text-slate-600 hover:underline"
              >
                Back to Sign In
              </button>
            </div>
          )}

          {/* Forgot password */}
          {view === 'forgot' && (
            <form
              onSubmit={
                resetStep === 'request'
                  ? handleRequestResetCode
                  : resetStep === 'verify'
                    ? handleVerifyResetCode
                    : resetStep === 'password'
                      ? handleApplyNewPassword
                      : (event) => event.preventDefault()
              }
              className="space-y-4"
            >
              {resetStep !== 'done' && (
                <div>
                  <h3 className="text-lg font-bold text-slate-800">
                    {resetStep === 'request' && 'Forgot Password?'}
                    {resetStep === 'verify' && 'Verify Reset Code'}
                    {resetStep === 'password' && 'Create New Password'}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {resetStep === 'request' &&
                      'Enter your registered email address to receive a password reset code.'}
                    {resetStep === 'verify' &&
                      'Enter the 6-digit code sent to your email.'}
                    {resetStep === 'password' &&
                      'Create a new password that meets all security requirements.'}
                  </p>
                </div>
              )}

              {resetNotice && (
                <div
                  role="status"
                  className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700"
                >
                  {resetNotice}
                </div>
              )}

              {resetError && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600"
                >
                  {resetError}
                </div>
              )}

              {resetStep === 'request' && (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Registered Email Address
                    </label>
                    <input
                      type="email"
                      autoComplete="email"
                      required
                      value={resetEmail}
                      onChange={(event) => setResetEmail(event.target.value)}
                      placeholder="visitor@email.com"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={resetLoading || !resetEmail.trim()}
                    className="w-full rounded-lg bg-shelf-primary py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {resetLoading ? 'Sending...' : 'Send Reset Code'}
                  </button>
                </>
              )}

              {resetStep === 'verify' && (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      6-Digit Reset Code
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      required
                      value={resetCode}
                      onChange={(event) =>
                        setResetCode(
                          event.target.value.replace(/\D/g, '').slice(0, 6)
                        )
                      }
                      placeholder="Enter 6-digit code"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-center font-mono text-sm tracking-[0.35em] focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={resetLoading || resetCode.length !== 6}
                    className="w-full rounded-lg bg-shelf-primary py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {resetLoading ? 'Verifying...' : 'Verify Reset Code'}
                  </button>

                  <button
                    type="button"
                    disabled={resetLoading}
                    onClick={handleRequestResetCode}
                    className="w-full text-sm font-semibold text-shelf-primary hover:underline disabled:opacity-50"
                  >
                    Resend Reset Code
                  </button>
                </>
              )}

              {resetStep === 'password' && (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      New Password
                    </label>
                    <div className="relative">
                      <input
                        type={showResetPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        value={resetPassword}
                        onChange={(event) =>
                          setResetPassword(event.target.value)
                        }
                        placeholder="Create a new password"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                      />
                      <button
                        type="button"
                        aria-label={
                          showResetPassword ? 'Hide password' : 'Show password'
                        }
                        onClick={() =>
                          setShowResetPassword((current) => !current)
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                      >
                        {showResetPassword ? (
                          <EyeOff size={18} />
                        ) : (
                          <Eye size={18} />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="mb-2 text-xs font-semibold text-slate-700">
                      Password requirements
                    </p>
                    <ul className="space-y-1 text-xs">
                      <PasswordRequirement valid={resetPassword.length >= 12}>
                        At least 12 characters
                      </PasswordRequirement>
                      <PasswordRequirement valid={/[A-Z]/.test(resetPassword)}>
                        At least 1 uppercase letter
                      </PasswordRequirement>
                      <PasswordRequirement valid={/[a-z]/.test(resetPassword)}>
                        At least 1 lowercase letter
                      </PasswordRequirement>
                      <PasswordRequirement valid={/\d/.test(resetPassword)}>
                        At least 1 number
                      </PasswordRequirement>
                      <PasswordRequirement
                        valid={/[^A-Za-z0-9]/.test(resetPassword)}
                      >
                        At least 1 special character
                      </PasswordRequirement>
                    </ul>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Confirm New Password
                    </label>
                    <div className="relative">
                      <input
                        type={
                          showResetConfirmPassword ? 'text' : 'password'
                        }
                        autoComplete="new-password"
                        required
                        value={resetConfirmPassword}
                        onChange={(event) =>
                          setResetConfirmPassword(event.target.value)
                        }
                        placeholder="Re-enter your new password"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                      />
                      <button
                        type="button"
                        aria-label={
                          showResetConfirmPassword
                            ? 'Hide password'
                            : 'Show password'
                        }
                        onClick={() =>
                          setShowResetConfirmPassword((current) => !current)
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                      >
                        {showResetConfirmPassword ? (
                          <EyeOff size={18} />
                        ) : (
                          <Eye size={18} />
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={
                      resetLoading ||
                      !resetPasswordValid ||
                      !resetPasswordsMatch
                    }
                    className="w-full rounded-lg bg-shelf-primary py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {resetLoading ? 'Updating Password...' : 'Reset Password'}
                  </button>
                </>
              )}

              {resetStep === 'done' && (
                <div className="space-y-3 text-center">
                  <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
                    {resetNotice ||
                      'Password reset successful. You can now sign in.'}
                  </div>
                  <button
                    type="button"
                    onClick={handleResetBackToLogin}
                    className="w-full rounded-lg bg-shelf-primary py-2.5 text-sm font-bold text-white"
                  >
                    Return to Sign In
                  </button>
                </div>
              )}

              {resetStep !== 'done' && (
                <button
                  type="button"
                  disabled={resetLoading}
                  onClick={handleResetBackToLogin}
                  className="w-full text-sm font-semibold text-slate-600 hover:text-shelf-primary hover:underline disabled:opacity-50"
                >
                  Back to Sign In
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
