import { useEffect, useState } from 'react';

const DEFAULT_LANGUAGE = 'en';

function getSavedLanguage(storageKey) {
  try {
    const savedLanguage = window.localStorage.getItem(storageKey);
    return savedLanguage === 'fil' ? 'fil' : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export default function PreferredLanguageSetting({ storageKey, darkMode = false }) {
  const [language, setLanguage] = useState(() => getSavedLanguage(storageKey));

  useEffect(() => {
    document.documentElement.lang = language === 'fil' ? 'fil' : 'en';
  }, [language]);

  const saveLanguage = (event) => {
    const nextLanguage = event.target.value === 'fil' ? 'fil' : 'en';
    setLanguage(nextLanguage);
    try {
      window.localStorage.setItem(storageKey, nextLanguage);
    } catch {
      // Keep the in-memory selection available if browser storage is disabled.
    }
  };

  const tone = darkMode
    ? 'text-slate-900 dark:text-white'
    : 'text-slate-900';
  const mutedTone = darkMode
    ? 'text-slate-600 dark:text-slate-400'
    : 'text-slate-600';
  const selectTone = darkMode
    ? 'border-slate-300 bg-white text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-white'
    : 'border-slate-300 bg-white text-slate-800';

  return (
    <section className={`min-w-0 rounded-2xl border p-5 shadow-sm ${darkMode ? 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800' : 'border-slate-200 bg-white'}`}>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,14rem)] sm:items-center">
        <div className="min-w-0">
          <h3 className={`font-bold ${tone}`}>Preferred language</h3>
          <p className={`mt-1 text-sm leading-5 ${mutedTone}`}>
            Choose the language you prefer for SHELF.
          </p>
        </div>
        <label className="sr-only" htmlFor={`${storageKey}-select`}>
          Preferred language
        </label>
        <select
          id={`${storageKey}-select`}
          value={language}
          onChange={saveLanguage}
          className={`w-full min-w-0 rounded-lg border px-3 py-2.5 text-sm focus:border-shelf-primary focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 ${selectTone}`}
        >
          <option value="en">English</option>
          <option value="fil">Filipino</option>
        </select>
      </div>
      <p className={`mt-2 text-xs leading-5 ${mutedTone}`}>
        This preference is saved on this device.
      </p>
    </section>
  );
}
