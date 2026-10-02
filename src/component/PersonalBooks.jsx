import { useEffect, useState } from 'react';
import { BookMarked, Plus, RefreshCw, X } from 'lucide-react';

import {
  addPersonalBook,
  fetchPersonalBooks,
} from '../data/store.js';

const CONDITIONS = [
  'New',
  'Like New',
  'Good',
  'Fair',
  'Poor',
];

const INITIAL_FORM = {
  title: '',
  author: '',
  category: '',
  isbn: '',
  summary: '',
  condition: 'Good',
  lendingPeriodDays: 7,
  handoverLocation: '',
  lendingEnabled: true,
};

function formatDate(value) {
  if (!value) return '';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString('en-PH', {
    dateStyle: 'medium',
  });
}

export default function PersonalBooks({ userId }) {
  const [books, setBooks] = useState([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [isFormOpen, setIsFormOpen] = useState(false);

  const [form, setForm] = useState(INITIAL_FORM);

  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // ============================================================
  // LOAD MY PERSONAL BOOKS
  // ============================================================

  const loadBooks = async () => {
    if (!userId) {
      setBooks([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const rows = await fetchPersonalBooks(userId);

      setBooks(Array.isArray(rows) ? rows : []);
    } catch (loadError) {
      console.error('LOAD PERSONAL BOOKS ERROR:', loadError);

      setError(
        loadError?.message ||
          'Unable to load your personal books.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    async function initialLoad() {
      if (!userId) {
        if (active) {
          setBooks([]);
          setIsLoading(false);
        }

        return;
      }

      if (active) {
        setIsLoading(true);
        setError('');
      }

      try {
        const rows = await fetchPersonalBooks(userId);

        if (active) {
          setBooks(Array.isArray(rows) ? rows : []);
        }
      } catch (loadError) {
        console.error(
          'INITIAL PERSONAL BOOKS LOAD ERROR:',
          loadError
        );

        if (active) {
          setError(
            loadError?.message ||
              'Unable to load your personal books.'
          );
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    initialLoad();

    return () => {
      active = false;
    };
  }, [userId]);

  // ============================================================
  // FORM HELPERS
  // ============================================================

  const updateForm = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const resetForm = () => {
    setForm(INITIAL_FORM);
    setError('');
  };

  const openAddForm = () => {
    setMessage('');
    setError('');
    resetForm();
    setIsFormOpen(true);
  };

  const closeAddForm = () => {
    if (isSaving) return;

    setIsFormOpen(false);
    resetForm();
  };

  // ============================================================
  // ADD PERSONAL BOOK
  // ============================================================

  const handleAddBook = async (event) => {
    event.preventDefault();

    setError('');
    setMessage('');

    if (!userId) {
      setError(
        'Your visitor account could not be identified. Please log in again.'
      );

      return;
    }

    const title = form.title.trim();
    const author = form.author.trim();
    const category = form.category.trim();
    const isbn = form.isbn.trim();
    const summary = form.summary.trim();
    const condition = form.condition;
    const handoverLocation =
      form.handoverLocation.trim();

    const lendingPeriodDays = Number(
      form.lendingPeriodDays
    );

    if (!title) {
      setError('Book title is required.');
      return;
    }

    if (!author) {
      setError('Book author is required.');
      return;
    }

    if (!CONDITIONS.includes(condition)) {
      setError('Please select a valid book condition.');
      return;
    }

    if (
      !Number.isInteger(lendingPeriodDays) ||
      lendingPeriodDays < 1 ||
      lendingPeriodDays > 30
    ) {
      setError(
        'Lending period must be between 1 and 30 days.'
      );

      return;
    }

    if (
      form.lendingEnabled &&
      !handoverLocation
    ) {
      setError(
        'Handover location is required when community lending is enabled.'
      );

      return;
    }

    setIsSaving(true);

    try {
      const createdBook = await addPersonalBook({
        visitorId: userId,
        title,
        author,
        category: category || null,
        isbn: isbn || null,
        summary: summary || null,
        condition,
        lendingPeriodDays,
        handoverLocation:
          handoverLocation || null,
        lendingEnabled:
          Boolean(form.lendingEnabled),
      });

      /*
       * Add the newly created book immediately to the
       * local collection.
       *
       * This avoids requiring a full page refresh.
       */
      if (createdBook?.id) {
        setBooks((current) => [
          createdBook,
          ...current.filter(
            (book) => book.id !== createdBook.id
          ),
        ]);
      } else {
        await loadBooks();
      }

      setMessage(
        `"${title}" was added to your personal books.`
      );

      setForm(INITIAL_FORM);
      setIsFormOpen(false);
    } catch (saveError) {
      console.error(
        'ADD PERSONAL BOOK ERROR:',
        saveError
      );

      setError(
        saveError?.message ||
          'Unable to add your personal book.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  // ============================================================
  // NO USER
  // ============================================================

  if (!userId) {
    return (
      <section className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <h2 className="font-bold">
          Personal Books
        </h2>

        <p className="mt-2 text-sm">
          Your visitor account could not be identified.
          Please log in again.
        </p>
      </section>
    );
  }

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <section className="space-y-6">
      {/* ======================================================
          HEADER
      ======================================================= */}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BookMarked
              size={22}
              className="text-[#002046] dark:text-blue-400"
              aria-hidden="true"
            />

            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
              My Personal Books
            </h2>
          </div>

          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Add books that you personally own and optionally
            make them available for community lending.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={loadBooks}
            disabled={isLoading}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <RefreshCw
              size={16}
              className={
                isLoading
                  ? 'animate-spin'
                  : ''
              }
              aria-hidden="true"
            />

            Refresh
          </button>

          <button
            type="button"
            onClick={openAddForm}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#002046] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#003064]"
          >
            <Plus
              size={17}
              aria-hidden="true"
            />

            Add Personal Book
          </button>
        </div>
      </div>

      {/* ======================================================
          SUCCESS MESSAGE
      ======================================================= */}

      {message && (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          {message}
        </div>
      )}

      {/* ======================================================
          ERROR MESSAGE
      ======================================================= */}

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {/* ======================================================
          ADD PERSONAL BOOK FORM
      ======================================================= */}

      {isFormOpen && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
                Add Personal Book
              </h3>

              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Add a book that you personally own.
              </p>
            </div>

            <button
              type="button"
              onClick={closeAddForm}
              disabled={isSaving}
              className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:hover:bg-slate-700 dark:hover:text-white"
              aria-label="Close add personal book form"
            >
              <X
                size={18}
                aria-hidden="true"
              />
            </button>
          </div>

          <form
            onSubmit={handleAddBook}
            className="space-y-5"
          >
            {/* TITLE + AUTHOR */}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label
                  htmlFor="personal-book-title"
                  className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200"
                >
                  Book Title
                  <span className="text-red-500">
                    {' '}
                    *
                  </span>
                </label>

                <input
                  id="personal-book-title"
                  type="text"
                  value={form.title}
                  onChange={(event) =>
                    updateForm(
                      'title',
                      event.target.value
                    )
                  }
                  placeholder="Enter book title"
                  maxLength={255}
                  disabled={isSaving}
                  required
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#002046] focus:ring-2 focus:ring-[#002046]/10 disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800"
                />
              </div>

              <div>
                <label
                  htmlFor="personal-book-author"
                  className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200"
                >
                  Author
                  <span className="text-red-500">
                    {' '}
                    *
                  </span>
                </label>

                <input
                  id="personal-book-author"
                  type="text"
                  value={form.author}
                  onChange={(event) =>
                    updateForm(
                      'author',
                      event.target.value
                    )
                  }
                  placeholder="Enter author name"
                  maxLength={255}
                  disabled={isSaving}
                  required
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#002046] focus:ring-2 focus:ring-[#002046]/10 disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800"
                />
              </div>
            </div>

            {/* CATEGORY + ISBN */}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label
                  htmlFor="personal-book-category"
                  className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200"
                >
                  Category
                </label>

                <input
                  id="personal-book-category"
                  type="text"
                  value={form.category}
                  onChange={(event) =>
                    updateForm(
                      'category',
                      event.target.value
                    )
                  }
                  placeholder="e.g. Computer Science"
                  maxLength={100}
                  disabled={isSaving}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#002046] focus:ring-2 focus:ring-[#002046]/10 disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800"
                />
              </div>

              <div>
                <label
                  htmlFor="personal-book-isbn"
                  className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200"
                >
                  ISBN
                </label>

                <input
                  id="personal-book-isbn"
                  type="text"
                  value={form.isbn}
                  onChange={(event) =>
                    updateForm(
                      'isbn',
                      event.target.value
                    )
                  }
                  placeholder="Optional ISBN"
                  maxLength={50}
                  disabled={isSaving}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#002046] focus:ring-2 focus:ring-[#002046]/10 disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800"
                />
              </div>
            </div>

            {/* SUMMARY */}

            <div>
              <label
                htmlFor="personal-book-summary"
                className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200"
              >
                Summary
              </label>

              <textarea
                id="personal-book-summary"
                value={form.summary}
                onChange={(event) =>
                  updateForm(
                    'summary',
                    event.target.value
                  )
                }
                placeholder="Brief description of the book"
                rows={4}
                maxLength={2000}
                disabled={isSaving}
                className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#002046] focus:ring-2 focus:ring-[#002046]/10 disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800"
              />
            </div>

            {/* CONDITION + LENDING PERIOD */}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label
                  htmlFor="personal-book-condition"
                  className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200"
                >
                  Book Condition
                  <span className="text-red-500">
                    {' '}
                    *
                  </span>
                </label>

                <select
                  id="personal-book-condition"
                  value={form.condition}
                  onChange={(event) =>
                    updateForm(
                      'condition',
                      event.target.value
                    )
                  }
                  disabled={isSaving}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#002046] focus:ring-2 focus:ring-[#002046]/10 disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800"
                >
                  {CONDITIONS.map(
                    (condition) => (
                      <option
                        key={condition}
                        value={condition}
                      >
                        {condition}
                      </option>
                    )
                  )}
                </select>
              </div>

              <div>
                <label
                  htmlFor="personal-book-lending-days"
                  className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200"
                >
                  Lending Period
                  <span className="text-red-500">
                    {' '}
                    *
                  </span>
                </label>

                <div className="flex items-center gap-2">
                  <input
                    id="personal-book-lending-days"
                    type="number"
                    min="1"
                    max="30"
                    step="1"
                    value={form.lendingPeriodDays}
                    onChange={(event) =>
                      updateForm(
                        'lendingPeriodDays',
                        event.target.value
                      )
                    }
                    disabled={isSaving}
                    required
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#002046] focus:ring-2 focus:ring-[#002046]/10 disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800"
                  />

                  <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">
                    days
                  </span>
                </div>

                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Allowed range: 1–30 days.
                </p>
              </div>
            </div>

            {/* COMMUNITY LENDING */}

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/50">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={form.lendingEnabled}
                  onChange={(event) =>
                    updateForm(
                      'lendingEnabled',
                      event.target.checked
                    )
                  }
                  disabled={isSaving}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-[#002046] focus:ring-[#002046]"
                />

                <span>
                  <span className="block text-sm font-bold text-slate-800 dark:text-slate-100">
                    Allow Community Lending
                  </span>

                  <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                    Other SHELF visitors will be able to
                    request this book through the community
                    lending feature.
                  </span>
                </span>
              </label>
            </div>

            {/* HANDOVER LOCATION */}

            <div>
              <label
                htmlFor="personal-book-handover"
                className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200"
              >
                Handover Location
                {form.lendingEnabled && (
                  <span className="text-red-500">
                    {' '}
                    *
                  </span>
                )}
              </label>

              <input
                id="personal-book-handover"
                type="text"
                value={form.handoverLocation}
                onChange={(event) =>
                  updateForm(
                    'handoverLocation',
                    event.target.value
                  )
                }
                placeholder={
                  form.lendingEnabled
                    ? 'e.g. BatStateU JPLPC-Malvar Library'
                    : 'Optional'
                }
                maxLength={500}
                disabled={isSaving}
                required={form.lendingEnabled}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#002046] focus:ring-2 focus:ring-[#002046]/10 disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800"
              />

              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Specify where the owner and borrower can
                arrange the physical handover.
              </p>
            </div>

            {/* FORM ACTIONS */}

            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 dark:border-slate-700 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeAddForm}
                disabled={isSaving}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isSaving}
                className="rounded-lg bg-[#002046] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#003064] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving
                  ? 'Adding Book...'
                  : 'Add Personal Book'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ======================================================
          COLLECTION
      ======================================================= */}

      <div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
              My Personal Books Collection
            </h3>

            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {books.length}{' '}
              {books.length === 1
                ? 'book'
                : 'books'}{' '}
              registered under your account.
            </p>
          </div>
        </div>

        {/* LOADING */}

        {isLoading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-800">
            <RefreshCw
              size={24}
              className="mx-auto animate-spin text-[#002046] dark:text-blue-400"
              aria-hidden="true"
            />

            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              Loading your personal books...
            </p>
          </div>
        ) : books.length === 0 ? (
          /* EMPTY */

          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-800">
            <BookMarked
              size={38}
              className="mx-auto text-slate-400"
              aria-hidden="true"
            />

            <h4 className="mt-3 text-base font-bold text-slate-800 dark:text-slate-100">
              No personal books yet
            </h4>

            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
              Add a book you personally own to keep track
              of it in SHELF and optionally make it available
              for community lending.
            </p>

            <button
              type="button"
              onClick={openAddForm}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#002046] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#003064]"
            >
              <Plus
                size={16}
                aria-hidden="true"
              />

              Add Your First Book
            </button>
          </div>
        ) : (
          /* BOOK LIST */

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {books.map((book) => {
              const isLendingEnabled =
                Boolean(book.lendingEnabled);

              return (
                <article
                  key={book.id}
                  className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
                >
                  {/* BOOK HEADER */}

                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h4 className="break-words text-base font-extrabold text-slate-900 dark:text-white">
                        {book.title}
                      </h4>

                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        by {book.author}
                      </p>
                    </div>

                    <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                      Personal
                    </span>
                  </div>

                  {/* DETAILS */}

                  <div className="mt-4 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                    {book.category && (
                      <div>
                        <span className="font-bold text-slate-600 dark:text-slate-400">
                          Category:{' '}
                        </span>

                        <span className="text-slate-500 dark:text-slate-300">
                          {book.category}
                        </span>
                      </div>
                    )}

                    {book.isbn && (
                      <div>
                        <span className="font-bold text-slate-600 dark:text-slate-400">
                          ISBN:{' '}
                        </span>

                        <span className="text-slate-500 dark:text-slate-300">
                          {book.isbn}
                        </span>
                      </div>
                    )}

                    <div>
                      <span className="font-bold text-slate-600 dark:text-slate-400">
                        Condition:{' '}
                      </span>

                      <span className="text-slate-500 dark:text-slate-300">
                        {book.condition ||
                          'Not specified'}
                      </span>
                    </div>

                    <div>
                      <span className="font-bold text-slate-600 dark:text-slate-400">
                        Lending period:{' '}
                      </span>

                      <span className="text-slate-500 dark:text-slate-300">
                        {book.lendingPeriodDays ||
                          7}{' '}
                        days
                      </span>
                    </div>
                  </div>

                  {/* SUMMARY */}

                  {book.summary && (
                    <div className="mt-4 rounded-lg bg-slate-50 p-3 dark:bg-slate-900/50">
                      <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">
                        {book.summary}
                      </p>
                    </div>
                  )}

                  {/* LENDING STATUS */}

                  <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-700">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                          isLendingEnabled
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {isLendingEnabled
                          ? 'Community Lending Enabled'
                          : 'Private Book'}
                      </span>

                      <span className="text-[11px] text-slate-400">
                        {book.createdAt
                          ? `Added ${formatDate(
                              book.createdAt
                            )}`
                          : ''}
                      </span>
                    </div>

                    {isLendingEnabled &&
                      book.handoverLocation && (
                        <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                          <span className="font-bold">
                            Handover:
                          </span>{' '}
                          {book.handoverLocation}
                        </p>
                      )}
                  </div>

                  {/* FUTURE WORKFLOW NOTE */}

                  {isLendingEnabled && (
                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
                      <p className="text-[11px] leading-5 text-amber-800 dark:text-amber-300">
                        This book is available for community
                        lending. Borrow requests will use the
                        owner-approval workflow.
                      </p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
