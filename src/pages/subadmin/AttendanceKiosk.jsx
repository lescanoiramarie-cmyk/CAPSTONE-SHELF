import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import { Camera, CircleAlert, Clock3, QrCode, UserRound } from 'lucide-react';
import { useAuth } from '../../context/useAuth.js';
import { useLibrary, useLibraryData } from '../../context/useLibrary.js';
import { supabase } from '../../lib/supabaseClient.js';

const SCANNER_ID = 'shelf-attendance-kiosk-reader';
const VISITOR_RESULT_MS = 7000;
const QR_ABSENCE_RESET_MS = 250;

function formatTime(value) {
  return new Date(value).toLocaleTimeString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-PH', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function getInitials(name = '') {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'V';
}

export default function AttendanceKiosk() {
  const { user, keepSessionAlive } = useAuth();
  const { libraries = [] } = useLibraryData();
  const { findVisitorByQr, scanAttendance } = useLibrary();
  const libraryId = user?.libraryId || user?.assignedBranch || libraries[0]?.id;
  const libraryName = libraries.find((library) => String(library.id) === String(libraryId))?.name || 'Assigned library';

  const [cameraStatus, setCameraStatus] = useState('starting');
  const [cameraError, setCameraError] = useState('');
  const [retryCamera, setRetryCamera] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [latestVisit, setLatestVisit] = useState(null);
  const [scanError, setScanError] = useState('');

  const scanHandlerRef = useRef(null);
  const activeQrRef = useRef('');
  const processingRef = useRef(false);
  const absenceTimerRef = useRef(null);
  const resultTimerRef = useRef(null);
  const profileImageObjectUrlRef = useRef('');

  const processQr = useCallback(async (qrValue) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);
    setScanError('');
    setLatestVisit(null);
    window.clearTimeout(resultTimerRef.current);
    if (profileImageObjectUrlRef.current) {
      URL.revokeObjectURL(profileImageObjectUrlRef.current);
      profileImageObjectUrlRef.current = '';
    }

    try {
      const visitor = await findVisitorByQr(qrValue, libraryId);
      if (!visitor) {
        throw new Error('Visitor pass not recognized. Please ask the visitor to present their SHELF QR pass again.');
      }

      const profileImagePromise = (async () => {
        if (!visitor.profileImagePath || !supabase) return '';
        try {
          const { data, error } = await supabase.storage
            .from('visitor-profile-images')
            .download(visitor.profileImagePath);
          if (error) throw error;
          if (data) {
            const objectUrl = URL.createObjectURL(data);
            profileImageObjectUrlRef.current = objectUrl;
            return objectUrl;
          }
        } catch (imageError) {
          console.warn('Unable to load visitor photo in attendance kiosk:', imageError);
        }
        return '';
      })();

      const { log } = await scanAttendance(qrValue, libraryId);
      const profileImageUrl = await profileImagePromise;
      const time = new Date().toISOString();
      const action = log?.action === 'checked_out' ? 'checked_out' : 'checked_in';
      setLatestVisit({ visitor, action, time, profileImageUrl });
      resultTimerRef.current = window.setTimeout(() => {
        setLatestVisit(null);
        if (profileImageObjectUrlRef.current === profileImageUrl) {
          URL.revokeObjectURL(profileImageObjectUrlRef.current);
          profileImageObjectUrlRef.current = '';
        }
      }, VISITOR_RESULT_MS);
    } catch (error) {
      if (profileImageObjectUrlRef.current) {
        URL.revokeObjectURL(profileImageObjectUrlRef.current);
        profileImageObjectUrlRef.current = '';
      }
      setScanError(error?.message || 'Unable to record attendance. Please scan the pass again.');
      resultTimerRef.current = window.setTimeout(() => setScanError(''), VISITOR_RESULT_MS);
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  }, [findVisitorByQr, libraryId, scanAttendance]);

  useEffect(() => () => {
    window.clearTimeout(resultTimerRef.current);
    if (profileImageObjectUrlRef.current) {
      URL.revokeObjectURL(profileImageObjectUrlRef.current);
      profileImageObjectUrlRef.current = '';
    }
  }, []);

  useEffect(() => {
    scanHandlerRef.current = processQr;
  }, [processQr]);

  useEffect(() => {
    if (user?.role !== 'subadmin') return undefined;
    keepSessionAlive();
    const sessionHeartbeat = window.setInterval(keepSessionAlive, 4 * 60 * 1000);
    return () => window.clearInterval(sessionHeartbeat);
  }, [keepSessionAlive, user?.role]);

  useEffect(() => {
    if (!libraryId) {
      // Surface the missing branch assignment in the kiosk status UI.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCameraStatus('error');
      setCameraError('No library branch is assigned to this sub-admin account.');
      return undefined;
    }

    let cancelled = false;
    let scanner = null;
    let startPromise = null;
    setCameraStatus('starting');
    setCameraError('');

    const handleDecodedQr = (decodedText) => {
      const qrValue = String(decodedText || '').trim();
      if (!qrValue || processingRef.current) return;

      window.clearTimeout(absenceTimerRef.current);
      const normalizedQr = qrValue.toUpperCase();
      if (activeQrRef.current === normalizedQr) return;
      activeQrRef.current = normalizedQr;
      void scanHandlerRef.current?.(qrValue);
    };

    const handleNoQr = () => {
      if (!activeQrRef.current) return;
      window.clearTimeout(absenceTimerRef.current);
      absenceTimerRef.current = window.setTimeout(() => {
        activeQrRef.current = '';
      }, QR_ABSENCE_RESET_MS);
    };

    const startScanner = async () => {
      try {
        scanner = new Html5Qrcode(SCANNER_ID, { verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
        startPromise = scanner.start(
          { facingMode: 'environment' },
          {
            fps: 18,
            aspectRatio: 4 / 3,
            videoConstraints: { width: { ideal: 1280 }, height: { ideal: 720 } },
            qrbox: (width, height) => {
              const size = Math.floor(Math.min(width, height, 560) * 0.94);
              return { width: size, height: size };
            },
          },
          handleDecodedQr,
          handleNoQr
        );
        await startPromise;
        if (cancelled) return;
        setCameraStatus('active');
      } catch (error) {
        if (cancelled) return;
        console.error('Attendance kiosk camera error:', error);
        setCameraStatus('error');
        setCameraError(error?.message || 'Allow camera access, then try starting the scanner again.');
      }
    };

    const startTimer = window.setTimeout(() => void startScanner(), 160);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      window.clearTimeout(absenceTimerRef.current);
      window.clearTimeout(resultTimerRef.current);
      const stopScanner = async () => {
        if (!scanner) return;
        try {
          if (startPromise) await startPromise;
        } catch {
          // A rejected camera start still needs its scanner container cleared.
        }
        try {
          const state = scanner.getState();
          if (state === Html5QrcodeScannerState.SCANNING || state === Html5QrcodeScannerState.PAUSED) {
            await scanner.stop();
          }
        } catch (error) {
          console.warn('Attendance kiosk scanner cleanup warning:', error?.message || error);
        }
        try {
          await scanner.clear();
        } catch (error) {
          console.warn('Attendance kiosk scanner clear warning:', error?.message || error);
        }
      };
      void stopScanner();
    };
  }, [libraryId, retryCamera]);

  const actionLabel = latestVisit?.action === 'checked_out' ? 'TIME OUT RECORDED' : 'TIME IN RECORDED';
  const actionColor = latestVisit?.action === 'checked_out'
    ? 'border-blue-200 bg-blue-50 text-blue-800'
    : 'border-emerald-200 bg-emerald-50 text-emerald-800';

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-4 bg-shelf-primary px-5 py-4 text-white shadow-md sm:px-8">
        <a href="/subadmin" className="flex items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label="SHELF dashboard">
          <img src="/shelf-logo.png" alt="" className="h-10 w-10 object-contain" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">SHELF · VISITOR SERVICES</p>
            <h1 className="text-lg font-bold">Attendance kiosk</h1>
          </div>
        </a>
        <div className="flex items-center gap-4">
          <div className="hidden text-right sm:block"><p className="text-sm font-semibold">{libraryName}</p><p className="text-xs text-blue-200">Continuous visitor check-in</p></div>
        </div>
      </header>

      <div className="mx-auto grid max-w-screen-2xl gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.85fr)] lg:p-8">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-shelf-primary text-white"><QrCode size={20} aria-hidden="true" /></span>
              <div><h2 className="font-bold">Scan visitor QR pass</h2><p className="mt-0.5 text-xs text-slate-500">Camera remains on between scans</p></div>
            </div>
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${cameraStatus === 'active' ? 'bg-emerald-50 text-emerald-700' : cameraStatus === 'error' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
              <span className={`h-2 w-2 rounded-full ${cameraStatus === 'active' ? 'animate-pulse bg-emerald-500' : cameraStatus === 'error' ? 'bg-red-500' : 'animate-pulse bg-blue-500'}`} />
              {cameraStatus === 'active' ? 'Scanner ready' : cameraStatus === 'error' ? 'Camera unavailable' : 'Starting camera…'}
            </span>
          </div>

          <div className="p-4 sm:p-5">
            <div className="relative aspect-[4/3] min-h-64 overflow-hidden rounded-xl bg-slate-950 [&_video]:!h-full [&_video]:!w-full [&_video]:!object-cover [&_canvas]:!h-full [&_canvas]:!w-full">
              <div id={SCANNER_ID} className="h-full w-full" />
              {cameraStatus === 'starting' && <div className="absolute inset-0 grid place-items-center bg-slate-950/80 text-center text-white"><div><Camera size={28} className="mx-auto text-blue-300" /><p className="mt-3 text-sm font-semibold">Starting attendance camera</p><p className="mt-1 text-xs text-slate-300">Allow camera access if your browser asks.</p></div></div>}
              {cameraStatus === 'error' && <div className="absolute inset-0 grid place-items-center bg-slate-950/90 p-6 text-center text-white"><div><CircleAlert size={30} className="mx-auto text-amber-300" /><p className="mt-3 text-sm font-semibold">Camera needs attention</p><p className="mt-1 max-w-sm text-xs leading-5 text-slate-300">{cameraError}</p><button type="button" onClick={() => setRetryCamera((value) => value + 1)} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500">Try again</button></div></div>}
            </div>
            <div className="mt-4 flex flex-col gap-2 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-semibold">Hold the visitor QR pass inside the frame.</span>
              <span className="text-xs text-blue-700">Remove the pass after each scan; present it again on exit.</span>
            </div>
            {processing && <p role="status" className="mt-3 text-center text-sm font-semibold text-blue-800">Recording attendance…</p>}
            {scanError && <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{scanError}</div>}
          </div>
        </section>

        <section aria-live="polite" aria-atomic="true" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-4">
            <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Visitor check-in</p>
            <h2 className="mt-1 text-lg font-bold text-shelf-primary">Latest scan</h2>
          </div>
          {latestVisit ? (
            <div className="space-y-5 p-5 sm:p-6">
              <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-extrabold tracking-wide ${actionColor}`}>
                <Clock3 size={18} aria-hidden="true" />{actionLabel}
              </div>
              <div className="flex flex-col items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 text-center sm:flex-row sm:text-left">
                {latestVisit.profileImageUrl ? (
                  <img src={latestVisit.profileImageUrl} alt={`${latestVisit.visitor.fullName} profile`} className="h-32 w-32 shrink-0 rounded-full border-4 border-white object-cover shadow-md ring-1 ring-slate-200" />
                ) : (
                  <div className="grid h-32 w-32 shrink-0 place-items-center rounded-full border-4 border-white bg-blue-100 text-3xl font-bold text-blue-800 shadow-md ring-1 ring-slate-200" aria-label="No profile picture">{getInitials(latestVisit.visitor.fullName)}</div>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Verified visitor</p>
                  <h3 className="mt-1 break-words text-xl font-bold text-shelf-primary">{latestVisit.visitor.fullName}</h3>
                  <p className="mt-2 break-all text-sm text-slate-600">{latestVisit.visitor.email || 'No email on file'}</p>
                  <p className="mt-1 text-sm text-slate-600">{latestVisit.visitor.contactNumber || 'No contact number on file'}</p>
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 px-5 py-4 text-center">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{latestVisit.action === 'checked_out' ? 'Time out' : 'Time in'}</p>
                <p className="mt-1 text-3xl font-extrabold tabular-nums text-shelf-primary">{formatTime(latestVisit.time)}</p>
                <p className="mt-1 text-sm text-slate-600">{formatDate(latestVisit.time)}</p>
              </div>
              {latestVisit.visitor.address && <p className="text-center text-xs text-slate-500">{latestVisit.visitor.address}</p>}
              <p className="text-center text-xs text-slate-500">This panel clears after a few seconds. The scanner stays ready for the next visitor.</p>
            </div>
          ) : scanError ? (
            <div className="grid min-h-80 place-items-center p-8 text-center"><div><CircleAlert size={34} className="mx-auto text-red-500" /><p className="mt-3 font-semibold text-slate-800">Pass not processed</p><p className="mt-1 max-w-sm text-sm text-slate-500">Please present the QR pass again or ask the librarian for help.</p></div></div>
          ) : (
            <div className="grid min-h-80 place-items-center p-8 text-center"><div><span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-blue-50 text-blue-700"><UserRound size={28} aria-hidden="true" /></span><p className="mt-4 text-lg font-bold text-slate-800">Ready for the next visitor</p><p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">After scanning, the visitor’s profile and recorded time will appear here. Camera scanning continues in the background.</p></div></div>
          )}
        </section>
      </div>
      <footer className="px-5 pb-5 text-center text-xs text-slate-500">Attendance kiosk · {libraryName}</footer>
    </main>
  );
}
