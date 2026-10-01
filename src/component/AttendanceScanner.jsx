import { useState } from 'react';
import { useAuth } from '../context/useAuth.js';
import { useLibraryData, useLibrary } from '../context/useLibrary.js';
import QrScanner from './QrScanner';

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function AttendanceScanner() {
  const { user } = useAuth();
  const { attendanceLogs, libraries } = useLibraryData();
  const { scanAttendance } = useLibrary();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const libraryId = user?.libraryId || libraries[0]?.id;

  const libraryName =
    libraries.find((l) => l.id === libraryId)?.name || 'this branch';

  const today = new Date().toDateString();

  const todaysLogs = attendanceLogs
    .filter(
      (a) => a.libraryId === libraryId && new Date(a.timeIn).toDateString() === today
    )
    .sort(
      (a, b) => new Date(b.timeIn) - new Date(a.timeIn)
    );

  const handleScan = async (code) => {
    setError('');
    setMessage('');
    try {
      const { visitor, log } = await scanAttendance(code, libraryId);
      setMessage(`${visitor.fullName} checked ${log.action === 'checked_out' ? 'out' : 'in'}.`);
    } catch (scanError) {
      setError(scanError.message || 'Unable to record attendance for this branch.');
    }
  };

  return (
    <div className="space-y-4">

      {/* QR Scanner */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
        <h3 className="text-sm font-bold text-slate-800">
          Entrance Attendance — {libraryName}
        </h3>

        <p className="text-xs text-slate-500">
          Scan at entry to check in, and scan the same pass again at exit to check out.
        </p>

        <QrScanner
          onScan={handleScan}
          placeholder="Scan visitor QR at entrance…"
        />

        {message && (
          <div className="text-xs font-semibold bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2">
            {message}
          </div>
        )}
        {error && (
          <div role="alert" className="text-xs font-semibold bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {/* Today's Shared Attendance */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">

        <div className="px-5 py-3 border-b border-slate-200 flex justify-between items-center">
          <div>
            <h3 className="text-sm font-bold text-slate-800">
              Today's Branch Attendance
            </h3>

            <p className="text-xs text-slate-500 mt-0.5">
              Check-in and check-out activity for this branch
            </p>
          </div>

          <span className="text-xs font-bold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
            {todaysLogs.length}
          </span>
        </div>

        {todaysLogs.length === 0 ? (
          <p className="p-5 text-xs text-slate-500">
            No visitors have checked in yet today.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">

              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="p-3">Visitor</th>
                  <th className="p-3">Library</th>
                  <th className="p-3">Time In</th>
                  <th className="p-3">Time Out</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {todaysLogs.map((log) => {
                  const visitLibrary =
                    libraries.find(
                      (library) => library.id === log.libraryId
                    )?.name || 'Unknown Library';

                  return (
                    <tr key={log.id}>

                      <td className="p-3 font-semibold text-slate-700">
                        {log.visitorName}
                      </td>

                      <td className="p-3 text-xs text-slate-500">
                        {visitLibrary}
                      </td>

                      <td className="p-3 text-xs text-slate-500">
                        {formatDateTime(log.timeIn)}
                      </td>

                      <td className="p-3 text-xs text-slate-500">
                        {log.checkedOutAt ? formatDateTime(log.checkedOutAt) : 'Still checked in'}
                      </td>

                    </tr>
                  );
                })}
              </tbody>

            </table>
          </div>
        )}
      </div>
    </div>
  );
}
