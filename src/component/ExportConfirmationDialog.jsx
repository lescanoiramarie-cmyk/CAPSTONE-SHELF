import { useState } from 'react';
import PropTypes from 'prop-types';

export default function ExportConfirmationDialog({ file, onCancel, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!file?.blob || !file?.fileName) return null;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      if (typeof window.showSaveFilePicker === 'function') {
        const extension = file.fileName.split('.').pop()?.toLowerCase();
        const mimeType = extension === 'pdf'
          ? 'application/pdf'
          : extension === 'csv'
            ? 'text/csv'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        const handle = await window.showSaveFilePicker({
          suggestedName: file.fileName,
          types: [{ description: `${file.label || 'Export'} file`, accept: { [mimeType]: [`.${extension}`] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(file.blob);
        await writable.close();
      } else {
        const url = URL.createObjectURL(file.blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      onSaved?.();
    } catch (saveError) {
      if (saveError?.name !== 'AbortError') setError('The file could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/50 p-4" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="export-confirm-title" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <h2 id="export-confirm-title" className="text-lg font-bold text-slate-900 dark:text-white">Download this file?</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Save the {file.label || 'export'} file <span className="font-semibold">{file.fileName}</span> to your device?</p>
        {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">No, cancel</button>
          <button type="button" disabled={saving} onClick={() => void save()} className="rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Opening save dialog…' : 'Yes, choose location'}</button>
        </div>
      </section>
    </div>
  );
}

ExportConfirmationDialog.propTypes = {
  file: PropTypes.shape({ blob: PropTypes.instanceOf(Blob), fileName: PropTypes.string, label: PropTypes.string }),
  onCancel: PropTypes.func.isRequired,
  onSaved: PropTypes.func,
};
