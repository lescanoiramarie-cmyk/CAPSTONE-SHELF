import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import { philippines } from '@ianlabicani/geoph-lite';
import {
  Eye,
  EyeOff,
  Camera,
  Upload,
  ArrowLeft,
} from 'lucide-react';

import { useAuth } from '../../context/useAuth.js';

import libraryBg from '../../assets/library.jpg';
import { validateVisitorFullName } from '../../lib/visitorValidation.js';

// =========================================================
// LOCATION OPTIONS
// =========================================================

const LOCATION_OPTIONS = {
  Batangas: [
    'Agoncillo',
    'Alitagtag',
    'Balayan',
    'Balete',
    'Batangas City',
    'Bauan',
    'Calaca',
    'Calatagan',
    'Cuenca',
    'Ibaan',
    'Laurel',
    'Lemery',
    'Lian',
    'Lipa City',
    'Lobo',
    'Mabini',
    'Malvar',
    'Mataasnakahoy',
    'Nasugbu',
    'Padre Garcia',
    'Rosario',
    'San Jose',
    'San Juan',
    'San Luis',
    'San Nicolas',
    'San Pascual',
    'Santa Teresita',
    'Santo Tomas',
    'Taal',
    'Talisay',
    'Tanauan City',
    'Taysan',
    'Tingloy',
    'Tuy',
  ],

  Laguna: [
    'Alaminos',
    'Bay',
    'Biñan',
    'Cabuyao',
    'Calamba',
    'Calauan',
    'Famy',
    'Los Baños',
    'Luisiana',
    'Lumban',
    'Mabitac',
    'Magdalena',
    'Majayjay',
    'Nagcarlan',
    'Paete',
    'Pagsanjan',
    'Pakil',
    'Pangil',
    'Pila',
    'Rizal',
    'San Pablo City',
    'Santa Cruz',
    'Santa Rosa',
    'Siniloan',
    'Victoria',
  ],

  Cavite: [
    'Bacoor',
    'Carmona',
    'Cavite City',
    'Dasmariñas',
    'General Trias',
    'Imus',
    'Kawit',
    'Tagaytay',
    'Trece Martires',
    'Silang',
    'Rosario',
    'Naic',
    'Tanza',
  ],

  Quezon: [
    'Lucena City',
    'Candelaria',
    'Tiaong',
    'Sariaya',
    'Tayabas',
    'Lucban',
    'Pagbilao',
    'Infanta',
    'Mauban',
  ],

  Rizal: [
    'Antipolo',
    'Angono',
    'Binangonan',
    'Cainta',
    'Cardona',
    'Jalajala',
    'Morong',
    'Pililla',
    'Rodriguez',
    'San Mateo',
    'Tanay',
    'Taytay',
  ],

  'Metro Manila': [
    'Manila',
    'Quezon City',
    'Makati',
    'Pasig',
    'Taguig',
    'Mandaluyong',
    'Marikina',
    'Parañaque',
    'Pasay',
    'Caloocan',
    'Las Piñas',
    'Muntinlupa',
    'Navotas',
    'Malabon',
    'Valenzuela',
    'San Juan',
    'Pateros',
  ],
};

const OTP_CODE_TTL_SECONDS = 10 * 60;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const RESET_CODE_TTL_SECONDS = 10 * 60;
const RESET_CODE_RESEND_COOLDOWN_SECONDS = 60;
const preventPasswordClipboard = (event) => event.preventDefault();

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
}

// =========================================================
// VISITOR LOGIN
// =========================================================

