import { useEffect, useRef, useState } from 'react';
import { useLibraryData } from '../context/LibraryContext';
import { Html5Qrcode } from 'html5-qrcode';

export default function QrScanner({
  onScan,
  placeholder = 'Scan or type visitor QR code…',
  autoClear = true,
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scanning, setScanning] = useState(false);

  const { visitors } = useLibraryData();

  const scannerRef = useRef(null);
  const scannerId = 'attendance-qr-reader';

  const stopCamera = async () => {
    try {
      if (scannerRef.current) {
        const state = scannerRef.current.getState();

        if (state === 2 || state === 3) {
          await scannerRef.current.stop();
        }

        await scannerRef.current.clear();
        scannerRef.current = null;
      }
    } catch (err) {
      console.error('Error stopping QR scanner:', err);
    }

    setScanning(false);
    setCameraOpen(false);
  };

  const submit = async (code) => {
    const trimmed = (code ?? value).trim();

    if (!trimmed) return;

    try {
      setError('');

      await onScan(trimmed);

      if (autoClear) {
        setValue('');
      }
    } catch (err) {
      setError(err.message || 'Scan failed.');
    }
  };

  /*
   * Open the camera UI first.
   *
   * React needs to render the #attendance-qr-reader element
   * before Html5Qrcode can initialize.
   */
  const startCamera = () => {
    if (scanning) return;

    setError('');
    setCameraOpen(true);
  };

  /*
   * Start Html5Qrcode only AFTER the camera container
   * has been rendered by React.
   */
  useEffect(() => {
    if (!cameraOpen || scanning) return;

    let cancelled = false;

    const startScanner = async () => {
      try {
        const element = document.getElementById(scannerId);

        if (!element) {
          setError('Camera scanner could not be initialized.');
          return;
        }

        const scanner = new Html5Qrcode(scannerId);

        scannerRef.current = scanner;

        if (cancelled) return;

        setScanning(true);

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
            if (cancelled) return;

            await stopCamera();
            await submit(decodedText);
          },
          () => {
            // Normal frame where no QR code was detected.
          }
        );
      } catch (err) {
        if (cancelled) return;

        console.error('QR camera error:', err);

        setError(
          err?.message ||
            'Unable to access the camera. Please allow camera permission.'
        );

        await stopCamera();
      }
    };

    /*
     * Small delay gives React time to render the scanner div.
     */
    const timer = setTimeout(startScanner, 100);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cameraOpen]);

  /*
   * Cleanup when component is removed.
   */
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .catch(() => {})
          .finally(() => {
            scannerRef.current?.clear().catch(() => {});
            scannerRef.current = null;
          });
      }
    };
  }, []);

  return (
    <div className="space-y-3">

      {/* Manual QR input */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          className="flex-1 px-4 py-2.5 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
        />

        <button
          type="button"
          onClick={() => submit()}
          className="bg-[#002046] text-white text-sm font-bold px-4 py-2.5 rounded-lg hover:opacity-90 transition"
        >
          Submit
        </button>
      </div>

      {/* Camera */}
      {!cameraOpen ? (
        <button
          type="button"
          onClick={startCamera}
          className="w-full sm:w-auto bg-emerald-600 text-white text-sm font-bold px-5 py-2.5 rounded-lg hover:bg-emerald-700 transition"
        >
          📷 Scan QR with Camera
        </button>
      ) : (
        <div className="space-y-2">

          <div className="rounded-xl overflow-hidden border border-slate-300 bg-black">
            <div
              id={scannerId}
              className="w-full min-h-[300px]"
            />
          </div>

          <button
            type="button"
            onClick={stopCamera}
            className="w-full bg-red-600 text-white text-sm font-bold px-4 py-2.5 rounded-lg hover:bg-red-700 transition"
          >
            ✕ Stop Camera
          </button>

        </div>
      )}

      {/* Quick pick */}
      {visitors.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-xs text-slate-500">
          <span>Quick-pick (demo):</span>

          <select
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                submit(e.target.value);
                e.target.value = '';
              }
            }}
          >
            <option value="" disabled>
              Select a registered visitor…
            </option>

            {visitors
              .filter((v) => v.otpVerified)
              .map((v) => (
                <option key={v.id} value={v.qrCode}>
                  {v.fullName} — {v.qrCode}
                </option>
              ))}
          </select>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs font-semibold bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

    </div>
  );
}
