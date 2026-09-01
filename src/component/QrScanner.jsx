import { useState } from 'react';
import { useLibraryData } from '../context/LibraryContext';

/**
 * Staff-facing "scan" control.
 *
 * No camera/QR-decoding library is installed in this project yet, so this
 * simulates a hardware scanner with a manual code field (a real barcode/QR
 * scanner acts as a keyboard and types the code + Enter — this input already
 * supports that) plus a quick-pick dropdown of registered visitors for demo
 * convenience. To wire up a real camera, install `html5-qrcode` and swap the
 * input for a decoder that calls onScan(code) — the rest of the flow below
 * (attendance / borrowing / returning) does not need to change.
 */
export default function QrScanner({ onScan, placeholder = 'Scan or type visitor QR code…', autoClear = true }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const { visitors } = useLibraryData();

  const submit = (code) => {
    const trimmed = (code ?? value).trim();
    if (!trimmed) return;
    try {
      setError('');
      onScan(trimmed);
      if (autoClear) setValue('');
    } catch (err) {
      setError(err.message || 'Scan failed.');
    }
  };

  return (
    <div className="space-y-2">
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
          Scan
        </button>
      </div>

      {visitors.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>Quick-pick (demo):</span>
          <select
            className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white"
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

      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
    </div>
  );
}
