import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLibraryData, useLibrary } from '../context/LibraryContext';
import QrScanner from './QrScanner';

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function AttendanceScanner() {
  const { user } = useAuth();
  const { attendanceLogs, libraries } = useLibraryData();
  const { scanAttendance } = useLibrary();
  const [message, setMessage] = useState('');

  const libraryId = user?.libraryId || libraries[0]?.id;
  const libraryName = libraries.find((l) => l.id === libraryId)?.name || 'this branch';

  const today = new Date().toDateString();
  const todaysLogs = attendanceLogs
    .filter((a) => a.libraryId === libraryId && new Date(a.timeIn).toDateString() === today)
    .sort((a, b) => new Date(b.timeIn) - new Date(a.timeIn));

  const handleScan = (code) => {
    try {
      const { visitor } = scanAttendance(code, libraryId);
      setMessage(`Attendance logged for ${visitor.fullName}.`);
    } catch (err) {
      setMessage(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
        <h3 className="text-sm font-bold text-slate-800">Entrance Attendance — {libraryName}</h3>
        <p className="text-xs text-slate-500">Scan a visitor's QR pass as they enter the library to log their visit.</p>
        <QrScanner onScan={handleScan} placeholder="Scan visitor QR at entrance…" />
        {message && (
          <div className="text-xs font-semibold bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2">{message}</div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 flex justify-between items-center">
          <h3 className="text-sm font-bold text-slate-800">Today's Visits</h3>
          <span className="text-xs font-bold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">{todaysLogs.length}</span>
        </div>
        {todaysLogs.length === 0 ? (
          <p className="p-5 text-xs text-slate-500">No visitors have checked in yet today.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="p-3">Visitor</th>
                <th className="p-3">Time In</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {todaysLogs.map((log) => (
                <tr key={log.id}>
                  <td className="p-3 font-semibold text-slate-700">{log.visitorName}</td>
                  <td className="p-3 text-xs text-slate-500">{formatDateTime(log.timeIn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
