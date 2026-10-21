import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useLibrary } from '../context/useLibrary';
import { useAuth } from '../context/useAuth.js';
import { supabase } from '../lib/supabaseClient';

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

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('title-asc');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [selectedCoverFile, setSelectedCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState('');
  const [isDraggingCover, setIsDraggingCover] = useState(false);
  
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
      throw new Error('Cover uploads are unavailable because the storage service is not configured.');
    }

    if (!libraryId) {
      throw new Error('Select a library before uploading a book cover.');
    }

    const assignedBranch = user?.libraryId || user?.assignedBranch;
    if (
      user?.role === 'subadmin' &&
      String(assignedBranch || '') !== String(libraryId)
    ) {
      throw new Error('You can only upload covers for books assigned to your branch.');
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
        throw new Error('Cover upload was denied. Verify that your account can manage books for the selected branch.');
      }
      if (
        uploadMessage.includes('network') ||
        uploadMessage.includes('fetch') ||
        uploadMessage.includes('connection')
      ) {
        throw new Error('Unable to connect to cover storage. Check your connection and try again.');
      }
      throw new Error('Unable to upload the book cover. Check the file and try again.');
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
    copies: 1,
    libraryId: '',
    coverUrl: '',
    summary: ''
  });

  const getLibraryDisplayName = (libId) => {
    if (!libId) return 'Personal Collection'; 
    const found = libraries?.find((l) => String(l.id) === String(libId));
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
      copies: 1,
      libraryId: libraries?.[0]?.id || '',
      coverUrl: '',
      summary: ''
    });
    setMutationError('');
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
      copies: getBookCopies(book) || 1,
      libraryId: book.libraryId || '',
      coverUrl: book.coverUrl || '',
      summary: book.summary || ''
    });
    setMutationError('');
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMutationError('');

    try {
      let coverUrl = form.coverUrl;

      if (selectedCoverFile) {
        coverUrl = await uploadBookCover(selectedCoverFile, form.libraryId);
      }

      const bookPayload = {
        ...form,
        coverUrl,
        totalCopies: form.copies,
      };

      if (editingId) {
        await updateBook(editingId, bookPayload);
      } else {
        await addBook(bookPayload);
      }

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
    if (window.confirm('Are you sure you want to delete this book?')) {
      try {
        await deleteBook(id);
      } catch (err) {
        alert(err.message || 'Failed to delete book');
      }
    }
  };

  const filteredBooks = (books || [])
    .filter((b) => {
      const q = search.toLowerCase();
      return (
        b.title?.toLowerCase().includes(q) ||
        b.author?.toLowerCase().includes(q) ||
        b.isbn?.toLowerCase().includes(q) ||
        b.category?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortBy === 'title-asc') return (a.title || '').localeCompare(b.title || '');
      if (sortBy === 'title-desc') return (b.title || '').localeCompare(a.title || '');
      if (sortBy === 'author-asc') return (a.author || '').localeCompare(b.author || '');
      if (sortBy === 'copies-desc') return getBookCopies(b) - getBookCopies(a);
      return 0;
    });

  if (loading) {
    return <div className="p-4 text-slate-600">Loading book inventory...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Book Inventory</h1>
          <p className="text-xs text-slate-500">Manage all books across system libraries</p>
        </div>
        <button
          onClick={handleOpenAdd}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition"
        >
          + Add New Book
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-100 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-100">
        {/* SEARCH INPUT WITH CLEAR (X) BUTTON */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by title, author, ISBN, category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-9 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full hover:bg-slate-100 transition"
              aria-label="Clear search input"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="w-full sm:w-48">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
          <table className="w-full text-left text-sm text-slate-600 border-collapse">
            {/* TABLE HEADER */}
            <thead className="bg-slate-50/80 text-slate-700 font-bold uppercase text-xs border-b border-slate-100">
              <tr>
                <th className="p-4 w-5/12">Book</th>
                <th className="p-4 w-2/12">Category</th>
                <th className="p-4 w-3/12">Library Location</th>
                <th className="p-4 w-1/12 text-center">Copies</th>
                <th className="p-4 w-1/12 text-right">Actions</th>
              </tr>
            </thead>

            {/* TABLE BODY WITH FULL ROW HOVER */}
            <tbody className="divide-y divide-slate-100">
              {filteredBooks.length === 0 ? (
                <tr>
                  <td colSpan="5" className="p-8 text-center text-slate-400 font-medium">
                    No books found.
                  </td>
                </tr>
              ) : (
                filteredBooks.map((book) => (
                  <tr 
                    key={book.id} 
                    className="group hover:bg-indigo-50/50 hover:shadow-inner transition-all duration-150 cursor-pointer"
                  >
                    {/* BOOK COVER & TITLE */}
                    <td className="p-4 flex items-center gap-3.5">
                      {book.coverUrl ? (
                        <img
                          src={book.coverUrl}
                          alt={book.title}
                          className="w-11 h-16 object-cover rounded shadow-sm border border-slate-200/60 shrink-0"
                        />
                      ) : (
                        <div className="w-11 h-16 bg-slate-100 border border-slate-200/80 rounded flex items-center justify-center text-[10px] font-bold text-slate-400 shrink-0 uppercase tracking-tighter">
                          No Cover
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-bold text-slate-800 text-sm group-hover:text-indigo-900 transition-colors truncate">
                          {book.title}
                        </div>
                        <div className="text-xs text-slate-500 font-medium">
                          By {book.author || 'Unknown'}
                        </div>
                        {book.isbn && (
                          <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                            ISBN: {book.isbn}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* CATEGORY */}
                    <td className="p-4 align-middle">
                      <span className="inline-block px-2.5 py-1 bg-slate-100 text-slate-700 rounded-md text-xs font-semibold group-hover:bg-white group-hover:shadow-sm transition-all">
                        {book.category}
                      </span>
                    </td>

                    {/* LIBRARY LOCATION */}
                    <td className="p-4 align-middle text-xs font-semibold text-slate-700">
                      {getLibraryDisplayName(book.libraryId)}
                    </td>

                    {/* COPIES (Naka-center para tapat sa Header) */}
                    <td className="p-4 align-middle text-center">
                      <span className="inline-flex items-center justify-center font-extrabold text-slate-800 text-sm px-2.5 py-1 rounded-full bg-slate-100 group-hover:bg-indigo-100 group-hover:text-indigo-800 transition-colors">
                        {getBookCopies(book)}
                      </span>
                    </td>

                    {/* ACTIONS */}
                    <td className="p-4 align-middle text-right space-x-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenEdit(book);
                        }}
                        className="px-2.5 py-1 text-xs text-indigo-600 hover:bg-indigo-100 hover:text-indigo-800 rounded-md font-bold transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(book.id);
                        }}
                        className="px-2.5 py-1 text-xs text-red-600 hover:bg-red-100 hover:text-red-800 rounded-md font-bold transition-colors"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4">
            <h2 className="text-lg font-bold text-slate-800">
              {editingId ? 'Edit Book' : 'Add New Book'}
            </h2>

            {mutationError && (
              <div className="p-3 bg-red-50 text-red-600 rounded-lg text-xs">
                {mutationError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Title *</label>
                <input
                  required
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Author</label>
                  <input
                    type="text"
                    value={form.author}
                    onChange={(e) => setForm({ ...form, author: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">ISBN</label>
                  <input
                    type="text"
                    value={form.isbn}
                    onChange={(e) => setForm({ ...form, isbn: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Category *</label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. Fiction, History, Science"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Copies</label>
                  <input
                    type="number"
                    min="1"
                    value={form.copies}
                    onChange={(e) => setForm({ ...form, copies: parseInt(e.target.value) || 1 })}
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Library Location</label>
                <select
                  value={form.libraryId}
                  onChange={(e) => setForm({ ...form, libraryId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Personal Collection / Main Branch</option>
                  {(libraries || []).map((lib) => (
                    <option key={lib.id} value={lib.id}>
                      {lib.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
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
                  onClick={() => document.getElementById('book-cover-input')?.click()}
                  className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition ${
                    isDraggingCover
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50'
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
                      <p className="text-2xl mb-2">📚</p>
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
                <label className="block text-slate-700 font-semibold mb-1">Summary</label>
                <textarea
                  rows="2"
                  value={form.summary}
                  onChange={(e) => setForm({ ...form, summary: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setMutationError(''); }}
                  className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {saving ? 'Saving...' : (editingId ? 'Save Changes' : 'Add Book')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}