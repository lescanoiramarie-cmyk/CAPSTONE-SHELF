import { useEffect, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Pencil, Search, Trash2, X } from 'lucide-react';
import { useLibrary } from '../context/useLibrary';
import { useAuth } from '../context/useAuth.js';
import { supabase } from '../lib/supabaseClient';
import { normalizeBookFineRate } from '../lib/bookFineRate.js';
import { formatBookCategory } from '../lib/bookCategory.js';
import { getBookInventoryScope } from '../lib/bookInventoryScope.js';

const INVENTORY_PAGE_SIZE = 10;

export default function BookInventory() {
  const { user } = useAuth();
  const {
    books,
    addBook,
    updateBook,
    deleteBook,
    libraries,
    loading,
    error
  } = useLibrary();
  const {
    books: inventoryBooks,
    libraries: inventoryLibraries,
    assignedLibraryId,
    isSubAdmin,
  } = getBookInventoryScope(books, libraries, user);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('title-asc');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [mutationNotice, setMutationNotice] = useState('');
  const [selectedCoverFile, setSelectedCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState('');
  const [isDraggingCover, setIsDraggingCover] = useState(false);

  useEffect(() => {
    if (!showForm) return undefined;

    const dialog = document.querySelector(
      '[aria-labelledby="book-inventory-form-title"]'
    );
    if (!dialog) return undefined;

    const previousFocus = document.activeElement;
    const focusableSelector =
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () => [...dialog.querySelectorAll(focusableSelector)];
    dialog.querySelector('#book-title')?.focus();

    const handleDialogKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowForm(false);
        return;
      }

      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleDialogKeyDown);
    return () => {
      document.removeEventListener('keydown', handleDialogKeyDown);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, [showForm]);

  const getBookCopies = (book) =>
    Number(book?.totalCopies ?? book?.total_copies ?? book?.copies ?? 0);

  const MAX_COVER_SIZE = 5 * 1024 * 1024;

  const handleCoverSelect = (file) => {
    if (!file) return;

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setMutationError('Choose a JPG or PNG image for the book cover.');
      return;
    }

    if (file.size > MAX_COVER_SIZE) {
      setMutationError('Book cover images must be 5 MB or smaller.');
      return;
    }

    setMutationError('');
    setSelectedCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  };

  useEffect(() => {
    if (!selectedCoverFile || !coverPreview) return;

    return () => URL.revokeObjectURL(coverPreview);
  }, [selectedCoverFile, coverPreview]);

  const handleRemoveCover = () => {
    setSelectedCoverFile(null);
    setCoverPreview('');
    setForm((previous) => ({
      ...previous,
      coverUrl: ''
    }));
  };

  const uploadBookCover = async (file, libraryId) => {
    if (!supabase) {
      throw new Error(
        'Cover uploads are unavailable because the storage service is not configured.'
      );
    }

    if (!libraryId) {
      throw new Error('Select a library before uploading a book cover.');
    }

    const assignedBranch = user?.libraryId || user?.assignedBranch;

    if (
      user?.role === 'subadmin' &&
      String(assignedBranch || '') !== String(libraryId)
    ) {
      throw new Error(
        'You can only upload covers for books assigned to your branch.'
      );
    }

    const extension = file.type === 'image/png' ? 'png' : 'jpg';
    const filePath = `books/${libraryId}/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from('book-covers')
      .upload(filePath, file, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error('Book cover upload failed:', uploadError);

      const uploadMessage = String(uploadError.message || '').toLowerCase();

      if (
        uploadError.statusCode === '403' ||
        uploadMessage.includes('row-level security') ||
        uploadMessage.includes('not authorized') ||
        uploadMessage.includes('permission')
      ) {
        throw new Error(
          'Cover upload was denied. Verify that your account can manage books for the selected branch.'
        );
      }

      if (
        uploadMessage.includes('network') ||
        uploadMessage.includes('fetch') ||
        uploadMessage.includes('connection')
      ) {
        throw new Error(
          'Unable to connect to cover storage. Check your connection and try again.'
        );
      }

      throw new Error(
        'Unable to upload the book cover. Check the file and try again.'
      );
    }

    const { data } = supabase.storage
      .from('book-covers')
      .getPublicUrl(filePath);

    if (!data?.publicUrl) {
      throw new Error('Unable to create a public URL for the book cover.');
    }

    return data.publicUrl;
  };

  const [form, setForm] = useState({
    title: '',
    author: '',
    isbn: '',
    category: '',
    fine_rate: '',
    copies: 1,
    libraryId: '',
    coverUrl: '',
    summary: ''
  });

  const getLibraryDisplayName = (libId) => {
    if (!libId) return 'Personal Collection';

    const found = inventoryLibraries?.find(
      (library) => String(library.id) === String(libId)
    );

    return found ? found.name : 'Personal Collection';
  };

  const handleOpenAdd = () => {
    setEditingId(null);
    setSelectedCoverFile(null);
    setCoverPreview('');

    setForm({
      title: '',
      author: '',
      isbn: '',
      category: '',
      fine_rate: '',
      copies: 1,
      libraryId: inventoryLibraries?.[0]?.id || '',
      coverUrl: '',
      summary: ''
    });

    setMutationError('');
    setMutationNotice('');
    setShowForm(true);
  };

  const handleOpenEdit = (book) => {
    setEditingId(book.id);
    setSelectedCoverFile(null);
    setCoverPreview('');

    setForm({
      title: book.title || '',
      author: book.author || '',
      isbn: book.isbn || '',
      category: book.category || '',
      fine_rate: book.fineRate ?? book.fine_rate ?? '',
      copies: getBookCopies(book) || 1,
      libraryId: book.libraryId || '',
      coverUrl: book.coverUrl || '',
      summary: book.summary || '',
      updatedAt: book.updatedAt || ''
    });

    setMutationError('');
    setMutationNotice('');
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    setSaving(true);
    setMutationError('');
    setMutationNotice('');

    try {
      if (
        isSubAdmin &&
        (!assignedLibraryId || String(form.libraryId) !== assignedLibraryId)
      ) {
        throw new Error('You can only manage inventory for your assigned branch.');
      }

      const fineRate = normalizeBookFineRate(form.fine_rate);
      let coverUrl = form.coverUrl;

      if (selectedCoverFile) {
        coverUrl = await uploadBookCover(
          selectedCoverFile,
          form.libraryId
        );
      }

      const bookPayload = {
        ...form,
        fine_rate: fineRate,
        coverUrl,
        totalCopies: form.copies
      };

      let savedBook;

      if (editingId) {
        savedBook = await updateBook(editingId, bookPayload);
      } else {
        savedBook = await addBook(bookPayload);
      }

      setMutationNotice(
        savedBook?.fineRateMismatch
          ? `Copies were added, but the existing fine rate for "${savedBook.title}" was preserved at ₱${savedBook.fineRateMismatch.existingRate ?? 'unassigned'} per overdue day. The import supplied ₱${savedBook.fineRateMismatch.importedRate ?? 'unassigned'}.`
          : `Book "${savedBook?.title || form.title}" ${editingId ? 'updated' : 'added'} successfully.`
      );

      setSelectedCoverFile(null);
      setCoverPreview('');
      setShowForm(false);
    } catch (err) {
      console.error('Book inventory save failed:', err);

      const saveMessage = String(err?.message || '').toLowerCase();

      setMutationError(
        saveMessage.includes('row-level security') ||
        saveMessage.includes('permission denied') ||
        saveMessage.includes('not authorized')
          ? 'Book changes were denied. Verify that your account can manage inventory for the selected branch.'
          : err.message || 'Unable to save the book. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    const deletedBookTitle = inventoryBooks.find((book) => String(book.id) === String(id))?.title;
    setMutationNotice('');
    setMutationError('');
    try {
      await deleteBook(id);
      setMutationNotice(`Book "${deletedBookTitle || 'Book'}" deleted successfully.`);
    } catch (err) {
      setMutationError(err.message || 'Failed to delete book. Please try again.');
    }
  };

  const inventoryCategories = Array.from(
    new Map(
      inventoryBooks
        .map((book) => String(book.category || '').trim())
        .filter(Boolean)
        .map((category) => [category.toLocaleLowerCase(), category])
    ).values()
  ).sort((a, b) => formatBookCategory(a).localeCompare(formatBookCategory(b)));

  const filteredBooks = inventoryBooks
    .filter((book) => {
      const q = search.toLowerCase();
      const matchesSearch = (
        book.title?.toLowerCase().includes(q) ||
        book.author?.toLowerCase().includes(q) ||
        book.isbn?.toLowerCase().includes(q) ||
        book.category?.toLowerCase().includes(q)
      );
      const matchesCategory = categoryFilter === 'all' ||
        String(book.category || '').trim().toLocaleLowerCase() === categoryFilter;

      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => {
      if (sortBy === 'title-asc') {
        return (a.title || '').localeCompare(b.title || '');
      }

      if (sortBy === 'title-desc') {
        return (b.title || '').localeCompare(a.title || '');
      }

      if (sortBy === 'author-asc') {
        return (a.author || '').localeCompare(b.author || '');
      }

      if (sortBy === 'copies-desc') {
        return getBookCopies(b) - getBookCopies(a);
      }

      return 0;
    });
  const pageCount = Math.max(1, Math.ceil(filteredBooks.length / INVENTORY_PAGE_SIZE));
  const visiblePage = Math.min(page, pageCount);
  const visibleBooks = filteredBooks.slice(
    (visiblePage - 1) * INVENTORY_PAGE_SIZE,
    visiblePage * INVENTORY_PAGE_SIZE
  );

  useEffect(() => {
    if (page > pageCount) {
      // Keep the controlled pagination state inside the current result range.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPage(pageCount);
    }
  }, [page, pageCount]);

  if (loading) {
    return (
      <div className="p-4 text-slate-600">
        Loading book inventory...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">
            Book Inventory
          </h1>

          <p className="text-xs text-slate-500">
            Manage all books across system libraries
          </p>
        </div>

        <button
          onClick={handleOpenAdd}
          className="px-4 py-2 bg-shelf-primary hover:bg-[#003568] text-white rounded-lg text-sm font-semibold transition"
        >
          + Add new book
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-100 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {mutationNotice && (
        <div
          role="status"
          className={`p-3 rounded-lg text-sm ${mutationNotice.startsWith('Copies were added') ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}
        >
          {mutationNotice}
        </div>
      )}
      {mutationError && !showForm && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {mutationError}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-100">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />

          <input
            type="text"
            placeholder="Search by title, author, ISBN, category..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-9 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          />

          {search && (
            <button
              type="button"
              onClick={() => { setSearch(''); setPage(1); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full hover:bg-slate-100 transition"
              aria-label="Clear search input"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="w-full sm:w-48">
          <label htmlFor="book-inventory-category-filter" className="sr-only">Filter books by category</label>
          <select
            id="book-inventory-category-filter"
            value={categoryFilter}
            onChange={(event) => { setCategoryFilter(event.target.value); setPage(1); }}
            className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">All categories</option>
            {inventoryCategories.map((category) => (
              <option key={category.toLocaleLowerCase()} value={category.toLocaleLowerCase()}>
                {formatBookCategory(category)}
              </option>
            ))}
          </select>
        </div>

        <div className="w-full sm:w-48">
          <label htmlFor="book-inventory-sort" className="sr-only">Sort books</label>
          <select
            id="book-inventory-sort"
            value={sortBy}
            onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
            className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="title-asc">Title (A-Z)</option>
            <option value="title-desc">Title (Z-A)</option>
            <option value="author-asc">Author (A-Z)</option>
            <option value="copies-desc">Most Copies</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] table-fixed text-left text-sm text-slate-600 border-collapse">
            <colgroup>
              <col style={{ width: '32%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '19%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '11%' }} />
            </colgroup>
            <thead className="bg-slate-50/80 text-slate-700 font-bold uppercase text-xs border-b border-slate-100">
              <tr>
                <th className="p-4">Book</th>
                <th className="p-4">Category</th>
                <th className="p-4">Fine Rate</th>
                <th className="p-4">Library Location</th>
                <th className="p-4 text-center">Copies</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {filteredBooks.length === 0 ? (
                <tr>
                  <td
                    colSpan="6"
                    className="p-8 text-center text-slate-400 font-medium"
                  >
                    No books found.
                  </td>
                </tr>
              ) : (
            visibleBooks.map((book) => (
                  <tr
                    key={book.id}
                    className="group hover:bg-blue-50/60 hover:shadow-inner transition-all duration-150 cursor-pointer"
                  >
                    <td className="p-4 align-middle">
                      <div className="flex min-w-0 items-center gap-3.5">
                        {book.coverUrl ? (
                          <img
                            src={book.coverUrl}
                            alt={book.title}
                            className="w-11 h-16 object-cover rounded shadow-sm border border-slate-200/60 shrink-0"
                          />
                        ) : (
                          <div className="w-11 h-16 bg-slate-100 border border-slate-200/80 rounded flex items-center justify-center text-xs font-bold text-slate-400 shrink-0 uppercase tracking-tighter">
                            No Cover
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <div title={book.title} className="line-clamp-2 break-words font-bold text-sm text-slate-800 transition-colors group-hover:text-shelf-primary">
                            {book.title}
                          </div>

                          <div title={book.author || 'Unknown'} className="truncate text-xs font-medium text-slate-500">
                            By {book.author || 'Unknown'}
                          </div>

                          {book.isbn && (
                            <div className="mt-0.5 text-xs tabular-nums text-slate-400 wrap-anywhere">
                              ISBN: {book.isbn}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="p-4 align-middle text-sm font-semibold text-slate-700 break-words">
                      {formatBookCategory(book.category) || 'Unclassified'}
                    </td>

                    <td className="p-4 align-middle text-xs font-semibold text-slate-700 break-words">
                      {(book.fineRate ?? book.fine_rate) == null ? (
                        <div>Fine rate not set</div>
                      ) : (
                        <div className="mt-1 text-xs font-medium text-slate-500">
                          ₱{book.fineRate ?? book.fine_rate} per overdue day
                        </div>
                      )}
                    </td>

                    <td className="p-4 align-middle text-xs font-semibold text-slate-700 break-words">
                      {getLibraryDisplayName(book.libraryId)}
                    </td>

                    <td className="p-4 align-middle text-center">
                      <span className="inline-flex items-center justify-center font-extrabold text-slate-800 text-sm px-2.5 py-1 rounded-full bg-slate-100 group-hover:bg-blue-100 group-hover:text-blue-800 transition-colors">
                        {getBookCopies(book)}
                      </span>
                    </td>

                    <td className="p-4 align-middle">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          aria-label={`Edit ${book.title}`}
                          title="Edit book"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEdit(book);
                          }}
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700 transition hover:border-shelf-accent hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-accent/50"
                        >
                          <Pencil size={16} aria-hidden="true" />
                        </button>

                        <button
                          type="button"
                          aria-label={`Delete ${book.title}`}
                          title="Delete book"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(book.id);
                          }}
                          data-confirm-message={`Delete "${book.title || 'this book'}" from the inventory? This cannot be undone.`}
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 transition hover:border-red-300 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50"
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <footer className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <p aria-live="polite">
            Showing {filteredBooks.length === 0 ? 0 : (visiblePage - 1) * INVENTORY_PAGE_SIZE + 1}–{Math.min(visiblePage * INVENTORY_PAGE_SIZE, filteredBooks.length)} of {filteredBooks.length} books
          </p>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={visiblePage <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeft size={16} aria-hidden="true" /> Previous
            </button>
            <span className="whitespace-nowrap text-xs font-medium">Page {visiblePage} of {pageCount}</span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              disabled={visiblePage >= pageCount}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </footer>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="book-inventory-form-title"
            className="max-h-[calc(100dvh-2rem)] w-full max-w-lg space-y-4 overflow-y-auto overscroll-contain rounded-2xl bg-white p-6 shadow-xl"
          >
            <h2 id="book-inventory-form-title" className="text-lg font-bold text-slate-800">
              {editingId ? 'Edit Book' : 'Add New Book'}
            </h2>

            {mutationError && (
              <div className="p-3 bg-red-50 text-red-600 rounded-lg text-xs">
                {mutationError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3 text-xs">
              <div>
                <label htmlFor="book-title" className="block text-slate-700 font-semibold mb-1">
                  Title *
                  <span className="sr-only"> required</span>
                </label>

                <input
                  required
                  id="book-title"
                  type="text"
                  value={form.title}
                  onChange={(e) =>
                    setForm({ ...form, title: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="book-author" className="block text-slate-700 font-semibold mb-1">
                    Author
                  </label>

                  <input
                    type="text"
                    id="book-author"
                    value={form.author}
                    onChange={(e) =>
                      setForm({ ...form, author: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label htmlFor="book-isbn" className="block text-slate-700 font-semibold mb-1">
                    ISBN
                  </label>

                  <input
                    type="text"
                    id="book-isbn"
                    value={form.isbn}
                    onChange={(e) =>
                      setForm({ ...form, isbn: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="book-category" className="block text-slate-700 font-semibold mb-1">
                    Category *
                    <span className="sr-only"> required</span>
                  </label>

                  <input
                    required
                    id="book-category"
                    type="text"
                    placeholder="e.g. Fiction, History, Science"
                    value={form.category}
                    onChange={(e) =>
                      setForm({ ...form, category: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label htmlFor="book-copies" className="block text-slate-700 font-semibold mb-1">
                    Copies
                  </label>

                  <input
                    type="number"
                    id="book-copies"
                    min="1"
                    value={form.copies}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        copies: parseInt(e.target.value, 10) || 1
                      })
                    }
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="book-fine-rate" className="block text-slate-700 font-semibold mb-1">
                  Fine Rate (₱ per overdue day) *
                  <span className="sr-only"> required</span>
                </label>

                <input
                  required
                  id="book-fine-rate"
                  name="fine_rate"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  inputMode="numeric"
                  value={form.fine_rate}
                  onChange={(e) =>
                    setForm({ ...form, fine_rate: e.target.value })
                  }
                  aria-describedby="book-fine-rate-help"
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <p id="book-fine-rate-help" className="mt-1 text-slate-500">
                  Enter a whole number from ₱1 to ₱100.
                </p>
              </div>

              <div>
                <label htmlFor="book-library-location" className="block text-slate-700 font-semibold mb-1">
                  Library Location
                </label>

                <select
                  id="book-library-location"
                  value={form.libraryId}
                  onChange={(e) =>
                    setForm({ ...form, libraryId: e.target.value })
                  }
                  disabled={isSubAdmin}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {!isSubAdmin && (
                    <option value="">
                      Personal Collection / Main Branch
                    </option>
                  )}

                  {inventoryLibraries.map((lib) => (
                    <option key={lib.id} value={lib.id}>
                      {lib.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="book-cover-input" className="block text-slate-700 font-semibold mb-1">
                  Book Cover Image
                </label>

                <input
                  id="book-cover-input"
                  type="file"
                  accept="image/jpeg,image/png"
                  className="hidden"
                  onChange={(e) => {
                    handleCoverSelect(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingCover(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setIsDraggingCover(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDraggingCover(false);
                    handleCoverSelect(e.dataTransfer.files?.[0]);
                  }}
                  onClick={() =>
                    document.getElementById('book-cover-input')?.click()
                  }
                  className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition ${
                    isDraggingCover
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
                  }`}
                >
                  {coverPreview || form.coverUrl ? (
                    <div className="flex flex-col items-center gap-3">
                      <img
                        src={coverPreview || form.coverUrl}
                        alt="Book cover preview"
                        className="w-28 h-40 object-cover rounded-lg shadow-sm"
                      />

                      <p className="text-slate-600">
                        Click here or drag another image to replace the cover.
                      </p>
                    </div>
                  ) : (
                    <div className="py-3">
                      <BookOpen size={24} className="mb-2 text-slate-400" aria-hidden="true" />

                      <p className="font-semibold text-slate-700">
                        Drag and drop your book cover here
                      </p>

                      <p className="text-slate-500 mt-1">
                        or click to browse your files
                      </p>

                      <p className="text-slate-400 mt-2">
                        JPG or PNG · Maximum 5 MB
                      </p>
                    </div>
                  )}
                </div>

                {(coverPreview || form.coverUrl) && (
                  <button
                    type="button"
                    onClick={handleRemoveCover}
                    className="mt-2 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    Remove cover
                  </button>
                )}
              </div>

              <div>
                <label htmlFor="book-summary" className="block text-slate-700 font-semibold mb-1">
                  Summary
                </label>

                <textarea
                  id="book-summary"
                  rows="2"
                  value={form.summary}
                  onChange={(e) =>
                    setForm({ ...form, summary: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setMutationError('');
                  }}
                  className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50 font-medium"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-shelf-primary hover:bg-[#003568] text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {saving
                    ? 'Saving...'
                    : editingId
                      ? 'Save changes'
                      : 'Add book'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
