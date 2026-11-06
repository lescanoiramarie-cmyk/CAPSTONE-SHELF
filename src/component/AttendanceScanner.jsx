import { Clock3, QrCode, UsersRound, UserCheck } from 'lucide-react';
import { useAuth } from '../context/useAuth.js';
import { useLibraryData } from '../context/useLibrary.js';

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function AttendanceScanner() {
  const { user } = useAuth();
  const { attendanceLogs, libraries } = useLibraryData();
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
  const checkedOutCount = todaysLogs.filter((log) => log.checkedOutAt).length;
  const currentlyInsideCount = todaysLogs.length - checkedOutCount;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">Visitor services</p>
          <h2 className="mt-1 text-3xl font-semibold leading-tight tracking-tight text-shelf-primary">Attendance</h2>
          <p className="mt-1 text-base leading-6 text-slate-600">Monitor today's branch visits and check-in status.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-800">
            <span className="h-2 w-2 rounded-full bg-blue-600" />{libraryName}
          </span>
          <a href="/subadmin/attendance-kiosk" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-shelf-primary px-4 py-2 text-base font-semibold text-white shadow-sm transition hover:bg-blue-900">
            <QrCode size={16} aria-hidden="true" />Open kiosk tab
          </a>
        </div>
      </header>

      <section aria-label="Today's attendance summary" className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Visits today', value: todaysLogs.length, Icon: UsersRound },
          { label: 'Currently inside', value: currentlyInsideCount, Icon: UserCheck },
          { label: 'Checked out', value: checkedOutCount, Icon: Clock3 },
        ].map(({ label, value, Icon }) => (
          <div key={label} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700"><Icon size={19} aria-hidden="true" /></span>
            <div><p className="text-sm font-semibold leading-5 text-slate-600">{label}</p><p className="mt-0.5 text-2xl font-bold leading-7 text-shelf-primary">{value}</p></div>
          </div>
        ))}
      </section>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div><h3 className="text-xl font-semibold leading-7 text-slate-900">Today's branch activity</h3><p className="mt-1 text-sm leading-5 text-slate-600">Check-in and check-out activity for this branch</p></div>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-base font-semibold tabular-nums text-blue-800">{todaysLogs.length}</span>
          </div>
          {todaysLogs.length === 0 ? (
            <div className="grid min-h-48 place-items-center px-5 py-8 text-center"><div><span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-500"><UsersRound size={20} aria-hidden="true" /></span><p className="mt-3 text-base font-semibold leading-6 text-slate-700">No visits recorded today</p><p className="mt-1 text-sm leading-5 text-slate-600">Scans from the kiosk will appear here.</p></div></div>
          ) : (
            <div className="max-h-[34rem] overflow-auto">
              <table className="w-full min-w-[38rem] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-bold uppercase tracking-[0.08em] text-slate-600"><tr><th className="px-5 py-3">Visitor</th><th className="px-5 py-3">Library</th><th className="px-5 py-3">Time in</th><th className="px-5 py-3">Status / time out</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {todaysLogs.map((log) => {
                    const visitLibrary = libraries.find((library) => library.id === log.libraryId)?.name || 'Unknown Library';
                    return <tr key={log.id} className="transition-colors hover:bg-blue-50/40">
                      <td className="px-5 py-3.5 text-base font-semibold leading-6 text-slate-800">{log.visitorName}</td>
                      <td className="max-w-56 px-5 py-3.5 text-sm leading-5 text-slate-600">{visitLibrary}</td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-sm leading-5 text-slate-600">{formatDateTime(log.timeIn)}</td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-sm leading-5">{log.checkedOutAt ? <span className="text-slate-600">{formatDateTime(log.checkedOutAt)}</span> : <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">Currently inside</span>}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </div>
  );
}
