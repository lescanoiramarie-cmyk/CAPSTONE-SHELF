import React, { useState } from 'react';
import { useLibrary } from '../context/useLibrary';

export default function BookInventory() {
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

  // Alternative term para sa personal/unassigned books
  const getLibraryDisplayName = (libId) => {
    if (!libId) return 'Personal Collection'; 
    const found = libraries?.find((l) => String(l.id) === String(libId));
    return found ? found.name : 'Personal Collection';
  };

  const handleOpenAdd = () => {
    setEditingId(null);
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
    setForm({
      title: book.title || '',
      author: book.author || '',
      isbn: book.isbn || '',
      category: book.category || '',
      copies: book.copies || 1,
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
      if (editingId) {
        await updateBook(editingId, form);
      } else {
        await addBook(form);
      }
      setShowForm(false);
    } catch (err) {
      setMutationError(err.message || 'Failed to save book');
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
      if (sortBy === 'copies-desc') return (b.copies || 0) - (a.copies || 0);
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
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search by title, author, ISBN, category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
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
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-slate-700 font-semibold uppercase text-xs">
              <tr>
                <th className="p-4">Book</th>
                <th className="p-4">Category</th>
                <th className="p-4">Library Location</th>
                <th className="p-4">Copies</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBooks.length === 0 ? (
                <tr>
                  <td colSpan="5" className="p-6 text-center text-slate-400">
                    No books found.
                  </td>
                </tr>
              ) : (
                filteredBooks.map((book) => (
                  <tr key={book.id} className="hover:bg-slate-50/50 transition">
                    <td className="p-4 flex items-center gap-3">
                      {book.coverUrl ? (
                        <img
                          src={book.coverUrl}
                          alt={book.title}
                          className="w-10 h-14 object-cover rounded"
                        />
                      ) : (
                        <div className="w-10 h-14 bg-slate-200 rounded flex items-center justify-center text-xs text-slate-400">
                          No Cover
                        </div>
                      )}
                      <div>
                        <div className="font-semibold text-slate-800">{book.title}</div>
                        <div className="text-xs text-slate-400">By {book.author || 'Unknown'}</div>
                        {book.isbn && <div className="text-[10px] text-slate-400">ISBN: {book.isbn}</div>}
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs font-medium">
                        {book.category}
                      </span>
                    </td>
                    <td className="p-4 text-xs font-medium text-slate-700">
                      {getLibraryDisplayName(book.libraryId)}
                    </td>
                    <td className="p-4 font-semibold text-slate-700">{book.copies || 0}</td>
                    <td className="p-4 text-right space-x-2">
                      <button
                        onClick={() => handleOpenEdit(book)}
                        className="px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(book.id)}
                        className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded font-medium"
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
                <label className="block text-slate-700 font-semibold mb-1">Cover Image URL</label>
                <input
                  type="text"
                  value={form.coverUrl}
                  onChange={(e) => setForm({ ...form, coverUrl: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
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