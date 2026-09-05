import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLibrary, useLibraryData } from '../context/LibraryContext.jsx';
import LibraryMap from './LibraryMap.jsx';
import { supabase } from '../lib/supabaseClient.js';

function formatDateTime(iso) {
  if (!iso) return '—';

  return new Date(iso).toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatDate(iso) {
  if (!iso) return '—';

  return new Date(iso).toLocaleDateString('en-PH', {
    dateStyle: 'medium',
  });
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

  const {
    books,
    borrowRequests,
    libraries,
  } = useLibraryData();

  const {
    requestBorrow,
    cancelBorrowRequest,
    PICKUP_WINDOW_HOURS,
    BORROW_PERIOD_DAYS,
  } = useLibrary();

  // =========================================================
  // FILTER STATES
  // =========================================================

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedLibrary, setSelectedLibrary] = useState('All');
  const [selectedAvailability, setSelectedAvailability] = useState('All');

  // =========================================================
  // UI STATES
  // =========================================================

  const [selectedBook, setSelectedBook] = useState(null);
  const [activeTab, setActiveTab] = useState('catalog');
  const [notice, setNotice] = useState('');

  // Current map library
  const [mapLibrary, setMapLibrary] = useState(null);

  // =========================================================
  // IMPORTANT:
  // Stores the last book opened before going to the map.
  // This allows "Close Map" to return to that same book modal.
  // =========================================================

  const [mapReturnBook, setMapReturnBook] = useState(null);

  // =========================================================
  // REVIEWS & RATINGS
  // =========================================================

  const [reviews, setReviews] = useState([]);
  const [userRating, setUserRating] = useState(5);
  const [userComment, setUserComment] = useState('');
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // =========================================================
  // DYNAMIC FILTER LISTS
  // =========================================================

  const categories = [
    'All',
    ...new Set(
      books
        .map((b) => b.category)
        .filter(Boolean)
    ),
  ];

  const libraryOptions = [
    'All',
    ...new Set(
      books
        .map((b) => b.libraryId)
        .filter(Boolean)
    ),
  ];

  const libraryName = (id) =>
    libraries.find((l) => l.id === id)?.name || id;

  // =========================================================
  // FETCH REVIEWS WHEN BOOK MODAL OPENS
  // =========================================================

  useEffect(() => {
    if (!selectedBook) return;

    const fetchReviews = async () => {
      setLoadingReviews(true);

      const { data, error } = await supabase
        .from('book_reviews')
        .select('*')
        .eq('book_id', String(selectedBook.id))
        .order('created_at', {
          ascending: false,
        });

      if (error) {
        console.error(
          'Error fetching reviews:',
          error.message
        );
      } else {
        setReviews(data || []);
      }

      setLoadingReviews(false);
    };

    fetchReviews();
  }, [selectedBook]);

  // =========================================================
  // SUBMIT REVIEW
  // =========================================================

  const handleSubmitReview = async (e) => {
    e.preventDefault();

    if (!userComment.trim() || !selectedBook) {
      return;
    }

    setIsSubmitting(true);

    const newReview = {
      book_id: String(selectedBook.id),
      visitor_id: user?.id
        ? String(user.id)
        : null,
      visitor_name:
        user?.full_name ||
        user?.name ||
        user?.email ||
        'Anonymous Visitor',
      rating: Number(userRating),
      comment: userComment.trim(),
    };

    const { data, error } = await supabase
      .from('book_reviews')
      .insert([newReview])
      .select();

    setIsSubmitting(false);

    if (error) {
      setNotice(
        'Bigo sa pag-save ng review: ' +
          error.message
      );
    } else if (data && data.length > 0) {
      setReviews([
        data[0],
        ...reviews,
      ]);

      setUserComment('');
      setUserRating(5);

      setNotice(
        'Salamat sa iyong rating at review!'
      );
    }
  };

  // =========================================================
  // SEARCH & FILTER
  // =========================================================

  const filteredBooks = books.filter((book) => {
    const title =
      book.title?.toLowerCase() || '';

    const author =
      book.author?.toLowerCase() || '';

    const isbn =
      book.isbn?.toString() || '';

    const search =
      searchTerm.toLowerCase();

    const matchesSearch =
      title.includes(search) ||
      author.includes(search) ||
      isbn.includes(search);

    const matchesCategory =
      selectedCategory === 'All' ||
      book.category === selectedCategory;

    const matchesLibrary =
      libraryFilter
        ? book.libraryId === libraryFilter
        : selectedLibrary === 'All' ||
          book.libraryId === selectedLibrary;

    const isAvailable =
      Number(book.availableCopies) > 0;

    const matchesAvailability =
      selectedAvailability === 'All' ||
      (
        selectedAvailability === 'Available' &&
        isAvailable
      ) ||
      (
        selectedAvailability === 'Unavailable' &&
        !isAvailable
      );

    return (
      matchesSearch &&
      matchesCategory &&
      matchesLibrary &&
      matchesAvailability
    );
  });

  // =========================================================
  // MY REQUESTS
  // =========================================================

  const myRequests = borrowRequests
    .filter(
      (r) => r.visitorId === user?.id
    )
    .sort(
      (a, b) =>
        new Date(b.requestDate) -
        new Date(a.requestDate)
    );

  // =========================================================
  // BORROW / RESERVE
  // =========================================================

  const handleBorrowOrReserve = (bookEntry) => {
    try {
      const req = requestBorrow(
        user.id,
        bookEntry.id
      );

      if (
        req.status === 'ready_for_pickup'
      ) {
        setNotice(
          `"${bookEntry.title}" is on hold for you at ${libraryName(
            bookEntry.libraryId
          )}! Visit within ${PICKUP_WINDOW_HOURS} hours to scan your QR pass.`
        );
      } else {
        setNotice(
          `"${bookEntry.title}" is currently unavailable at this branch — you are #${req.queuePosition} in the reservation queue.`
        );
      }
    } catch (err) {
      setNotice(err.message);
    }

    setSelectedBook(null);
    setActiveTab('myBorrows');
  };

  // =========================================================
  // CANCEL REQUEST
  // =========================================================

  const handleCancel = (requestId) => {
    try {
      cancelBorrowRequest(
        requestId,
        'cancelled'
      );

      setNotice('Request cancelled.');
    } catch (err) {
      setNotice(err.message);
    }
  };

  // =========================================================
  // VIEW MAP
  //
  // IMPORTANT:
  // 1. Save current book into mapReturnBook.
  // 2. Set the selected library for the map.
  // 3. Close the book modal.
  // 4. Scroll to the map.
  //
  // This prevents the modal from appearing over the map.
  // =========================================================

  const handleViewMap = (libraryId) => {
    const lib = libraries.find(
      (l) => l.id === libraryId
    );

    if (!lib) {
      setNotice(
        'Library location could not be found.'
      );
      return;
    }

    if (
      lib.lat === null ||
      lib.lat === undefined ||
      lib.lng === null ||
      lib.lng === undefined
    ) {
      setNotice(
        'GPS coordinates are not available for this library yet.'
      );
      return;
    }

    // Save the currently viewed book.
    if (selectedBook) {
      setMapReturnBook(selectedBook);
    }

    // Show map.
    setMapLibrary(lib);

    // Close the Book Info modal.
    setSelectedBook(null);

    // Go to the top so the map is immediately visible.
    globalThis.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };

  // =========================================================
  // CLOSE MAP
  //
  // IMPORTANT:
  // When closing the map, restore the exact book that was
  // previously opened.
  // =========================================================

  const handleCloseMap = () => {
    setMapLibrary(null);

    if (mapReturnBook) {
      setSelectedBook(mapReturnBook);
    }

    setMapReturnBook(null);
  };

  // =========================================================
  // PARTNER LIBRARY ENTRIES
  // =========================================================

  const getPartnerLibraryEntries = (book) => {
    if (!book) return [];

    return books.filter(
      (b) =>
        b.title === book.title ||
        (
          book.isbn &&
          b.isbn === book.isbn
        )
    );
  };

  // =========================================================
  // RENDER
  // =========================================================

  return (
    <div className="space-y-6">

      {/* =====================================================
          NOTICE
         ===================================================== */}

      {notice && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs px-4 py-3 rounded-lg flex justify-between items-start gap-3">
          <span>{notice}</span>

          <button
            type="button"
            onClick={() => setNotice('')}
            className="font-bold text-blue-400 hover:text-blue-700"
          >
            ✕
          </button>
        </div>
      )}

      {/* =====================================================
          NAVIGATION TABS
         ===================================================== */}

      <div className="flex border-b border-slate-200 gap-4">

        <button
          type="button"
          onClick={() =>
            setActiveTab('catalog')
          }
          className={`pb-3 text-sm font-bold transition ${
            activeTab === 'catalog'
              ? 'text-[#002046] border-b-2 border-[#002046]'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          📚 Search Catalog (OPAC)
        </button>

        <button
          type="button"
          onClick={() =>
            setActiveTab('myBorrows')
          }
          className={`pb-3 text-sm font-bold transition flex items-center gap-2 ${
            activeTab === 'myBorrows'
              ? 'text-[#002046] border-b-2 border-[#002046]'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          🔖 My Requests & Borrows

          {myRequests.filter(
            (r) =>
              [
                'queued',
                'ready_for_pickup',
                'borrowed',
              ].includes(r.status)
          ).length > 0 && (
            <span className="bg-[#002046] text-white text-xs px-2 py-0.5 rounded-full">
              {
                myRequests.filter(
                  (r) =>
                    [
                      'queued',
                      'ready_for_pickup',
                      'borrowed',
                    ].includes(r.status)
                ).length
              }
            </span>
          )}
        </button>

      </div>

      {/* =====================================================
          CATALOG
         ===================================================== */}

      {activeTab === 'catalog' ? (
        <div className="space-y-6">

          {/* =================================================
              MAP DISPLAY
             ================================================= */}

          {mapLibrary && (
            <div
              className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm relative"
              id="library-map-section"
            >
              <div className="flex justify-between items-center mb-4">

                <div>
                  <h2 className="text-lg font-bold text-slate-800">
                    {mapLibrary.name}
                  </h2>

                  <p className="text-xs text-slate-500">
                    {mapLibrary.address ||
                      'Location Map'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleCloseMap}
                  className="px-3 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 text-xs font-bold"
                >
                  Close Map
                </button>

              </div>

              <LibraryMap
                lat={mapLibrary.lat}
                lng={mapLibrary.lng}
                name={mapLibrary.name}
              />
            </div>
          )}

          {/* =================================================
              SEARCH & FILTERS
             ================================================= */}

          <div className="flex flex-col md:flex-row gap-3 flex-wrap">

            <input
              type="text"
              placeholder="Search by Title, Author, or ISBN…"
              value={searchTerm}
              onChange={(e) =>
                setSearchTerm(e.target.value)
              }
              className="flex-1 min-w-[200px] px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
            />

            {!libraryFilter && (
              <select
                value={selectedLibrary}
                onChange={(e) =>
                  setSelectedLibrary(
                    e.target.value
                  )
                }
                className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none"
              >
                <option value="All">
                  All Libraries
                </option>

                {libraryOptions
                  .filter(
                    (lib) => lib !== 'All'
                  )
                  .map((libId) => (
                    <option
                      key={libId}
                      value={libId}
                    >
                      {libraryName(libId)}
                    </option>
                  ))}
              </select>
            )}

            <select
              value={selectedCategory}
              onChange={(e) =>
                setSelectedCategory(
                  e.target.value
                )
              }
              className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none"
            >
              <option value="All">
                All Categories
              </option>

              {categories
                .filter(
                  (c) => c !== 'All'
                )
                .map((c) => (
                  <option
                    key={c}
                    value={c}
                  >
                    {c}
                  </option>
                ))}
            </select>

            <select
              value={selectedAvailability}
              onChange={(e) =>
                setSelectedAvailability(
                  e.target.value
                )
              }
              className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none"
            >
              <option value="All">
                All Statuses
              </option>

              <option value="Available">
                Available Only
              </option>

              <option value="Unavailable">
                Unavailable Only
              </option>
            </select>

          </div>

          {/* =================================================
              BOOK RESULTS
             ================================================= */}

          {books.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500">
              No books in the catalog yet.
              Please check back soon — the
              library team is still populating
              the collection.
            </div>
          ) : filteredBooks.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500">
              No books matched your search or
              filter criteria.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

              {filteredBooks.map((book) => (
                <div
                  key={book.id}
                  className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition flex flex-col justify-between"
                >

                  <div className="p-4 flex gap-4">

                    <img
                      src={book.coverUrl}
                      alt={book.title}
                      className="w-24 h-32 object-cover rounded-md border border-slate-200 bg-slate-50"
                    />

                    <div className="space-y-1">

                      <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                        {book.category}
                      </span>

                      <h3 className="font-bold text-slate-800 text-sm line-clamp-2">
                        {book.title}
                      </h3>

                      <p className="text-xs text-slate-500">
                        {book.author}
                      </p>

                      <p className="text-xs text-slate-400 font-mono">
                        ISBN: {book.isbn}
                      </p>

                      <div className="pt-2">

                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                            book.availableCopies > 0
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {book.availableCopies > 0
                            ? `${book.availableCopies} Copies Available`
                            : 'Unavailable'}
                        </span>

                      </div>

                    </div>

                  </div>

                  <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">

                    <button
                      type="button"
                      onClick={() =>
                        setSelectedBook(book)
                      }
                      className="bg-[#002046] text-white text-xs px-4 py-2 rounded-lg font-bold hover:opacity-90 transition"
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

        /* =====================================================
           MY REQUESTS
           ===================================================== */

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">

          {myRequests.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              You have no borrow requests yet.
              Browse the catalog to get started.
            </p>
          ) : (

            <table className="w-full text-left text-sm">

              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs uppercase tracking-wider">

                <tr>
                  <th className="p-4">
                    Book Title
                  </th>

                  <th className="p-4">
                    Status
                  </th>

                  <th className="p-4">
                    Details
                  </th>

                  <th className="p-4">
                    Fine (PHP)
                  </th>

                  <th className="p-4 text-right">
                    Action
                  </th>
                </tr>

              </thead>

              <tbody className="divide-y divide-slate-100 text-slate-700">

                {myRequests.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-slate-50"
                  >

                    <td className="p-4 font-bold text-slate-800">
                      {r.bookTitle}
                    </td>

                    <td className="p-4">

                      <span
                        className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                          STATUS_STYLES[r.status] ||
                          ''
                        }`}
                      >
                        {STATUS_LABELS[r.status] ||
                          r.status}
                      </span>

                    </td>

                    <td className="p-4 text-xs text-slate-500 space-y-0.5">

                      {r.status === 'queued' && (
                        <p>
                          Queue position: #
                          {r.queuePosition}
                        </p>
                      )}

                      {r.status ===
                        'ready_for_pickup' && (
                        <p>
                          Pick up by:{' '}
                          {formatDateTime(
                            r.pickupDeadline
                          )}
                        </p>
                      )}

                      {r.status === 'borrowed' && (
                        <p>
                          Due:{' '}
                          {formatDate(
                            r.dueDate
                          )}
                        </p>
                      )}

                      {r.status === 'returned' && (
                        <p>
                          Returned:{' '}
                          {formatDate(
                            r.returnDate
                          )}
                        </p>
                      )}

                    </td>

                    <td className="p-4 font-mono font-bold text-xs text-red-600">
                      {r.fineAmount > 0
                        ? `₱${r.fineAmount}.00`
                        : '₱0.00'}
                    </td>

                    <td className="p-4 text-right">

                      {[
                        'queued',
                        'ready_for_pickup',
                      ].includes(r.status) && (
                        <button
                          type="button"
                          onClick={() =>
                            handleCancel(r.id)
                          }
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

      {/* =====================================================
          VIEW INFO & REQUEST MODAL
         ===================================================== */}

      {selectedBook && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">

          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-5 border border-slate-200 shadow-2xl relative max-h-[90vh] overflow-y-auto">

            {/* CLOSE MODAL */}

            <button
              type="button"
              onClick={() =>
                setSelectedBook(null)
              }
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 font-bold"
            >
              ✕
            </button>

            {/* BOOK HEADER */}

            <div className="flex gap-4">

              <img
                src={selectedBook.coverUrl}
                alt={selectedBook.title}
                className="w-24 h-32 object-cover rounded-lg border border-slate-200 bg-slate-50"
              />

              <div className="space-y-1">

                <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                  {selectedBook.category}
                </span>

                <h3 className="text-lg font-bold text-slate-800">
                  {selectedBook.title}
                </h3>

                <p className="text-xs text-slate-500">
                  By {selectedBook.author}
                </p>

                <p className="text-xs text-slate-400 font-mono">
                  ISBN: {selectedBook.isbn}
                </p>

              </div>

            </div>

            {/* BOOK SUMMARY */}

            <div className="space-y-1 bg-slate-50 p-3 rounded-lg border border-slate-100">

              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Book Summary
              </h4>

              <p className="text-xs text-slate-600 leading-relaxed">
                {selectedBook.summary ||
                  'No summary provided yet.'}
              </p>

            </div>

            {/* LIBRARY LOCATIONS */}

            <div className="space-y-3 pt-2">

              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Available Library Locations:
              </h4>

              <div className="space-y-2">

                {getPartnerLibraryEntries(
                  selectedBook
                ).map((entry) => (

                  <div
                    key={entry.id}
                    className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                  >

                    <div>

                      <p className="font-bold text-slate-800 text-sm">
                        {libraryName(
                          entry.libraryId
                        )}
                      </p>

                      <p className="text-slate-500">
                        {entry.availableCopies > 0
                          ? `${entry.availableCopies} available`
                          : 'Out of stock (Queue available)'}
                      </p>

                    </div>

                    <div className="flex items-center gap-2">

                      <button
                        type="button"
                        onClick={() =>
                          handleViewMap(
                            entry.libraryId
                          )
                        }
                        className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded-lg font-bold hover:bg-slate-300 transition"
                      >
                        View Map
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleBorrowOrReserve(
                            entry
                          )
                        }
                        className="px-3 py-1.5 bg-[#002046] text-white rounded-lg font-bold hover:opacity-90 transition"
                      >
                        {entry.availableCopies > 0
                          ? 'Borrow'
                          : 'Reserve'}
                      </button>

                    </div>

                  </div>

                ))}

              </div>

            </div>

            {/* =================================================
                REVIEWS & RATINGS
               ================================================= */}

            <div className="pt-4 border-t border-slate-200 space-y-4">

              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">

                <span>
                  ⭐ Ratings & Reviews
                </span>

                <span className="text-slate-400 normal-case font-normal">
                  ({reviews.length}{' '}
                  {reviews.length === 1
                    ? 'review'
                    : 'reviews'}
                  )
                </span>

              </h4>

              {/* REVIEW FORM */}

              <form
                onSubmit={handleSubmitReview}
                className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3"
              >

                <div className="flex items-center justify-between">

                  <label className="text-xs font-bold text-slate-700">
                    Leave a Review:
                  </label>

                  <div className="flex items-center gap-1">

                    <span className="text-xs text-slate-500 mr-1">
                      Rating:
                    </span>

                    <select
                      value={userRating}
                      onChange={(e) =>
                        setUserRating(
                          Number(
                            e.target.value
                          )
                        )
                      }
                      className="text-xs bg-white border border-slate-300 rounded px-2 py-1 font-bold text-amber-600 focus:outline-none"
                    >
                      <option value="5">
                        ⭐⭐⭐⭐⭐ (5/5)
                      </option>

                      <option value="4">
                        ⭐⭐⭐⭐ (4/5)
                      </option>

                      <option value="3">
                        ⭐⭐⭐ (3/5)
                      </option>

                      <option value="2">
                        ⭐⭐ (2/5)
                      </option>

                      <option value="1">
                        ⭐ (1/5)
                      </option>

                    </select>

                  </div>

                </div>

                <textarea
                  value={userComment}
                  onChange={(e) =>
                    setUserComment(
                      e.target.value
                    )
                  }
                  placeholder="Write your review or thoughts about this book..."
                  rows={2}
                  className="w-full text-xs p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#002046]/20 bg-white"
                  required
                />

                <div className="flex justify-end">

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="bg-[#002046] text-white text-xs px-4 py-2 rounded-lg font-bold hover:opacity-90 transition disabled:opacity-50"
                  >
                    {isSubmitting
                      ? 'Submitting...'
                      : 'Submit Review'}
                  </button>

                </div>

              </form>

              {/* EXISTING REVIEWS */}

              <div className="space-y-3 max-h-48 overflow-y-auto pr-1">

                {loadingReviews ? (

                  <p className="text-xs text-slate-400 italic">
                    Kinukuha ang mga review...
                  </p>

                ) : reviews.length === 0 ? (

                  <p className="text-xs text-slate-400 italic">
                    No reviews yet for this book.
                    Be the first to leave a
                    review!
                  </p>

                ) : (

                  reviews.map((rev) => (

                    <div
                      key={rev.id}
                      className="p-3 bg-white rounded-lg border border-slate-100 shadow-sm text-xs space-y-1"
                    >

                      <div className="flex justify-between items-center">

                        <span className="font-bold text-slate-800">
                          {rev.visitor_name}
                        </span>

                        <span className="text-amber-500 font-bold">
                          {'⭐'.repeat(
                            Number(
                              rev.rating
                            )
                          )}
                        </span>

                      </div>

                      <p className="text-slate-600">
                        {rev.comment}
                      </p>

                      <p className="text-[10px] text-slate-400">
                        {formatDate(
                          rev.created_at
                        )}
                      </p>

                    </div>

                  ))

                )}

              </div>

            </div>

            {/* FOOTER */}

            <p className="text-[11px] text-slate-400 pt-2 border-t border-slate-100">
              Borrowed items are due{' '}
              {BORROW_PERIOD_DAYS} days after
              pickup. Holds must be picked up
              within {PICKUP_WINDOW_HOURS} hours
              or they're released automatically.
            </p>

          </div>

        </div>
      )}

    </div>
  );
}
