import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';

export default function AuditLogViewer({ libraries = [] }) {
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function loadLogs() {
      setLoading(true);
      setError('');
      let query = supabase
        .from('audit_logs')
        .select('id, actor_id, action, branch_id, details, created_at')
        .order('created_at', { ascending: false })
        .limit(500);

      if (branchId) query = query.eq('branch_id', branchId);
      const { data, error: queryError } = await query;
      if (!active) return;
      if (queryError) setError(queryError.message);
      else setLogs(data || []);
      setLoading(false);
    }

    loadLogs();
    return () => { active = false; };
  }, [branchId]);

  const visibleLogs = logs.filter((log) => {
    const text = `${log.action} ${log.actor_id || ''} ${JSON.stringify(log.details || {})}`.toLowerCase();
    return text.includes(search.trim().toLowerCase());
  });

  const branchName = (id) =>
    libraries.find((library) => String(library.id) === String(id))?.name || id || 'Network-wide';

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-lg font-bold text-slate-900">Audit trail</h2>
        <p className="text-sm text-slate-500">Administrative changes and sensitive circulation actions.</p>
      </header>
      <div className="flex flex-wrap gap-3">
        <label className="relative min-w-56 flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search actions or details"
            className="w-full border border-slate-300 py-2 pl-9 pr-3 text-sm"
          />
        </label>
        <select value={branchId} onChange={(event) => setBranchId(event.target.value)} className="border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="">All branches</option>
          {libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}
        </select>
      </div>
      {error && <p role="alert" className="border border-red-200 bg-red-50 p-3 text-sm text-red-800">Unable to load audit records: {error}</p>}
      <div className="overflow-x-auto border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">When</th><th className="p-3">Actor</th><th className="p-3">Action</th><th className="p-3">Branch</th><th className="p-3">Details</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {visibleLogs.map((log) => (
              <tr key={log.id}>
                <td className="p-3 whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</td>
                <td className="p-3 font-mono text-xs">{log.actor_id || 'System'}</td>
                <td className="p-3">{log.action}</td>
                <td className="p-3">{branchName(log.branch_id)}</td>
                <td className="max-w-sm p-3"><pre className="whitespace-pre-wrap break-words font-sans text-xs">{JSON.stringify(log.details || {})}</pre></td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <p className="p-5 text-center text-sm text-slate-500">Loading audit records...</p>}
        {!loading && !error && visibleLogs.length === 0 && <p className="p-5 text-center text-sm text-slate-500">No audit events found.</p>}
      </div>
    </section>
  );
}