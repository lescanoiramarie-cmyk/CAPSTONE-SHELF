import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLibrary, useLibraryData } from '../context/LibraryContext';

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', { dateStyle: 'medium' });
}

const STATUS_STYLES = {
  queued: 'bg-slate-100 text-slate-600',
  ready_for_pickup: 'bg-amber-100 text-amber-700',
  borrowed: 'bg-blue-100 text-blue-700',
  returned: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
  expired: 'bg-red-100 text-red-700',
};

const STATUS_LABELS = {
  queued: 'In Queue',
  ready_for_pickup: 'Ready for Pickup',
  borrowed: 'Borrowed',
  returned: 'Returned',
  cancelled: 'Cancelled',
  expired: 'Expired (Not Picked Up)',
};

export default function OPACCatalog({ libraryFilter = null }) {
  const { user } = useAuth();
  const { books, borrowRequests, libraries } = useLibraryData();
  const { requestBorrow, cancelBorrowRequest, PICKUP_WINDOW_HOURS, BORROW_PERIOD_DAYS } = useLibrary();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedBook, setSelectedBook] = useState(null);
  const [activeTab, setActiveTab] = useState('catalog');
  const [notice, setNotice] = useState('');

  const categories = ['All', ...new Set(books.map((b) => b.category))];

  const filteredBooks = books.filter((book) => {
    const matchesSearch =
      book.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      book.author.toLowerCase().includes(searchTerm.toLowerCase()) ||
      book.isbn.includes(searchTerm);
    const matchesCategory = selectedCategory === 'All' || book.category === selectedCategory;
    const matchesLibrary = !libraryFilter || book.libraryId === libraryFilter;
    return matchesSearch && matchesCategory && matchesLibrary;
  });

  const myRequests = borrowRequests
    .filter((r) => r.visitorId === user?.id)
    .sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));

  const libraryName = (id) => libraries.find((l) => l.id === id)?.name || id;

  const handleBorrowOrReserve = (book) => {
    try {
      const req = requestBorrow(user.id, book.id);
      if (req.status === 'ready_for_pickup') {
        setNotice(
          `"${book.title}" is on hold for you! Visit ${libraryName(book.libraryId)} within ${PICKUP_WINDOW_HOURS} hours to scan your QR pass and pick it up, or the hold will be cancelled automatically.`
        );
      } else {
        setNotice(`"${book.title}" is currently unavailable — you are #${req.queuePosition} in the reservation queue. We'll notify you once it's ready.`);
      }
    } catch (err) {
      setNotice(err.message);
    }
    setSelectedBook(null);
    setActiveTab('myBorrows');
  };

  const handleCancel = (requestId) => {
    try {
      cancelBorrowRequest(requestId, 'cancelled');
      setNotice('Request cancelled.');
    } catch (err) {
      setNotice(err.message);
    }
  };

  return (
    <div className="space-y-6">
      {notice && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs px-4 py-3 rounded-lg flex justify-between items-start gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="font-bold text-blue-400 hover:text-blue-700">✕</button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 gap-4">
        <button
          onClick={() => setActiveTab('catalog')}
          className={`pb-3 text-sm font-bold transition ${
            activeTab === 'catalog' ? 'text-[#002046] border-b-2 border-[#002046]' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          📚 Search Catalog (OPAC)
        </button>
        <button
          onClick={() => setActiveTab('myBorrows')}
          className={`pb-3 text-sm font-bold transition flex items-center gap-2 ${
            activeTab === 'myBorrows' ? 'text-[#002046] border-b-2 border-[#002046]' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          🔖 My Requests & Borrows
          {myRequests.filter((r) => ['queued', 'ready_for_pickup', 'borrowed'].includes(r.status)).length > 0 && (
            <span className="bg-[#002046] text-white text-xs px-2 py-0.5 rounded-full">
              {myRequests.filter((r) => ['queued', 'ready_for_pickup', 'borrowed'].includes(r.status)).length}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'catalog' ? (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Search by Title, Author, or ISBN…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
            />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {books.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500">
              No books in the catalog yet. Please check back soon — the library team is still populating the collection.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredBooks.map((book) => (
                <div
                  key={book.id}
                  className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition flex flex-col justify-between"
                >
                  <div className="p-4 flex gap-4">
                    <img src={book.coverUrl} alt={book.title} className="w-24 h-32 object-cover rounded-md border border-slate-200" />
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                        {book.category}
                      </span>
                      <h3 className="font-bold text-slate-800 text-sm line-clamp-2">{book.title}</h3>
                      <p className="text-xs text-slate-500">{book.author}</p>
                      <p className="text-xs text-slate-400 font-mono">ISBN: {book.isbn}</p>
                      <p className="text-[11px] text-slate-500">{libraryName(book.libraryId)}</p>
                      <div className="pt-2">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                            book.availableCopies > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {book.availableCopies > 0 ? `${book.availableCopies} Copies Available` : 'Join Reservation Queue'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">{book.shelfLocation}</span>
                    <button
                      onClick={() => setSelectedBook(book)}
                      className="bg-[#002046] text-white text-xs px-3 py-1.5 rounded-lg font-bold hover:opacity-90 transition"
                    >
                      View Info & Request
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
          {myRequests.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">You have no borrow requests yet. Browse the catalog to get started.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs uppercase tracking-wider">
                <tr>
                  <th className="p-4">Book Title</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Details</th>
                  <th className="p-4">Fine (PHP)</th>
                  <th className="p-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {myRequests.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="p-4 font-bold text-slate-800">{r.bookTitle}</td>
                    <td className="p-4">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${STATUS_STYLES[r.status] || ''}`}>
                        {STATUS_LABELS[r.status] || r.status}
                      </span>
                    </td>
                    <td className="p-4 text-xs text-slate-500 space-y-0.5">
                      {r.status === 'queued' && <p>Queue position: #{r.queuePosition}</p>}
                      {r.status === 'ready_for_pickup' && <p>Pick up by: {formatDateTime(r.pickupDeadline)}</p>}
                      {r.status === 'borrowed' && <p>Due: {formatDate(r.dueDate)}</p>}
                      {r.status === 'returned' && <p>Returned: {formatDate(r.returnDate)}</p>}
                    </td>
                    <td className="p-4 font-mono font-bold text-xs text-red-600">
                      {r.fineAmount > 0 ? `₱${r.fineAmount}.00` : '₱0.00'}
                    </td>
                    <td className="p-4 text-right">
                      {['queued', 'ready_for_pickup'].includes(r.status) && (
                        <button
                          onClick={() => handleCancel(r.id)}
                          className="bg-red-50 text-red-600 text-xs px-3 py-1.5 rounded-lg font-bold hover:bg-red-100 transition"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {selectedBook && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 border border-slate-200 shadow-2xl relative">
            <button
              onClick={() => setSelectedBook(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 font-bold"
            >
              ✕
            </button>

            <div className="flex gap-4">
              <img src={selectedBook.coverUrl} alt={selectedBook.title} className="w-28 h-36 object-cover rounded-lg border border-slate-200" />
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                  {selectedBook.category}
                </span>
                <h3 className="text-lg font-bold text-slate-800">{selectedBook.title}</h3>
                <p className="text-xs text-slate-500">By {selectedBook.author}</p>
                <p className="text-xs text-slate-400 font-mono">ISBN: {selectedBook.isbn}</p>
                <p className="text-xs font-semibold text-[#002046] pt-1">{libraryName(selectedBook.libraryId)} — {selectedBook.shelfLocation}</p>
              </div>
            </div>

            <div className="space-y-1 bg-slate-50 p-3 rounded-lg border border-slate-100">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Book Summary</h4>
              <p className="text-xs text-slate-600 leading-relaxed">{selectedBook.summary || 'No summary provided yet.'}</p>
            </div>

            <p className="text-[11px] text-slate-400">
              Borrowed items are due {BORROW_PERIOD_DAYS} days after pickup. Holds must be picked up within {PICKUP_WINDOW_HOURS} hours or they're released automatically.
            </p>

            <div className="flex items-center justify-between pt-2">
              <div className="text-xs">
                <span className="text-slate-500">Available: </span>
                <span className="font-bold text-slate-800">
                  {selectedBook.availableCopies} / {selectedBook.totalCopies}
                </span>
              </div>

              <button
                onClick={() => handleBorrowOrReserve(selectedBook)}
                className="bg-[#002046] text-white px-5 py-2 rounded-lg text-xs font-bold hover:opacity-95 transition shadow-sm"
              >
                {selectedBook.availableCopies > 0 ? 'Confirm Borrow Request' : 'Reserve Book (Join Queue)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
