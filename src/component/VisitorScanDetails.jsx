export default function VisitorScanDetails({ visitor }) {
  const details = [
    ['Full name', visitor.fullName],
    ['Email', visitor.email],
    ['Contact number', visitor.contactNumber],
    ['Address', visitor.address],
  ];

  return (
    <dl className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
      {details.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-medium text-slate-500">{label}</dt>
          <dd className="mt-0.5 break-words text-sm font-semibold text-slate-800">
            {value || 'Not provided'}
          </dd>
        </div>
      ))}
    </dl>
  );
}
