import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLibraryData } from '../context/useLibrary.js';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import { QrCode, X } from 'lucide-react';

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
  const scannerId = `attendance-qr-reader-${useId().replaceAll(':', '')}`;

  const scannerRef = useRef(null);
  const scannerStartRef = useRef(null);
  const scannerCleanupRef = useRef(null);
  const scanHandledRef = useRef(false);

  const submit = useCallback(async (nextValue = value) => {
    const qrValue = String(nextValue || '').trim();
    if (!qrValue || typeof onScan !== 'function') return;

    setError('');
    try {
      await onScan(qrValue);
      if (autoClear) setValue('');
    } catch (err) {
      setError(err?.message || 'Unable to process this visitor QR code.');
    }
  }, [autoClear, onScan, value]);

  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  const stopCamera = useCallback(async () => {
    if (scannerCleanupRef.current) {
      await scannerCleanupRef.current;
      return;
    }

    const scanner = scannerRef.current;
    if (!scanner) {
      setScanning(false);
      setCameraOpen(false);
      return;
    }

    const cleanup = (async () => {
      try {
        if (scannerStartRef.current) {
          try {
            await scannerStartRef.current;
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
        if (scannerRef.current === scanner) scannerRef.current = null;
        scannerStartRef.current = null;
        setScanning(false);
        setCameraOpen(false);
      }
    })();

    scannerCleanupRef.current = cleanup;
    try {
      await cleanup;
    } finally {
      if (scannerCleanupRef.current === cleanup) {
        scannerCleanupRef.current = null;
      }
    }
  }, []);

  const startCamera = useCallback(() => {
    if (cameraOpen || scanning || scannerRef.current) return;
    scanHandledRef.current = false;
    setError('');
    setCameraOpen(true);
  }, [cameraOpen, scanning]);

  useEffect(() => {
    if (!cameraOpen) return undefined;

    let cancelled = false;
    const timer = setTimeout(() => {
      const start = async () => {
        try {
          const element = document.getElementById(scannerId);
          if (!element || cancelled) return;

          const scanner = new Html5Qrcode(scannerId);
          scannerRef.current = scanner;
          setScanning(true);

          const startPromise = scanner.start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 250, height: 250 } },
            async (decodedText) => {
              if (cancelled || scanHandledRef.current) return;
              scanHandledRef.current = true;

              await stopCamera();
              await submitRef.current(decodedText);
            },
            () => {}
          );
          scannerStartRef.current = startPromise;
          await startPromise;
          if (cancelled) await stopCamera();
        } catch (err) {
          console.error('QR camera error:', err);
          await stopCamera();
          if (!cancelled) {
            setError(
              err?.message ||
                'Unable to access the camera. Please allow camera permission.'
            );
          }
        }
      };

      void start();
    }, 100);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      void stopCamera();
    };
  }, [cameraOpen, scannerId, stopCamera]);

  useEffect(() => () => {
    void stopCamera();
  }, [stopCamera]);

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
              void submit();
            }
          }}
          placeholder={placeholder}
          className="flex-1 px-4 py-2.5 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
        />

        <button
          type="button"
          onClick={() => void submit()}
          className="bg-shelf-primary text-white text-sm font-bold px-4 py-2.5 rounded-lg hover:opacity-90 transition"
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
          <QrCode size={16} className="mr-2 inline-block align-[-3px]" aria-hidden="true" />
          Scan QR with Camera
        </button>
      ) : (
        <div className="fixed inset-0 z-200 grid place-items-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-label="Scan visitor QR code">
          <div className="w-full max-w-sm space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Scan Visitor QR Code</h3>
                <p className="mt-1 text-xs text-slate-600">Position the entire QR pass inside the square.</p>
              </div>
              <button
                type="button"
                onClick={stopCamera}
                aria-label="Stop camera"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-100"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="mx-auto aspect-square w-full overflow-hidden rounded-lg border border-slate-300 bg-black">
              <div id={scannerId} className="h-full min-h-0 w-full" />
            </div>
            <button
              type="button"
              onClick={stopCamera}
              className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-red-700"
            >
              Stop Camera
            </button>
          </div>
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
                void submit(e.target.value);
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
                  {v.fullName}
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