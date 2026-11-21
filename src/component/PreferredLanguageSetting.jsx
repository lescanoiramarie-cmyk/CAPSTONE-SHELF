import { useLanguage } from '../context/LanguageContext.jsx';

export default function PreferredLanguageSetting({ darkMode = false }) {
  const { language, setLanguage, t } = useLanguage();

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
    <section className={`h-fit min-w-0 self-start rounded-2xl border p-4 shadow-sm sm:p-5 ${darkMode ? 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800' : 'border-slate-200 bg-white'}`}>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,14rem)] sm:items-center sm:gap-3">
        <div className="min-w-0">
          <h3 className={`font-bold ${tone}`}>{t('Preferred language')}</h3>
          <p className={`mt-1 text-sm leading-5 ${mutedTone}`}>
            {t('Choose the language you prefer for SHELF.')}
          </p>
        </div>
        <label className="sr-only" htmlFor="preferred-language-select">
          {t('Preferred language')}
        </label>
        <select
          id="preferred-language-select"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          className={`w-full min-w-0 rounded-lg border px-3 py-2.5 text-sm focus:border-shelf-primary focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 ${selectTone}`}
        >
          <option value="en">English</option>
          <option value="fil">Filipino</option>
        </select>
      </div>
      <p className={`mt-1.5 text-xs leading-5 ${mutedTone}`}>
        {t('This preference is saved on this device.')}
      </p>
    </section>
  );
}
