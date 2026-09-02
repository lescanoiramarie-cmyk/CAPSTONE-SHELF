import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import { Eye, EyeOff, Camera } from 'lucide-react';

import { useAuth } from '../../context/AuthContext';
import libraryBg from '../../assets/library.jpg';

// view = 'login' | 'register' | 'otp' | 'success'

export default function VisitorLogin() {
  const [showScanner, setShowScanner] = useState(false);
  const scannerRef = useRef(null);

  const [view, setView] = useState('login');
  const [error, setError] = useState('');

  // Password visibility
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [formData, setFormData] = useState({
    fullName: '',
    contactNumber: '',
    email: '',
    address: '',
    password: '',
    confirmPassword: '',
  });

  const [loginData, setLoginData] = useState({
    identifier: '',
    password: '',
  });

  const [otpInput, setOtpInput] = useState('');
  const [pendingVisitorId, setPendingVisitorId] = useState(null);

  // Stores the email address used for the pending verification.
  // The OTP itself is NEVER stored in React state.
  const [pendingEmail, setPendingEmail] = useState('');

  const [registeredVisitor, setRegisteredVisitor] = useState(null);

  const {
    registerVisitor,
    verifyVisitorOtp,
    resendVisitorOtp,
    login,
    loginVisitor,
    loginAsVisitorSession,
  } = useAuth();

  const navigate = useNavigate();

  // =========================================================
  // PASSWORD VALIDATION
  // =========================================================

  const passwordRequirements = {
    minLength: formData.password.length >= 8,
    uppercase: /[A-Z]/.test(formData.password),
    lowercase: /[a-z]/.test(formData.password),
    number: /[0-9]/.test(formData.password),
    special: /[^A-Za-z0-9]/.test(formData.password),
  };

  const isPasswordValid =
    passwordRequirements.minLength &&
    passwordRequirements.uppercase &&
    passwordRequirements.lowercase &&
    passwordRequirements.number &&
    passwordRequirements.special;

  const passwordsMatch =
    formData.password.length > 0 &&
    formData.password === formData.confirmPassword;

  // =========================================================
  // QR SCANNER
  // =========================================================

  const startScanner = () => {
    setError('');
    setShowScanner(true);
  };

  const stopScanner = async () => {
    try {
      if (scannerRef.current) {
        await scannerRef.current.stop();
        await scannerRef.current.clear();
        scannerRef.current = null;
      }
    } catch (error) {
      console.error('Scanner cleanup error:', error);
    }

    setShowScanner(false);
  };

  useEffect(() => {
    if (!showScanner) return;

    let scanner;

    const startCamera = async () => {
      try {
        scanner = new Html5Qrcode('visitor-qr-reader');

        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: {
              width: 250,
              height: 250,
            },
          },
          async (decodedText) => {
            const qrValue = decodedText.trim();

            console.log('QR Code detected:', qrValue);

            try {
              await scanner.stop();
            } catch (error) {
              console.error(error);
            }

            try {
              await scanner.clear();
            } catch (error) {
              console.error(error);
            }

            scannerRef.current = null;
            setShowScanner(false);

            setLoginData({
              identifier: qrValue,
              password: '',
            });

            try {
              // QR Pass is for visitors only
              await loginVisitor({
                identifier: qrValue,
                password: '',
              });

              navigate('/visitor');
            } catch (error) {
              setError(
                error.message ||
                  'QR code was scanned, but login failed.'
              );
            }
          },
          () => {
            // Ignore unsuccessful scan attempts.
          }
        );
      } catch (error) {
        console.error('Camera error:', error);

        setShowScanner(false);

        setError(
          'Unable to access the camera. Please allow camera permission and try again.'
        );
      }
    };

    startCamera();

    return () => {
      const cleanup = async () => {
        try {
          if (scannerRef.current) {
            await scannerRef.current.stop();
            await scannerRef.current.clear();
            scannerRef.current = null;
          }
        } catch (error) {
          console.error('Scanner cleanup error:', error);
        }
      };

      cleanup();
    };
  }, [showScanner, loginVisitor, navigate]);

  // =========================================================
  // UNIFIED LOGIN
  // =========================================================

  const handleLogin = async (e) => {
    e.preventDefault();

    setError('');

    const identifier = loginData.identifier.trim();

    if (!identifier) {
      setError(
        'Please enter your email, account ID, or QR pass ID.'
      );
      return;
    }

    if (!loginData.password) {
      setError('Please enter your password.');
      return;
    }

    try {
      const result = await login({
        identifier,
        password: loginData.password,
      });

      if (result.role === 'visitor') {
        navigate('/visitor');
        return;
      }

      if (result.role === 'subadmin') {
        navigate('/subadmin');
        return;
      }

      if (result.role === 'superadmin') {
        navigate('/superadmin');
        return;
      }

      setError('Unknown account role.');
    } catch (err) {
      setError(
        err.message ||
          'Invalid email/ID or password.'
      );
    }
  };

  // =========================================================
  // VISITOR REGISTRATION
  // =========================================================

  const handleRegister = async (e) => {
    e.preventDefault();

    setError('');

    if (!isPasswordValid) {
      setError(
        'Password does not meet all requirements. Please complete all password requirements.'
      );
      return;
    }

    if (!passwordsMatch) {
      setError('Passwords do not match.');
      return;
    }

    try {
      // IMPORTANT:
      // registerVisitor no longer returns the OTP.
      // It returns only the visitor ID after the server-side
      // email process has been requested.
      const { visitorId } =
        await registerVisitor(formData);

      setPendingVisitorId(visitorId);
      setPendingEmail(formData.email.trim());
      setOtpInput('');
      setView('otp');

      setError('');
    } catch (err) {
      setError(
        err.message ||
          'Registration failed. Please try again.'
      );
    }
  };

  // =========================================================
  // OTP VERIFICATION
  // =========================================================

  const handleVerifyOtp = async (e) => {
    e.preventDefault();

    setError('');

    const cleanOtp = otpInput.trim();

    if (cleanOtp.length !== 6) {
      setError(
        'Please enter the complete 6-digit verification code.'
      );
      return;
    }

    try {
      const visitor = await verifyVisitorOtp(
        pendingVisitorId,
        cleanOtp
      );

      setRegisteredVisitor(visitor);
      setView('success');
    } catch (err) {
      setError(
        err.message ||
          'Invalid or expired verification code.'
      );
    }
  };

  // =========================================================
  // RESEND OTP
  // =========================================================

  const handleResendOtp = async () => {
    setError('');

    if (!pendingVisitorId) {
      setError(
        'Registration session not found. Please register again.'
      );
      return;
    }

    try {
      // IMPORTANT:
      // resendVisitorOtp does NOT return the OTP.
      // The new OTP is sent to the visitor's email
      // through the server-side email process.
      await resendVisitorOtp(pendingVisitorId);

      setOtpInput('');

      setError(
        'A new verification code has been sent to your email.'
      );
    } catch (err) {
      setError(
        err.message ||
          'Unable to resend the verification code.'
      );
    }
  };

  // =========================================================
  // RESET TO LOGIN
  // =========================================================

  const resetToLogin = () => {
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
    setPendingVisitorId(null);
    setPendingEmail('');
    setRegisteredVisitor(null);

    setShowLoginPassword(false);
    setShowRegisterPassword(false);
    setShowConfirmPassword(false);
  };

  // =========================================================
  // PASSWORD REQUIREMENT COMPONENT
  // =========================================================

  const PasswordRequirement = ({ valid, children }) => (
    <li
      className={`flex items-center gap-2 ${
        valid
          ? 'text-green-600'
          : 'text-slate-500'
      }`}
    >
      <span
        className={`flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold ${
          valid
            ? 'bg-green-100'
            : 'bg-slate-100'
        }`}
      >
        {valid ? '✓' : '•'}
      </span>

      <span>{children}</span>
    </li>
  );

  // =========================================================
  // UI
  // =========================================================

  return (
    <div className="min-h-screen flex w-full bg-[#f8fafc]">

      {/* =====================================================
          HIDE BROWSER NATIVE PASSWORD REVEAL ICON
         ===================================================== */}

      <style>
        {`
          input[type="password"]::-ms-reveal,
          input[type="password"]::-ms-clear {
            display: none;
          }
        `}
      </style>

      {/* =====================================================
          LEFT BRANDING PANEL
         ===================================================== */}

      <div
        className="hidden lg:flex lg:w-1/2 bg-[#002046] text-white p-12 flex-col justify-between relative overflow-hidden bg-cover bg-center"
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

        <div className="relative z-10 space-y-4 max-w-lg">

          <span className="inline-block px-3 py-1 bg-white/10 backdrop-blur-md text-xs font-semibold rounded-full border border-white/20">
            Digital Library Management System
          </span>

          <h1 className="text-4xl font-extrabold leading-tight">
            Explore Learning Resources & Campus Libraries.
          </h1>

          <p className="text-sm text-slate-300">
            Access your library account, explore available
            resources, manage your borrowing activity, and
            use your digital library pass.
          </p>

        </div>

        <div className="relative z-10 text-xs text-slate-400">
          © SHELF System. All rights reserved.
        </div>
      </div>

      {/* =====================================================
          RIGHT FORM PANEL
         ===================================================== */}

      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12">

        <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl border border-slate-200 space-y-6">

          {/* HEADER */}

          <div className="text-center lg:text-left space-y-1">

            <h2 className="text-2xl font-bold text-[#0f172a]">

              {view === 'register' &&
                'Visitor Registration'}

              {view === 'otp' &&
                'Verify Your Email'}

              {view === 'success' &&
                'Registration Successful'}

              {view === 'login' &&
                'SHELF ILMS Login'}

            </h2>

            <p className="text-xs text-slate-500">

              {view === 'register' &&
                'Fill in your personal details to receive your digital library pass.'}

              {view === 'otp' &&
                'Enter the one-time verification code sent to your email to activate your account.'}

              {view === 'success' &&
                "Save your QR pass — you'll scan it at the library entrance and at the circulation desk."}

              {view === 'login' &&
                'Sign in using your email, account ID, or QR pass ID.'}

            </p>

          </div>

          {/* ERROR / STATUS MESSAGE */}

          {error && (
            <div
              className={`text-xs font-semibold rounded-lg px-3 py-2 ${
                error.includes('sent to your email')
                  ? 'text-blue-700 bg-blue-50 border border-blue-200'
                  : 'text-red-600 bg-red-50 border border-red-200'
              }`}
            >
              {error}
            </div>
          )}

          {/* =================================================
              REGISTRATION SUCCESS
             ================================================= */}

          {view === 'success' &&
            registeredVisitor && (

              <div className="space-y-4 bg-slate-50 p-6 rounded-xl border border-slate-200 text-center">

                <h3 className="text-sm font-bold text-[#0f172a]">
                  Welcome, {registeredVisitor.fullName}!
                </h3>

                <div className="flex justify-center">

                  <div className="p-3 bg-white rounded-lg shadow-sm inline-block border border-slate-200">

                    <QRCodeSVG
                      value={registeredVisitor.qrCode}
                      size={150}
                    />

                  </div>

                </div>

                <p className="text-xs font-mono font-bold text-[#002046]">
                  {registeredVisitor.qrCode}
                </p>

                <p className="text-xs text-slate-500">
                  Save a screenshot of this QR code —
                  scan it at the library entrance for
                  attendance, and at the circulation desk
                  when picking up or returning books.
                </p>

                <button
                  type="button"
                  onClick={() => {
                    loginAsVisitorSession(
                      registeredVisitor
                    );

                    navigate('/visitor');
                  }}
                  className="w-full bg-[#002046] text-white py-2.5 rounded-lg text-sm font-bold hover:opacity-95 transition"
                >
                  Enter Library Portal
                </button>

              </div>
            )}

          {/* =================================================
              OTP
             ================================================= */}

          {view === 'otp' && (

            <form
              onSubmit={handleVerifyOtp}
              className="space-y-4"
            >

              {/* EMAIL DELIVERY MESSAGE */}

              <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs px-4 py-3 rounded-lg">

                <p className="font-semibold">
                  Verification code sent
                </p>

                <p className="mt-1">
                  We sent a 6-digit verification code to:
                </p>

                <p className="font-bold mt-1 break-all">
                  {pendingEmail}
                </p>

                <p className="mt-2 text-blue-700">
                  Please check your inbox and enter the
                  code below. The code will expire after
                  10 minutes.
                </p>

              </div>

              {/* OTP INPUT */}

              <div>

                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  6-Digit Verification Code
                </label>

                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  maxLength={6}
                  value={otpInput}
                  onChange={(e) =>
                    setOtpInput(
                      e.target.value.replace(
                        /\D/g,
                        ''
                      )
                    )
                  }
                  placeholder="Enter 6-digit code"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm tracking-[0.35em] text-center font-mono focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                />

              </div>

              <button
                type="submit"
                disabled={otpInput.length !== 6}
                className={`w-full py-2.5 rounded-lg font-bold text-sm transition shadow-sm ${
                  otpInput.length === 6
                    ? 'bg-[#002046] text-white hover:opacity-95'
                    : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                }`}
              >
                Verify & Activate Account
              </button>

              <button
                type="button"
                onClick={handleResendOtp}
                className="w-full text-xs font-semibold text-[#002046] hover:underline"
              >
                Resend Verification Code
              </button>

            </form>
          )}

          {/* =================================================
              REGISTRATION
             ================================================= */}

          {view === 'register' && (

            <form
              onSubmit={handleRegister}
              className="space-y-3"
            >

              {/* FULL NAME */}

              <div>

                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name
                </label>

                <input
                  type="text"
                  required
                  placeholder="Juan Dela Cruz"
                  value={formData.fullName}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      fullName: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                />

              </div>

              {/* CONTACT NUMBER */}

              <div>

                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Contact Number
                </label>

                <input
                  type="tel"
                  required
                  placeholder="09123456789"
                  value={formData.contactNumber}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      contactNumber: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                />

              </div>

              {/* EMAIL */}

              <div>

                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Email Address
                </label>

                <input
                  type="email"
                  required
                  placeholder="visitor@email.com"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      email: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                />

              </div>

              {/* ADDRESS */}

              <div>

                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Address
                </label>

                <textarea
                  required
                  rows="2"
                  placeholder="Street, City, Province"
                  value={formData.address}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      address: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                />

              </div>

              {/* =================================================
                  CREATE PASSWORD
                 ================================================= */}

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
                    required
                    minLength={8}
                    autoComplete="new-password"
                    placeholder="Example: Juan@2026"
                    value={formData.password}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        password: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 pr-12 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setShowRegisterPassword(
                        !showRegisterPassword
                      )
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-[#002046] transition"
                    aria-label={
                      showRegisterPassword
                        ? 'Hide password'
                        : 'Show password'
                    }
                  >
                    {showRegisterPassword ? (
                      <EyeOff
                        size={18}
                        strokeWidth={2}
                      />
                    ) : (
                      <Eye
                        size={18}
                        strokeWidth={2}
                      />
                    )}
                  </button>

                </div>

                {/* PASSWORD REQUIREMENTS */}

                <div className="mt-2 bg-slate-50 border border-slate-200 rounded-lg p-3">

                  <p className="text-[11px] font-semibold text-slate-700 mb-2">
                    Password requirements:
                  </p>

                  <ul className="text-[11px] space-y-1">

                    <PasswordRequirement
                      valid={passwordRequirements.minLength}
                    >
                      At least 8 characters
                    </PasswordRequirement>

                    <PasswordRequirement
                      valid={passwordRequirements.uppercase}
                    >
                      At least 1 uppercase letter
                    </PasswordRequirement>

                    <PasswordRequirement
                      valid={passwordRequirements.lowercase}
                    >
                      At least 1 lowercase letter
                    </PasswordRequirement>

                    <PasswordRequirement
                      valid={passwordRequirements.number}
                    >
                      At least 1 number
                    </PasswordRequirement>

                    <PasswordRequirement
                      valid={passwordRequirements.special}
                    >
                      At least 1 special character
                    </PasswordRequirement>

                  </ul>

                </div>

              </div>

              {/* =================================================
                  CONFIRM PASSWORD
                 ================================================= */}

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
                    required
                    minLength={8}
                    autoComplete="new-password"
                    placeholder="Re-enter your password"
                    value={formData.confirmPassword}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        confirmPassword: e.target.value,
                      })
                    }
                    className={`w-full px-3 py-2 pr-12 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20 ${
                      formData.confirmPassword.length > 0
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-[#002046] transition"
                    aria-label={
                      showConfirmPassword
                        ? 'Hide password'
                        : 'Show password'
                    }
                  >
                    {showConfirmPassword ? (
                      <EyeOff
                        size={18}
                        strokeWidth={2}
                      />
                    ) : (
                      <Eye
                        size={18}
                        strokeWidth={2}
                      />
                    )}
                  </button>

                </div>

                {formData.confirmPassword.length > 0 && (
                  <p
                    className={`mt-1 text-[11px] font-semibold ${
                      passwordsMatch
                        ? 'text-green-600'
                        : 'text-red-600'
                    }`}
                  >
                    {passwordsMatch
                      ? '✓ Passwords match.'
                      : '✕ Passwords do not match.'}
                  </p>
                )}

              </div>

              {/* REGISTER BUTTON */}

              <button
                type="submit"
                disabled={
                  !isPasswordValid ||
                  !passwordsMatch
                }
                className={`w-full py-2.5 rounded-lg font-bold text-sm transition shadow-sm ${
                  isPasswordValid &&
                  passwordsMatch
                    ? 'bg-[#002046] text-white hover:opacity-95'
                    : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                }`}
              >
                Send Verification Code
              </button>

            </form>
          )}

          {/* =================================================
              LOGIN
             ================================================= */}

          {view === 'login' && (

            <form
              onSubmit={handleLogin}
              className="space-y-4"
            >

              {showScanner ? (

                /* =================================================
                   QR CAMERA
                   ================================================= */

                <div className="space-y-4">

                  <div className="bg-[#002046] text-white rounded-xl p-4 text-center">

                    <h3 className="font-bold text-sm">
                      Scan Your QR Pass
                    </h3>

                    <p className="text-xs text-slate-300 mt-1">
                      Position your QR code inside
                      the camera frame.
                    </p>

                  </div>

                  <div className="rounded-xl overflow-hidden border-2 border-[#002046] bg-black">

                    <div
                      id="visitor-qr-reader"
                      className="w-full"
                    />

                  </div>

                  <button
                    type="button"
                    onClick={stopScanner}
                    className="w-full border border-slate-300 text-slate-700 py-2.5 rounded-lg text-sm font-bold hover:bg-slate-50 transition"
                  >
                    Cancel Camera
                  </button>

                </div>

              ) : (

                /* =================================================
                   NORMAL LOGIN
                   ================================================= */

                <>

                  <div>

                    <label className="block text-xs font-semibold text-slate-700 mb-1 uppercase tracking-wider">
                      Email / Account ID / QR Pass ID
                    </label>

                    <input
                      type="text"
                      required
                      autoComplete="username"
                      placeholder="email@example.com or SHELF-QR-XXXXXX"
                      value={loginData.identifier}
                      onChange={(e) =>
                        setLoginData({
                          ...loginData,
                          identifier: e.target.value,
                        })
                      }
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
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
                        required
                        autoComplete="current-password"
                        placeholder="Enter your password"
                        value={loginData.password}
                        onChange={(e) =>
                          setLoginData({
                            ...loginData,
                            password: e.target.value,
                          })
                        }
                        className="w-full px-4 py-2.5 pr-12 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                      />

                      <button
                        type="button"
                        onClick={() =>
                          setShowLoginPassword(
                            !showLoginPassword
                          )
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-[#002046] transition"
                        aria-label={
                          showLoginPassword
                            ? 'Hide password'
                            : 'Show password'
                        }
                      >
                        {showLoginPassword ? (
                          <EyeOff
                            size={18}
                            strokeWidth={2}
                          />
                        ) : (
                          <Eye
                            size={18}
                            strokeWidth={2}
                          />
                        )}
                      </button>

                    </div>

                  </div>

                  {/* ONE LOGIN BUTTON */}

                  <button
                    type="submit"
                    className="w-full bg-[#002046] text-white py-3 rounded-lg font-bold text-sm hover:opacity-95 transition shadow-sm"
                  >
                    Log In
                  </button>

                  <div className="relative flex items-center">

                    <div className="flex-grow border-t border-slate-200" />

                    <span className="px-3 text-xs text-slate-400">
                      OR
                    </span>

                    <div className="flex-grow border-t border-slate-200" />

                  </div>

                  {/* QR LOGIN */}

                  <button
                    type="button"
                    onClick={startScanner}
                    className="w-full bg-white border-2 border-[#002046] text-[#002046] py-3 rounded-lg font-bold text-sm hover:bg-slate-50 transition flex items-center justify-center gap-2"
                  >
                    <Camera
                      size={18}
                      strokeWidth={2}
                    />

                    <span>
                      Scan QR Code with Camera
                    </span>
                  </button>

                </>

              )}

            </form>
          )}

          {/* =================================================
              LOGIN / REGISTER SWITCH
             ================================================= */}

          {(view === 'login' ||
            view === 'register') && (

            <div className="pt-4 border-t border-slate-200 text-center">

              <button
                type="button"
                onClick={() => {
                  setError('');

                  setView(
                    view === 'register'
                      ? 'login'
                      : 'register'
                  );
                }}
                className="text-xs font-semibold text-[#002046] hover:underline"
              >

                {view === 'register'
                  ? 'Already registered? Access Login'
                  : 'New Visitor? Register for a Pass'}

              </button>

            </div>
          )}

          {/* =================================================
              OTP / SUCCESS BACK BUTTON
             ================================================= */}

          {(view === 'otp' ||
            view === 'success') && (

            <div className="pt-4 border-t border-slate-200 text-center">

              <button
                type="button"
                onClick={resetToLogin}
                className="text-xs font-semibold text-slate-500 hover:text-[#002046]"
              >
                ← Back to Login
              </button>

            </div>
          )}

        </div>
      </div>
    </div>
  );
}
