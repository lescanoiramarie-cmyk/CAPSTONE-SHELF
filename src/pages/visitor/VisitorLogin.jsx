import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import { useAuth } from '../../context/AuthContext';
import libraryBg from '../../assets/library.jpg';

// view = 'login' | 'register' | 'otp' | 'success'
export default function VisitorLogin() {
  const [showScanner, setShowScanner] = useState(false);
  const scannerRef = useRef(null);
  const [view, setView] = useState('login');
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({ fullName: '', contactNumber: '', email: '', address: '', password: '' });
  const [loginData, setLoginData] = useState({ identifier: '', password: '' });
  const [otpInput, setOtpInput] = useState('');
  const [pendingVisitorId, setPendingVisitorId] = useState(null);
  const [demoOtp, setDemoOtp] = useState('');
  const [registeredVisitor, setRegisteredVisitor] = useState(null);

  const { registerVisitor, verifyVisitorOtp, resendVisitorOtp, loginVisitor, loginAsVisitorSession } = useAuth();
  const navigate = useNavigate();

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

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await loginVisitor(loginData);
      navigate('/visitor');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const { visitorId, otp } = await registerVisitor(formData);
      setPendingVisitorId(visitorId);
      setDemoOtp(otp);
      setView('otp');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const visitor = await verifyVisitorOtp(pendingVisitorId, otpInput);
      setRegisteredVisitor(visitor);
      setView('success');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleResendOtp = async () => {
    try {
      const otp = await resendVisitorOtp(pendingVisitorId);
      setDemoOtp(otp);
      setError('A new OTP code has been generated.');
    } catch (err) {
      setError(err.message);
    }
  };

  const resetToLogin = () => {
    setView('login');
    setError('');
    setFormData({ fullName: '', contactNumber: '', email: '', address: '', password: '' });
    setOtpInput('');
    setPendingVisitorId(null);
    setRegisteredVisitor(null);
  };

  return (
    <div className="min-h-screen flex w-full bg-[#f8fafc]">
      {/* Left Branding Panel */}
      <div
        className="hidden lg:flex lg:w-1/2 bg-[#002046] text-white p-12 flex-col justify-between relative overflow-hidden bg-cover bg-center"
        style={{ backgroundImage: `linear-gradient(rgba(0, 32, 70, 0.85), rgba(0, 32, 70, 0.85)), url(${libraryBg})` }}
      >
        <div className="relative z-10 flex items-center gap-3">
          <span className="text-xl font-bold tracking-wider">SHELF ILMS</span>
        </div>

        <div className="relative z-10 space-y-4 max-w-lg">
          <span className="px-3 py-1 bg-white/10 backdrop-blur-md text-xs font-semibold rounded-full border border-white/20">
            Visitor Portal
          </span>
          <h1 className="text-4xl font-extrabold leading-tight">Explore Learning Resources & Campus Libraries.</h1>
          <p className="text-sm text-slate-300">
            Generate your personal library pass, view book availability, and keep track of your borrowing history.
          </p>
        </div>

        <div className="relative z-10 text-xs text-slate-400">© SHELF System. All rights reserved.</div>
      </div>

      {/* Right Form Panel */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl border border-slate-200 space-y-6">
          <div className="text-center lg:text-left space-y-1">
            <h2 className="text-2xl font-bold text-[#0f172a]">
              {view === 'register' && 'Visitor Registration'}
              {view === 'otp' && 'Verify Your Email'}
              {view === 'success' && 'Registration Successful'}
              {view === 'login' && 'Visitor Portal'}
            </h2>
            <p className="text-xs text-slate-500">
              {view === 'register' && 'Fill in your personal details to receive your digital library pass.'}
              {view === 'otp' && 'Enter the one-time code we sent to your email to activate your account.'}
              {view === 'success' && 'Save your QR pass — you\'ll scan it at the library entrance and at the circulation desk.'}
              {view === 'login' && 'Sign in using your registered email or your QR pass ID.'}
            </p>
          </div>

          {error && (
            <div className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}

          {view === 'success' && registeredVisitor && (
            <div className="space-y-4 bg-slate-50 p-6 rounded-xl border border-slate-200 text-center">
              <h3 className="text-sm font-bold text-[#0f172a]">Welcome, {registeredVisitor.fullName}!</h3>
              <div className="flex justify-center p-3 bg-white rounded-lg shadow-sm inline-block border border-slate-200">
                <QRCodeSVG value={registeredVisitor.qrCode} size={150} />
              </div>
              <p className="text-xs font-mono font-bold text-[#002046]">{registeredVisitor.qrCode}</p>
              <p className="text-xs text-slate-500">
                Save a screenshot of this QR code — scan it at the library entrance for attendance, and at the
                circulation desk when picking up or returning books.
              </p>
              <button
                onClick={() => {
                  loginAsVisitorSession(registeredVisitor);
                  navigate('/visitor');
                }}
                className="w-full bg-[#002046] text-white py-2.5 rounded-lg text-sm font-bold hover:opacity-95 transition"
              >
                Enter Library Portal
              </button>
            </div>
          )}

          {view === 'otp' && (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs px-3 py-2 rounded-lg">
                Simulated email delivery (no email/SMS provider is connected yet): your OTP code is{' '}
                <span className="font-mono font-bold">{demoOtp}</span>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">6-Digit OTP Code</label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••••"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm tracking-[0.5em] text-center font-mono focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-[#002046] text-white py-2.5 rounded-lg font-bold text-sm hover:opacity-95 transition shadow-sm"
              >
                Verify & Activate Account
              </button>
              <button
                type="button"
                onClick={handleResendOtp}
                className="w-full text-xs font-semibold text-[#002046] hover:underline"
              >
                Resend OTP Code
              </button>
            </form>
          )}

          {view === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="Juan Dela Cruz"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Contact Number</label>
                <input
                  type="tel"
                  required
                  placeholder="09123456789"
                  value={formData.contactNumber}
                  onChange={(e) => setFormData({ ...formData, contactNumber: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="visitor@email.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Address</label>
                <textarea
                  required
                  rows="2"
                  placeholder="Street, City, Province"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                ></textarea>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Create Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-[#002046] text-white py-2.5 rounded-lg font-bold text-sm hover:opacity-95 transition shadow-sm"
              >
                Send OTP & Continue
              </button>
            </form>
          )}

          {view === 'login' && (
  <form onSubmit={handleLogin} className="space-y-4">

    {showScanner ? (
      <div className="space-y-4">

        <div className="bg-[#002046] text-white rounded-xl p-4 text-center">
          <h3 className="font-bold text-sm">
            Scan Your QR Pass
          </h3>

          <p className="text-xs text-slate-300 mt-1">
            Position your QR code inside the camera frame.
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
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1 uppercase tracking-wider">
            Visitor Email / QR Pass ID
          </label>

          <input
            type="text"
            required
            placeholder="visitor@email.com or SHELF-QR-XXXXXX"
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

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1 uppercase tracking-wider">
            Password
          </label>

          <input
            type="password"
            placeholder="••••••••"
            value={loginData.password}
            onChange={(e) =>
              setLoginData({
                ...loginData,
                password: e.target.value,
              })
            }
            className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
          />
        </div>

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

        <button
          type="button"
          onClick={startScanner}
          className="w-full bg-white border-2 border-[#002046] text-[#002046] py-3 rounded-lg font-bold text-sm hover:bg-slate-50 transition"
        >
          📷 Scan QR Code with Camera
        </button>
      </>
    )}

  </form>
)}

          {(view === 'login' || view === 'register') && (
            <div className="pt-4 border-t border-slate-200 space-y-2 text-center">
              <button
                onClick={() => {
                  setError('');
                  setView(view === 'register' ? 'login' : 'register');
                }}
                className="text-xs font-semibold text-[#002046] hover:underline"
              >
                {view === 'register' ? 'Already registered? Access Visitor Login' : 'New Visitor? Register for a Pass'}
              </button>
              <div>
                <a href="/admin-login" className="text-xs font-medium text-slate-500 hover:text-[#002046]">
                  Staff & Sub-Admin Login →
                </a>
              </div>
            </div>
          )}

          {(view === 'otp' || view === 'success') && (
            <div className="pt-4 border-t border-slate-200 text-center">
              <button onClick={resetToLogin} className="text-xs font-semibold text-slate-500 hover:text-[#002046]">
                ← Back to Login
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
