import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import { Eye, EyeOff, Camera, Upload } from 'lucide-react';

import { useAuth } from '../../context/AuthContext.jsx';
import libraryBg from '../../assets/library.jpg';

export default function VisitorLogin() {
  const navigate = useNavigate();

  const {
    registerVisitor,
    verifyVisitorOtp,
    resendVisitorOtp,
    login,
    loginVisitor,
    loginAsVisitorSession,
  } = useAuth();

  // =========================================================
  // STATE
  // =========================================================

  const [view, setView] = useState('login');
  const [error, setError] = useState('');

  // Camera QR scanner
  const [showScanner, setShowScanner] = useState(false);
  const scannerRef = useRef(null);

  // QR image upload
  const fileInputRef = useRef(null);
  const [isUploadingQr, setIsUploadingQr] = useState(false);

  // Password visibility
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

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

  // OTP
  const [otpInput, setOtpInput] = useState('');
  const [pendingVisitorId, setPendingVisitorId] = useState(null);
  const [pendingEmail, setPendingEmail] = useState('');

  // Registered visitor
  const [registeredVisitor, setRegisteredVisitor] = useState(null);

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
  // CAMERA QR SCANNER
  // =========================================================

  const startScanner = () => {
    setError('');
    setShowScanner(true);
  };

  const stopScanner = async () => {
    const scanner = scannerRef.current;

    scannerRef.current = null;

    if (scanner) {
      try {
        await scanner.stop();
      } catch (err) {
        console.warn('Scanner stop warning:', err);
      }

      try {
        await scanner.clear();
      } catch (err) {
        console.warn('Scanner clear warning:', err);
      }
    }

    setShowScanner(false);
  };

  useEffect(() => {
    if (!showScanner) {
      return;
    }

    let cancelled = false;
    let scanner = null;

    const startCameraScanner = async () => {
      try {
        scanner = new Html5Qrcode('visitor-qr-reader');

        if (cancelled) {
          return;
        }

        scannerRef.current = scanner;

        await scanner.start(
          {
            facingMode: 'environment',
          },
          {
            fps: 10,
            qrbox: {
              width: 250,
              height: 250,
            },
          },
          async (decodedText) => {
            if (cancelled) {
              return;
            }

            const qrValue = decodedText.trim();

            if (!qrValue) {
              return;
            }

            cancelled = true;

            try {
              await scanner.stop();
            } catch (err) {
              console.warn('Camera scanner stop:', err);
            }

            try {
              await scanner.clear();
            } catch (err) {
              console.warn('Camera scanner clear:', err);
            }

            scannerRef.current = null;
            setShowScanner(false);

            setLoginData({
              identifier: qrValue,
              password: '',
            });

            try {
              await loginVisitor({
                identifier: qrValue,
                password: '',
              });

              navigate('/visitor');
            } catch (loginError) {
              setError(
                loginError?.message ||
                  'QR code was scanned, but login failed.'
              );
            }
          },
          () => {
            // Continuous scan errors are intentionally ignored.
          }
        );
      } catch (err) {
        console.error('Camera scanner error:', err);

        scannerRef.current = null;

        if (!cancelled) {
          setShowScanner(false);

          setError(
            'Unable to access the camera. Please allow camera permission or use Upload QR Code Image.'
          );
        }

        if (scanner) {
          try {
            await scanner.clear();
          } catch {
            // Ignore cleanup errors.
          }
        }
      }
    };

    startCameraScanner();

    return () => {
      cancelled = true;

      const activeScanner = scannerRef.current;

      scannerRef.current = null;

      if (activeScanner) {
        activeScanner
          .stop()
          .catch(() => {})
          .finally(() => {
            activeScanner.clear().catch(() => {});
          });
      }
    };
  }, [showScanner, loginVisitor, navigate]);

  // =========================================================
  // CREATE ENHANCED QR IMAGE
  // =========================================================

  const createEnhancedQrImage = (file) => {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);

      image.onload = () => {
        try {
          const scale = 3;

          const canvas = document.createElement('canvas');

          canvas.width = Math.max(
            image.width * scale,
            600
          );

          canvas.height = Math.max(
            image.height * scale,
            600
          );

          const context = canvas.getContext('2d');

          if (!context) {
            URL.revokeObjectURL(objectUrl);

            reject(
              new Error(
                'Unable to process the uploaded image.'
              )
            );

            return;
          }

          // White background
          context.fillStyle = '#ffffff';

          context.fillRect(
            0,
            0,
            canvas.width,
            canvas.height
          );

          // Disable smoothing so QR modules stay sharp
          context.imageSmoothingEnabled = false;

          context.drawImage(
            image,
            0,
            0,
            canvas.width,
            canvas.height
          );

          canvas.toBlob(
            (blob) => {
              URL.revokeObjectURL(objectUrl);

              if (!blob) {
                reject(
                  new Error(
                    'Unable to create an enhanced QR image.'
                  )
                );

                return;
              }

              const enhancedFile = new File(
                [blob],
                'enhanced-qr.png',
                {
                  type: 'image/png',
                }
              );

              resolve(enhancedFile);
            },
            'image/png'
          );
        } catch (err) {
          URL.revokeObjectURL(objectUrl);
          reject(err);
        }
      };

      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);

        reject(
          new Error(
            'Unable to read the uploaded image.'
          )
        );
      };

      image.src = objectUrl;
    });
  };

  // =========================================================
  // QR IMAGE UPLOAD
  // =========================================================

  const handleQrImageUpload = async (event) => {
    const file = event.target.files?.[0];

    // Allow selecting the same file again
    event.target.value = '';

    if (!file) {
      return;
    }

    setError('');
    setIsUploadingQr(true);

    let qrScanner = null;

    try {
      if (!file.type || !file.type.startsWith('image/')) {
        throw new Error(
          'Please upload a valid image containing your QR code.'
        );
      }

      qrScanner = new Html5Qrcode(
        'visitor-qr-file-reader'
      );

      let decodedText = '';

      // -----------------------------------------------------
      // ATTEMPT 1: ORIGINAL IMAGE
      // -----------------------------------------------------

      try {
        decodedText = await qrScanner.scanFile(
          file,
          false
        );

        console.log(
          'QR detected from original image:',
          decodedText
        );
      } catch {
        console.log(
          'Original image scan failed. Trying enhanced image.'
        );
      }

      // -----------------------------------------------------
      // ATTEMPT 2: ENHANCED IMAGE
      // -----------------------------------------------------

      if (!decodedText) {
        try {
          const enhancedFile =
            await createEnhancedQrImage(file);

          decodedText = await qrScanner.scanFile(
            enhancedFile,
            false
          );

          console.log(
            'QR detected from enhanced image:',
            decodedText
          );
        } catch (enhancedError) {
          console.log(
            'Enhanced image scan failed:',
            enhancedError
          );
        }
      }

      // -----------------------------------------------------
      // NO QR FOUND
      // -----------------------------------------------------

      if (!decodedText) {
        throw new Error(
          'No QR code was detected in the uploaded image. Please upload a clear image where the entire QR code and its white border are visible.'
        );
      }

      const qrValue = decodedText.trim();

      if (!qrValue) {
        throw new Error(
          'The QR code does not contain valid data.'
        );
      }

      console.log(
        'Final QR value:',
        qrValue
      );

      // Put QR value into login field
      setLoginData({
        identifier: qrValue,
        password: '',
      });

      // -----------------------------------------------------
      // LOGIN USING QR VALUE
      // -----------------------------------------------------

      try {
        await loginVisitor({
          identifier: qrValue,
          password: '',
        });

        navigate('/visitor');
      } catch (loginError) {
        console.error(
          'QR login error:',
          loginError
        );

        setError(
          loginError?.message ||
            'QR code was detected, but the visitor account could not be logged in.'
        );
      }
    } catch (err) {
      console.error(
        'QR image upload error:',
        err
      );

      setError(
        err?.message ||
          'Unable to read the QR code from the uploaded image.'
      );
    } finally {
      if (qrScanner) {
        try {
          await qrScanner.clear();
        } catch (cleanupError) {
          console.warn(
            'QR scanner cleanup warning:',
            cleanupError
          );
        }
      }

      setIsUploadingQr(false);
    }
  };

  // =========================================================
  // NORMAL LOGIN
  // =========================================================

  const handleLogin = async (event) => {
    event.preventDefault();

    setError('');

    const identifier =
      loginData.identifier.trim();

    if (!identifier) {
      setError(
        'Please enter your email, account ID, or QR pass ID.'
      );

      return;
    }

    if (!loginData.password) {
      setError(
        'Please enter your password.'
      );

      return;
    }

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
      setError(
        err?.message ||
          'Invalid email/ID or password.'
      );
    }
  };

  // =========================================================
  // REGISTRATION
  // =========================================================

  const handleRegister = async (event) => {
    event.preventDefault();

    setError('');

    if (!isPasswordValid) {
      setError(
        'Password does not meet all requirements.'
      );

      return;
    }

    if (!passwordsMatch) {
      setError('Passwords do not match.');

      return;
    }

    try {
      const result =
        await registerVisitor(formData);

      setPendingVisitorId(
        result.visitorId
      );

      setPendingEmail(
        formData.email.trim()
      );

      setOtpInput('');
      setView('otp');
    } catch (err) {
      setError(
        err?.message ||
          'Registration failed.'
      );
    }
  };

  // =========================================================
  // VERIFY OTP
  // =========================================================

  const handleVerifyOtp = async (event) => {
    event.preventDefault();

    setError('');

    const cleanOtp =
      otpInput.trim();

    if (cleanOtp.length !== 6) {
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

      setView('success');
    } catch (err) {
      setError(
        err?.message ||
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
        'Registration session not found.'
      );

      return;
    }

    try {
      await resendVisitorOtp(
        pendingVisitorId
      );

      setOtpInput('');

      setError(
        'A new verification code has been sent to your email.'
      );
    } catch (err) {
      setError(
        err?.message ||
          'Unable to resend verification code.'
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
    setShowScanner(false);
  };

  // =========================================================
  // PASSWORD REQUIREMENT
  // =========================================================

  const PasswordRequirement = ({
    valid,
    children,
  }) => {
    return (
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
  };

  // =========================================================
  // UI
  // =========================================================

  return (
    <div className="min-h-screen flex w-full bg-[#f8fafc]">

      <style>{`
        input[type="password"]::-ms-reveal,
        input[type="password"]::-ms-clear {
          display: none;
        }
      `}</style>

      {/* =====================================================
          LEFT PANEL
      ====================================================== */}

      <div
        className="hidden lg:flex lg:w-1/2 bg-[#002046] text-white p-12 flex-col justify-between relative overflow-hidden bg-cover bg-center"
        style={{
          backgroundImage: `linear-gradient(
            rgba(0, 32, 70, 0.85),
            rgba(0, 32, 70, 0.85)
          ), url(${libraryBg})`,
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
            Access your library account, explore
            available resources, manage your
            borrowing activity, and use your
            digital library pass.
          </p>

        </div>

        <div className="relative z-10 text-xs text-slate-400">
          © SHELF System. All rights reserved.
        </div>
      </div>

      {/* =====================================================
          RIGHT PANEL
      ====================================================== */}

      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12">

        <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl border border-slate-200 space-y-6">

          {/* HEADER */}

          <div className="text-center lg:text-left space-y-1">

            <h2 className="text-2xl font-bold text-[#0f172a]">

              {view === 'login' &&
                'SHELF ILMS Login'}

              {view === 'register' &&
                'Visitor Registration'}

              {view === 'otp' &&
                'Verify Your Email'}

              {view === 'success' &&
                'Registration Successful'}

            </h2>

            <p className="text-xs text-slate-500">

              {view === 'login' &&
                'Sign in using your email, account ID, or QR pass ID.'}

              {view === 'register' &&
                'Fill in your personal details to receive your digital library pass.'}

              {view === 'otp' &&
                'Enter the one-time verification code sent to your email.'}

              {view === 'success' &&
                'Save your QR pass and use it for quick library access.'}

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

          {/* =================================================
              SUCCESS VIEW
          ================================================== */}

          {view === 'success' &&
            registeredVisitor && (
              <div className="space-y-4 bg-slate-50 p-6 rounded-xl border border-slate-200 text-center">

                <h3 className="text-sm font-bold text-[#0f172a]">
                  Welcome,{' '}
                  {registeredVisitor.fullName}!
                </h3>

                <div className="flex justify-center">

                  <div className="p-4 bg-white rounded-lg shadow-sm inline-block border border-slate-200">

                    <QRCodeSVG
                      value={
                        registeredVisitor.qrCode
                      }
                      size={220}
                      level="H"
                      includeMargin
                    />

                  </div>

                </div>

                <p className="text-xs font-mono font-bold text-[#002046]">
                  {registeredVisitor.qrCode}
                </p>

                <p className="text-xs text-slate-500">
                  Keep this QR pass available
                  for library attendance and
                  quick login.
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
              OTP VIEW
          ================================================== */}

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
                  <span className="font-bold">
                    {pendingEmail}
                  </span>
                </p>

              </div>

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
                Verify & Activate
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
              REGISTER VIEW
          ================================================== */}

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
                  required
                  placeholder="Juan Dela Cruz"
                  value={formData.fullName}
                  onChange={(event) =>
                    setFormData({
                      ...formData,
                      fullName:
                        event.target.value,
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
                  name="user_contact"
                  autoComplete="off"
                  required
                  placeholder="09123456789"
                  value={
                    formData.contactNumber
                  }
                  onChange={(event) =>
                    setFormData({
                      ...formData,
                      contactNumber:
                        event.target.value,
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
                  name="user_email"
                  autoComplete="off"
                  required
                  placeholder="visitor@email.com"
                  value={formData.email}
                  onChange={(event) =>
                    setFormData({
                      ...formData,
                      email:
                        event.target.value,
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
                  name="user_address"
                  autoComplete="off"
                  required
                  rows="2"
                  placeholder="Street, City, Province"
                  value={formData.address}
                  onChange={(event) =>
                    setFormData({
                      ...formData,
                      address:
                        event.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                />

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
                    required
                    minLength={8}
                    autoComplete="new-password"
                    placeholder="Example: Juan@2026"
                    value={formData.password}
                    onChange={(event) =>
                      setFormData({
                        ...formData,
                        password:
                          event.target.value,
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-[#002046]"
                  >
                    {showRegisterPassword ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>

                </div>

                <div className="mt-2 bg-slate-50 border border-slate-200 rounded-lg p-3">

                  <p className="text-[11px] font-semibold text-slate-700 mb-1">
                    Password requirements:
                  </p>

                  <ul className="text-[11px] space-y-1">

                    <PasswordRequirement
                      valid={
                        passwordRequirements.minLength
                      }
                    >
                      At least 8 characters
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
                    required
                    minLength={8}
                    autoComplete="new-password"
                    placeholder="Re-enter password"
                    value={
                      formData.confirmPassword
                    }
                    onChange={(event) =>
                      setFormData({
                        ...formData,
                        confirmPassword:
                          event.target.value,
                      })
                    }
                    className={`w-full px-3 py-2 pr-12 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20 ${
                      formData.confirmPassword
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-[#002046]"
                  >
                    {showConfirmPassword ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>

                </div>

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

              <div className="text-center pt-2">

                <button
                  type="button"
                  onClick={resetToLogin}
                  className="text-xs font-semibold text-slate-600 hover:text-[#002046]"
                >
                  Already have an account? Sign In
                </button>

              </div>

            </form>
          )}

          {/* =================================================
              LOGIN VIEW
          ================================================== */}

          {view === 'login' && (
            <form
              onSubmit={handleLogin}
              className="space-y-4"
              autoComplete="off"
            >

              {/* CAMERA SCANNER */}

              {showScanner ? (
                <div className="space-y-4">

                  <div className="bg-[#002046] text-white rounded-xl p-4 text-center">

                    <h3 className="font-bold text-sm">
                      Scan Your QR Pass
                    </h3>

                    <p className="text-[11px] text-slate-300 mt-1">
                      Position the QR code inside
                      the scanning area.
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
                <>
                  {/* LOGIN IDENTIFIER */}

                  <div>

                    <label className="block text-xs font-semibold text-slate-700 mb-1 uppercase tracking-wider">
                      Email / Account ID / QR Pass ID
                    </label>

                    <input
                      type="text"
                      name="visitor_login_identifier"
                      required
                      autoComplete="off"
                      placeholder="email@example.com or SHELF-QR-XXXXXX"
                      value={
                        loginData.identifier
                      }
                      onChange={(event) =>
                        setLoginData({
                          ...loginData,
                          identifier:
                            event.target.value,
                        })
                      }
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                    />

                  </div>

                  {/* PASSWORD */}

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
                        autoComplete="new-password"
                        placeholder="••••••••"
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
                        className="w-full px-4 py-2.5 pr-12 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                      />

                      <button
                        type="button"
                        onClick={() =>
                          setShowLoginPassword(
                            !showLoginPassword
                          )
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-[#002046]"
                      >
                        {showLoginPassword ? (
                          <EyeOff size={18} />
                        ) : (
                          <Eye size={18} />
                        )}
                      </button>

                    </div>

                  </div>

                  {/* SIGN IN */}

                  <button
                    type="submit"
                    className="w-full bg-[#002046] text-white py-2.5 rounded-lg text-sm font-bold hover:opacity-95 transition shadow-sm"
                  >
                    Sign In
                  </button>

                  {/* DIVIDER */}

                  <div className="relative flex items-center justify-center my-4">

                    <div className="border-t border-slate-200 w-full" />

                    <span className="bg-white px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400 absolute">
                      Or
                    </span>

                  </div>

                  {/* CAMERA QR */}

                  <button
                    type="button"
                    onClick={startScanner}
                    className="w-full border border-slate-300 text-slate-700 py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 hover:bg-slate-50 transition"
                  >
                    <Camera size={18} />
                    Scan QR Pass
                  </button>

                  {/* HIDDEN FILE INPUT */}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    className="hidden"
                    onChange={handleQrImageUpload}
                  />

                  {/* UPLOAD QR */}

                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click();
                    }}
                    disabled={isUploadingQr}
                    className="w-full border border-slate-300 text-slate-700 py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 hover:bg-slate-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Upload size={18} />

                    {isUploadingQr
                      ? 'Reading QR Code...'
                      : 'Upload QR Code Image'}
                  </button>

                  {/* HIDDEN QR DECODER */}

                  <div
                    id="visitor-qr-file-reader"
                    className="hidden"
                    aria-hidden="true"
                  />

                  {/* REGISTER */}

                  <div className="text-center pt-2">

                    <p className="text-xs text-slate-600">

                      Don't have an account?{' '}

                      <button
                        type="button"
                        onClick={() => {
                          setError('');
                          setView('register');
                        }}
                        className="font-bold text-[#002046] hover:underline"
                      >
                        Register as Visitor
                      </button>

                    </p>

                  </div>

                </>
              )}

            </form>
          )}

        </div>
      </div>
    </div>
  );
}