export default function VisitorLogin({ initialView = 'login' }) {
  const navigate = useNavigate();

  const {
    registerVisitor,
    verifyVisitorOtp,
    resendVisitorOtp,
    resendVisitorOtpByEmail,
    requestPasswordResetCode,
    verifyPasswordResetCode,
    applyPasswordReset,
    login,
    loginAsVisitorSession,
    establishVisitorSessionFromQr,
  } = useAuth();

  // =========================================================
  // STATE
  // =========================================================

  const [view, setView] = useState(initialView);
  const [error, setError] = useState('');
  const [canResendVisitorOtp, setCanResendVisitorOtp] =
    useState(false);
  const [otpExpiresAt, setOtpExpiresAt] = useState(null);
  const [otpResendAvailableAt, setOtpResendAvailableAt] =
    useState(null);
  const [otpTimeRemaining, setOtpTimeRemaining] = useState(0);
  const [otpResendRemaining, setOtpResendRemaining] = useState(0);
  const [isOtpResending, setIsOtpResending] = useState(false);

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
    province: '',
    city: '',
    barangay: '',
    password: '',
    confirmPassword: '',
  });

  const [showScanner, setShowScanner] = useState(false);

  const scannerRef = useRef(null);
  const scannerStartPromiseRef = useRef(null);
  const scannerCleanupPromiseRef = useRef(null);
  const fileInputRef = useRef(null);
  const loginRef = useRef(login);

  useEffect(() => {
    loginRef.current = login;
  }, [login]);

  // IMPORTANT:
  // This is a synchronous lock.
  // It prevents two submit events from entering
  // registerVisitor before React has rendered again.
  const registrationLockRef = useRef(false);

  // Prevent repeated QR login attempts while a QR is being processed.
  const qrLoginLockRef = useRef(false);
  const loginRequestLockRef = useRef(false);

  const [isUploadingQr, setIsUploadingQr] =
    useState(false);

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
            // A failed start still needs its scanner element cleared.
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
        console.warn('QR scanner stop skipped:', err?.message || err);
      }

      try {
        await scanner.clear();
      } catch (err) {
        console.warn('QR scanner clear skipped:', err?.message || err);
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

  
  // =========================================================
  // CENTRALIZED QR LOGIN
  // =========================================================

  const handleQrLogin = useCallback(
    async (decodedText) => {
      if (qrLoginLockRef.current) return;

      const qrCode = String(decodedText ?? '').trim();

      if (!qrCode) {
        throw new Error(
          'The QR code is empty or does not contain a valid visitor pass.'
        );
      }

      qrLoginLockRef.current = true;
      setError('');

      try {
        const result = await loginRef.current({
          identifier: qrCode,
          password: '',
        });

        if (result?.role !== 'visitor') {
          throw new Error('This QR pass is not linked to a visitor account.');
        }

        navigate('/visitor');
      } catch (err) {
        console.error('QR LOGIN ERROR:', err);

        throw new Error(
          err?.message ||
            'QR code detected, but visitor authentication failed.',
          { cause: err }
        );
      } finally {
        qrLoginLockRef.current = false;
      }
    },
    [navigate]
  );

  
  
  // START / STOP CAMERA SCANNER
  const startScanner = useCallback(() => {
    setError('');
    setShowScanner(true);
  }, []);

  const stopScanner = useCallback(async () => {
    await stopVisitorScanner();
    setShowScanner(false);
  }, [stopVisitorScanner]);

    // Camera QR scanner — safe start and cleanup
    useEffect(() => {
      if (!showScanner) return;

      let cancelled = false;
      let processing = false;

      const startCamera = async () => {
        try {
          const scanner = new Html5Qrcode('visitor-qr-reader');
          scannerRef.current = scanner;

          const startPromise = scanner.start(
            { facingMode: 'environment' },
            {
              fps: 10,
              qrbox: { width: 250, height: 250 },
            },
            async (decodedText) => {
              if (cancelled || processing) return;

              processing = true;
              const qrValue = decodedText.trim();

              try {
                await stopVisitorScanner();
                if (cancelled) return;
                setShowScanner(false);
                await handleQrLogin(qrValue);
              } catch (err) {
                setError(
                  err?.message || 'QR code scanned, but login failed.'
                );
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
              err?.message ||
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
    }, [showScanner, handleQrLogin, stopVisitorScanner]);

  // =========================================================
  // CREATE ENHANCED QR IMAGE
  // =========================================================

  const createEnhancedQrImage = (
    file
  ) => {
    return new Promise(
      (resolve, reject) => {
        const image = new Image();

        const objectUrl =
          URL.createObjectURL(file);

        image.onload = () => {
          try {
            const scale = 3;

            const canvas =
              document.createElement(
                'canvas'
              );

            canvas.width = Math.max(
              image.width * scale,
              600
            );

            canvas.height = Math.max(
              image.height * scale,
              600
            );

            const context =
              canvas.getContext('2d');

            if (!context) {
              URL.revokeObjectURL(
                objectUrl
              );

              reject(
                new Error(
                  'Unable to process the uploaded image.'
                )
              );

              return;
            }

            context.fillStyle =
              '#ffffff';

            context.fillRect(
              0,
              0,
              canvas.width,
              canvas.height
            );

            context.imageSmoothingEnabled =
              false;

            context.drawImage(
              image,
              0,
              0,
              canvas.width,
              canvas.height
            );

            canvas.toBlob(
              (blob) => {
                URL.revokeObjectURL(
                  objectUrl
                );

                if (!blob) {
                  reject(
                    new Error(
                      'Unable to create an enhanced QR image.'
                    )
                  );

                  return;
                }

                const enhancedFile =
                  new File(
                    [blob],
                    'enhanced-qr.png',
                    {
                      type: 'image/png',
                    }
                  );

                resolve(
                  enhancedFile
                );
              },
              'image/png'
            );
          } catch (err) {
            URL.revokeObjectURL(
              objectUrl
            );

            reject(err);
          }
        };

        image.onerror = () => {
          URL.revokeObjectURL(
            objectUrl
          );

          reject(
            new Error(
              'Unable to read the uploaded image.'
            )
          );
        };

        image.src = objectUrl;
      }
    );
  };


  // =========================================================
  // QR IMAGE UPLOAD
  // =========================================================

  const handleQrImageUpload = async (event) => {
    const file = event.target.files?.[0];

    // Allow the same image to be selected again.
    event.target.value = '';

    if (!file || isUploadingQr) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file.');
      return;
    }

    setError('');
    setIsUploadingQr(true);

    let qrScanner = null;

    try {
      qrScanner = new Html5Qrcode(
        'visitor-qr-file-reader'
      );

      let decodedText = '';

      try {
        decodedText = await qrScanner.scanFile(file, false);
      } catch {
        // Try the enhanced image below.
      }

      if (!decodedText) {
        const enhancedFile = await createEnhancedQrImage(file);

        decodedText = await qrScanner.scanFile(
          enhancedFile,
          false
        );
      }

      const qrValue = String(decodedText ?? '').trim();

      if (!qrValue) {
        throw new Error(
          'No QR code was detected. Upload a clear image showing the entire QR code and its white border.'
        );
      }

      await handleQrLogin(qrValue);
    } catch (err) {
      console.error('QR IMAGE SCAN ERROR:', err);

      setError(
        err?.message ||
          'Unable to read the QR image. Try another image or use the camera scanner.'
      );
    } finally {
      try {
        if (qrScanner) {
  await qrScanner.clear();
}
      } catch (cleanupError) {
        console.warn(
          'QR image scanner cleanup warning:',
          cleanupError
        );
      }

      setIsUploadingQr(false);
    }
  };

  // =========================================================
  // NORMAL LOGIN
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
        'Please enter your email address or visitor QR pass.'
      );

      return;
    }

    const isEmail =
      identifier.includes('@');

    if (isEmail && !password) {
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

      if (
        result?.role ===
        'visitor'
      ) {
        navigate('/visitor');
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

      // -----------------------------------------------------
      // ESTABLISH A REAL SUPABASE SESSION
      //
      // The local session below is not enough on its own.
      // Visitor data is read through RLS policies and
      // security-definer RPCs that key off auth.uid(), so
      // without this exchange every request after
      // registration runs as anon and returns nothing.
      // -----------------------------------------------------

      let sessionVisitor =
        visitor;

      if (visitor?.qrCode) {
        try {
          sessionVisitor =
            await establishVisitorSessionFromQr(
              visitor.qrCode
            );
        } catch (sessionError) {
          console.error(
            'ESTABLISH VISITOR SESSION ERROR:',
            sessionError
          );

          setError(
            sessionError?.message ||
              'Your account was verified, but we could not start your library session. Please sign in with your email and password.'
          );

          setView('login');

          return;
        }
      }

      setRegisteredVisitor(
        sessionVisitor ||
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

    qrLoginLockRef.current =
      false;

    setView('login');
    setError('');

    setFieldErrors({
      fullName: '',
      contactNumber: '',
      email: '',
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

    setLoginData({
      identifier: '',
      password: '',
    });

    setOtpInput('');
    setPendingVisitorId(null);
    setPendingEmail('');
    setRegisteredVisitor(null);

    setShowScanner(false);
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
    <div className="min-h-screen flex w-full bg-shelf-bg">
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
        className="hidden lg:flex lg:w-1/2 bg-shelf-primary text-white p-12 flex-col justify-between relative overflow-hidden bg-cover bg-center"
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

      <div className="relative w-full lg:w-1/2 flex items-center justify-center p-4 sm:p-8 lg:p-12 overflow-y-auto">
        <div className="w-full max-w-md bg-white p-6 sm:p-8 rounded-2xl shadow-xl border border-slate-200 space-y-6 my-auto">
          {(view === 'register' || view === 'forgot') && (
            <div className="sticky top-0 z-20 -mt-1 flex justify-start bg-white pb-1">
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
                aria-label="Go back"
                title="Go back"
              >
                <ArrowLeft size={16} aria-hidden="true" />
                Back
              </button>
            </div>
          )}

          {/* HEADER */}

          <div className="text-center lg:text-left space-y-1">
            <h2 className="text-2xl font-bold text-shelf-text">
              {view === 'login' &&
                'SHELF ILMS Login'}

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
                'Sign in using your email and password.'}

              {view === 'register' &&
                'Fill in your personal details to receive your digital library pass.'}

              {view === 'otp' &&
                'Enter the one-time verification code sent to your email.'}

              {view === 'success' &&
                'Keep your QR pass private. It signs you in and is used for library attendance and circulation.'}

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
                  : 'Resend Visitor Verification Code'}
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
                  Keep this QR pass private. Use it to sign in and present it
                  for attendance, book pickup, and returns at the library.
                </p>

                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setError('');

                      await establishVisitorSessionFromQr(
                        registeredVisitor.qrCode
                      );

                      navigate('/visitor');
                    } catch (err) {
                      setError(
                        err.message ||
                          'Unable to establish your library session. Please try again.'
                      );
                    }
                  }}
                  className="w-full bg-shelf-primary text-white py-2.5 rounded-lg text-sm font-bold hover:opacity-95 transition"
                >
                  Enter Library Portal
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
                Verify & Activate
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
                  ? 'Sending Code...'
                  : otpResendRemaining > 0
                    ? `Resend Code in ${otpResendRemaining}s`
                    : 'Resend Code'}
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
                  <p className="mt-1 text-[11px] font-medium text-red-600">
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
                  <p className="mt-1 text-[11px] font-medium text-red-600">
                    {
                      fieldErrors.contactNumber
                    }
                  </p>
                )}
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
                  <p className="mt-1 text-[11px] font-medium text-red-600">
                    {fieldErrors.email}
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
                <p className="mt-1 text-[11px] font-medium text-red-600">
                  {fieldErrors.province}
                </p>
              )}
               
              {/* CITY / MUNICIPALITY */}

              <select
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
                <p className="mt-1 text-[11px] font-medium text-red-600">
                  {fieldErrors.city}
                </p>
              )}
                
              {/* BARANGAY */}

              <select
                name="user_barangay"
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
                <p className="mt-1 text-[11px] font-medium text-red-600">
                  {fieldErrors.barangay}
                </p>
              )}

              <p className="text-[10px] text-slate-500">
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
                    placeholder="Example: Juan@Library2026"
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-shelf-primary"
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
                  <p className="mt-1 text-[11px] font-medium text-red-600">
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-shelf-primary"
                  >
                    {showConfirmPassword ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>

                {fieldErrors.confirmPassword && (
                  <p className="mt-1 text-[11px] font-medium text-red-600">
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
                  ? 'Creating Account...'
                  : 'Send Verification Code'}
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
                  Sign In
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
              {showScanner ? (
  <div className="space-y-4">
    <div className="bg-shelf-primary text-white rounded-xl p-4 text-center">
      <h3 className="font-bold text-sm">Scan QR Code</h3>
      <p className="text-[11px] text-slate-300 mt-1">
        Position the QR code inside the scanning area.
      </p>
    </div>

    {/* Dapat may element na tumutugma sa scanner ID. */}
    <div
      id="visitor-qr-reader"
      className="w-full min-h-70 overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
    />

    <div
      id="visitor-qr-file-reader"
      className="hidden"
      aria-hidden="true"
    />

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
                      Email or visitor QR pass
                    </label>

                    <input
                      type="text"
                      name="visitor_login_identifier"
                      required
                      autoComplete="off"
                      placeholder="email@example.com or SHELF-QR-123456"
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
                        required={loginData.identifier.includes('@')}
                        autoComplete="new-password"
                        onCopy={preventPasswordClipboard}
                        onCut={preventPasswordClipboard}
                        onPaste={preventPasswordClipboard}
                        onDrop={preventPasswordClipboard}
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
                        className="w-full px-4 py-2.5 pr-12 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                      />

                      <button
                        type="button"
                        onClick={() =>
                          setShowLoginPassword(
                            !showLoginPassword
                          )
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-shelf-primary"
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

                  <button
                    type="submit"
                    disabled={isLoggingIn}
                    aria-busy={isLoggingIn}
                    className="w-full bg-shelf-primary text-white py-2.5 rounded-lg text-sm font-bold hover:opacity-95 transition shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isLoggingIn ? 'Signing in...' : 'Sign In'}
                  </button>

                  {/* FORGOT PASSWORD */}

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={handleOpenForgotPassword}
                      className="text-xs font-semibold text-shelf-primary hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>

                  <div className="relative flex items-center justify-center my-4">
                    <div className="border-t border-slate-200 w-full" />

                    <span className="bg-white px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400 absolute">
                      Or
                    </span>
                  </div>

                  {/* CAMERA QR */}

                  <button
                    type="button"
                    onClick={
                      startScanner
                    }
                    className="w-full border border-slate-300 text-slate-700 py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 hover:bg-slate-50 transition"
                  >
                    <Camera size={18} />
                    Scan QR Pass
                  </button>

                  {/* QR FILE INPUT */}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    className="hidden"
                    onChange={
                      handleQrImageUpload
                    }
                  />

                  {/* QR UPLOAD */}

                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click();
                    }}
                    disabled={
                      isUploadingQr
                    }
                    className="w-full border border-slate-300 text-slate-700 py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 hover:bg-slate-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Upload size={18} />

                    {isUploadingQr
                      ? 'Reading QR Code...'
                      : 'Upload QR Code Image'}
                  </button>

                  <div
                    id="visitor-qr-file-reader"
                    className="hidden"
                    aria-hidden="true"
                  />

                  {/* REGISTER LINK */}

                  <div className="text-center pt-2">
                    <p className="text-xs text-slate-600">
                      Don't have an account?{' '}

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
                        Register as Visitor
                      </button>
                    </p>
                  </div>
                </>
              )}
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
                        Email address
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
                        ? 'Sending Code...'
                        : 'Send Verification Code'}
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
                        : 'Verify Code'}
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
                        ? 'Sending Code...'
                        : resetTimeRemaining === 0 ||
                            resetResendRemaining === 0
                          ? 'Resend Code'
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
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
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
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
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
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
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
                        ? 'Updating Password...'
                        : 'Update Password'}
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
                  Back to Sign In
                </button>
              </>
            )}
        </div>
      </div>
    </div>
  );
}