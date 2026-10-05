import { useState } from 'react';
import { BookOpen, MapPin, Plus, SearchX } from 'lucide-react';
import { useLibraryData, useLibrary } from '../context/useLibrary.js';
import { useAuth } from '../context/useAuth.js';

const emptyForm = {
  title: '',
  author: '',
  category: '',
  isbn: '',
  shelfLocation: '',
  libraryId: '',
  totalCopies: 1,
  summary: '',
  coverUrl: '',
};

export default function BookInventory() {
  const { books, libraries } = useLibraryData();
  const { addBook, updateBook, deleteBook, loadSampleCatalog } = useLibrary();
  const { user } = useAuth();

  // Determine if user is a restricted sub-admin
  const isSubAdmin = user?.role === 'subadmin';
  const subAdminLibraryId = user?.libraryId || user?.assignedBranch || (isSubAdmin ? '' : libraries[0]?.id || '');

  const [form, setForm] = useState({ 
    ...emptyForm, 
    libraryId: isSubAdmin ? subAdminLibraryId : (libraries[0]?.id || '') 
  });
  const [editingId, setEditingId] = useState(null);
  const [editingUpdatedAt, setEditingUpdatedAt] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [search, setSearch] = useState('');
  const [loadingApiBooks, setLoadingApiBooks] = useState(false);
  const [apiBooksError, setApiBooksError] = useState('');

  // If sub-admin, restrict book list strictly to their libraryId
  const scopedBooks = isSubAdmin 
    ? books.filter((b) => b.libraryId === subAdminLibraryId) 
    : books;

  const filtered = scopedBooks.filter(
    (b) =>
      b.title.toLowerCase().includes(search.toLowerCase()) ||
      b.author.toLowerCase().includes(search.toLowerCase()) ||
      b.isbn.includes(search)
  );

  const startAdd = () => {
    setEditingId(null);
    setEditingUpdatedAt(null);
    setMutationError('');
    setForm({ 
      ...emptyForm, 
      libraryId: isSubAdmin ? subAdminLibraryId : (libraries[0]?.id || '') 
    });
    setShowForm(true);
  };

  const startEdit = (book) => {
    setEditingId(book.id);
    setEditingUpdatedAt(book.updatedAt);
    setMutationError('');
    setForm({
      title: book.title,
      author: book.author,
      category: book.category,
      isbn: book.isbn,
      shelfLocation: book.shelfLocation,
      libraryId: book.libraryId,
      totalCopies: book.totalCopies,
      summary: book.summary,
      coverUrl: book.coverUrl,
    });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMutationError('');
    setSaving(true);
    // Force sub-admin to always save under their own assigned library
    const finalLibraryId = isSubAdmin ? subAdminLibraryId : form.libraryId;

    try {
      if (editingId) {
        await updateBook(editingId, {
          ...form,
          libraryId: finalLibraryId,
          totalCopies: Number(form.totalCopies),
          updatedAt: editingUpdatedAt,
        });
      } else {
        await addBook({
          ...form,
          libraryId: finalLibraryId,
        });
      }
      setShowForm(false);
      setEditingId(null);
      setEditingUpdatedAt(null);
    } catch (error) {
      const message = error?.message || 'Unable to save the book.';
      setMutationError(
        message.includes('INVENTORY_CONFLICT')
          ? 'This book or its copy count changed while you were editing. Reload the inventory and review the latest available copies before saving.'
          : message
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (book) => {
    if (window.confirm(`Remove "${book.title}" from the catalog? This cannot be undone.`)) {
      deleteBook(book.id);
    }
  };

  const handleLoadApiBooks = async () => {
    setLoadingApiBooks(true);
    setApiBooksError('');

    try {
      await loadSampleCatalog(subAdminLibraryId);
    } catch (error) {
      setApiBooksError(error.message || 'Failed to load books from Open Library.');
    } finally {
      setLoadingApiBooks(false);
    }
  };

  const currentLibraryName = libraries.find((l) => l.id === subAdminLibraryId)?.name || 'Your Branch';

  return (
    <div className="space-y-4">
      {isSubAdmin && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs px-4 py-2.5 rounded-lg flex items-center justify-between">
          <span className="flex items-center gap-2"><MapPin size={15} aria-hidden="true" /> Managing inventory exclusively for: <b>{currentLibraryName}</b></span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 justify-between">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search inventory…"
          className="flex-1 max-w-sm px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
        />
        <div className="flex gap-2">
          {isSubAdmin && (
            <button
              type="button"
              onClick={handleLoadApiBooks}
              disabled={loadingApiBooks || !subAdminLibraryId}
              className="text-xs font-bold px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
            >
              {loadingApiBooks ? 'Loading API Books...' : 'Load 100+ API Books'}
            </button>
          )}
          <button
            onClick={startAdd}
            className="text-xs font-bold px-4 py-2.5 rounded-lg bg-[#002046] text-white hover:opacity-90 transition"
          >
            <Plus size={15} className="mr-1 inline-block align-[-3px]" aria-hidden="true" /> Add Book
          </button>
        </div>
      </div>

      {apiBooksError && (
        <p role="alert" className="text-xs text-red-600">
          {apiBooksError}
        </p>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="px-5 py-12 text-center">
            {search ? <SearchX size={30} className="mx-auto text-slate-400" aria-hidden="true" /> : <BookOpen size={30} className="mx-auto text-amber-700" aria-hidden="true" />}
            <h3 className="mt-3 text-base font-bold text-slate-800">
              {search ? 'No titles match that search.' : 'Your shelves are ready for their first titles.'}
            </h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              {search ? 'Try another title, author, or ISBN.' : isSubAdmin ? `Start building the collection at ${currentLibraryName}.` : 'Add a book to begin building the catalog.'}
            </p>
            {search ? (
              <button type="button" onClick={() => setSearch('')} className="mt-4 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-amber-400">Clear search</button>
            ) : (
              <button type="button" onClick={startAdd} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-amber-400"><Plus size={16} aria-hidden="true" /> Add a book</button>
            )}
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="p-3">Title</th>
                <th className="p-3">Author</th>
                <th className="p-3">Category</th>
                {!isSubAdmin && <th className="p-3">Library</th>}
                <th className="p-3">Copies</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="p-3 font-bold text-slate-800">{b.title}</td>
                  <td className="p-3 text-xs text-slate-500">{b.author}</td>
                  <td className="p-3 text-xs text-slate-500">{b.category}</td>
                  {!isSubAdmin && (
                    <td className="p-3 text-xs text-slate-500">
                      {libraries.find((l) => l.id === b.libraryId)?.name || b.libraryId}
                    </td>
                  )}
                  <td className="p-3 text-xs font-mono">{b.availableCopies}/{b.totalCopies}</td>
                  <td className="p-3 text-right space-x-2">
                    <button onClick={() => startEdit(b)} className="text-xs font-bold text-[#002046] hover:underline">
                      Edit
                    </button>
                    <button onClick={() => handleDelete(b)} className="text-xs font-bold text-red-600 hover:underline">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-3 border border-slate-200 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <h3 className="text-sm font-bold text-slate-800">{editingId ? 'Edit Book' : 'Add New Book'}</h3>
            {mutationError && (
              <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {mutationError}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Title</label>
              <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Author</label>
                <input required value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                <input required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">ISBN</label>
                <input required value={form.isbn} onChange={(e) => setForm({ ...form, isbn: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Shelf Location</label>
                <input required value={form.shelfLocation} onChange={(e) => setForm({ ...form, shelfLocation: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Library Branch</label>
                {isSubAdmin ? (
                  // Locked display for sub-admins so they can't change branch
                  <input 
                    disabled 
                    value={currentLibraryName} 
                    className="w-full px-3 py-2 border border-slate-200 bg-slate-100 rounded-lg text-sm text-slate-600 cursor-not-allowed" 
                  />
                ) : (
                  // Super admin can choose any branch
                  <select 
                    required 
                    value={form.libraryId} 
                    onChange={(e) => setForm({ ...form, libraryId: e.target.value })} 
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                  >
                    {libraries.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Total Copies</label>
                <input required type="number" min="1" value={form.totalCopies} onChange={(e) => setForm({ ...form, totalCopies: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Cover Image URL (optional)</label>
              <input value={form.coverUrl} onChange={(e) => setForm({ ...form, coverUrl: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Summary</label>
              <textarea rows="2" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"></textarea>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setShowForm(false); setMutationError(''); }} disabled={saving} className="text-xs font-bold px-4 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="text-xs font-bold px-4 py-2 rounded-lg bg-[#002046] text-white hover:opacity-90 disabled:opacity-50">
                {saving ? 'Saving…' : (editingId ? 'Save Changes' : 'Add Book')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
