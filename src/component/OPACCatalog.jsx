import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import {
  useLibrary,
  useLibraryData,
} from '../context/LibraryContext.jsx';
import LibraryMap from './LibraryMap.jsx';
import { supabase } from '../lib/supabaseClient.js';

// =========================================================
// DATE HELPERS
// =========================================================

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

// =========================================================
// FINE CALCULATION
// =========================================================

function calculateCurrentFine(request) {
  if (!request) return 0;

  if (request.status === 'returned') {
    return Number(request.fineAmount || 0);
  }

  if (
    request.status !== 'borrowed' ||
    !request.dueDate
  ) {
    return 0;
  }

  const dueTime = new Date(request.dueDate).getTime();
  const nowTime = Date.now();

  if (nowTime <= dueTime) {
    return 0;
  }

  const overdueDays = Math.ceil(
    (nowTime - dueTime) /
      (1000 * 60 * 60 * 24)
  );

  return overdueDays * 10;
}

// =========================================================
// STATUS STYLES
// =========================================================

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

// =========================================================
// OPAC CATALOG
// =========================================================

export default function OPACCatalog({
  libraryFilter = null,
}) {
  const { user } = useAuth();

  const {
    books = [],
    borrowRequests = [],
    libraries = [],
  } = useLibraryData();

  const {
    requestBorrow,
    cancelBorrowRequest,
    PICKUP_WINDOW_HOURS,
    BORROW_PERIOD_DAYS,
  } = useLibrary();

  // =========================================================
  // SEARCH / FILTER STATES
  // =========================================================

  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const [selectedCategory, setSelectedCategory] =
    useState('All');

  const [selectedLibrary, setSelectedLibrary] =
    useState('All');

  const [selectedAvailability, setSelectedAvailability] =
    useState('All');

  // =========================================================
  // UI STATES
  // =========================================================

  const [selectedBook, setSelectedBook] =
    useState(null);

  const [activeTab, setActiveTab] =
    useState('catalog');

  const [notice, setNotice] =
    useState('');

  // =========================================================
  // MAP STATES
  // =========================================================

  const [mapLibrary, setMapLibrary] =
    useState(null);

  const [mapReturnBook, setMapReturnBook] =
    useState(null);

  // =========================================================
  // REVIEW STATES
  // =========================================================

  const [reviews, setReviews] =
    useState([]);

  const [userRating, setUserRating] =
    useState(5);

  const [userComment, setUserComment] =
    useState('');

  const [loadingReviews, setLoadingReviews] =
    useState(false);

  const [isSubmitting, setIsSubmitting] =
    useState(false);

  // =========================================================
  // LIVE FINE REFRESH
  // =========================================================

  const [, setFineRefresh] =
    useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFineRefresh((value) => value + 1);
    }, 60 * 1000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  // =========================================================
  // DYNAMIC FILTER OPTIONS
  // =========================================================

  const categories = [
    'All',
    ...new Set(
      books
        .map((book) => book.category)
        .filter(Boolean)
    ),
  ];

  const libraryOptions = [
    'All',
    ...new Set(
      books
        .map((book) => book.libraryId)
        .filter(Boolean)
    ),
  ];

  const libraryName = (id) =>
    libraries.find(
      (library) => library.id === id
    )?.name || id;

  // =========================================================
  // SEARCH HANDLER
  // =========================================================

  const handleSearch = (event) => {
    if (event) {
      event.preventDefault();
    }

    setSearchTerm(searchInput.trim());
  };

  // =========================================================
  // SEARCH INPUT CHANGE
  // IMPORTANT:
  // When the search box becomes empty, immediately clear
  // searchTerm so the complete catalog comes back.
  // =========================================================

  const handleSearchInputChange = (event) => {
    const value = event.target.value;

    setSearchInput(value);

    if (value.trim() === '') {
      setSearchTerm('');
    }
  };

  // =========================================================
  // CLEAR SEARCH
  // =========================================================

  const handleClearSearch = () => {
    setSearchInput('');
    setSearchTerm('');
  };

  // =========================================================
  // FETCH REVIEWS WHEN BOOK MODAL OPENS
  // =========================================================

  useEffect(() => {
    if (!selectedBook) {
      return;
    }

    const fetchReviews = async () => {
      setLoadingReviews(true);

      const { data, error } = await supabase
        .from('book_reviews')
        .select('*')
        .eq(
          'book_id',
          String(selectedBook.id)
        )
        .order('created_at', {
          ascending: false,
        });

      if (error) {
        console.error(
          'Error fetching reviews:',
          error.message
        );
        setReviews([]);
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

  const handleSubmitReview = async (event) => {
    event.preventDefault();

    if (
      !userComment.trim() ||
      !selectedBook
    ) {
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
        'Failed to save review: ' +
          error.message
      );
      return;
    }

    if (data && data.length > 0) {
      setReviews((currentReviews) => [
        data[0],
        ...currentReviews,
      ]);

      setUserComment('');
      setUserRating(5);

      setNotice(
        'Thank you for your rating and review!'
      );
    }
  };

  // =========================================================
  // FILTER BOOKS
  // =========================================================

  const normalizedSearch =
    searchTerm.trim().toLowerCase();

  const filteredBooks = books.filter(
    (book) => {
      const title =
        String(book.title || '')
          .toLowerCase();

      const author =
        String(book.author || '')
          .toLowerCase();

      const isbn =
        String(book.isbn || '')
          .toLowerCase();

      const category =
        String(book.category || '')
          .toLowerCase();

      const matchesSearch =
        normalizedSearch === '' ||
        title.includes(normalizedSearch) ||
        author.includes(normalizedSearch) ||
        isbn.includes(normalizedSearch) ||
        category.includes(normalizedSearch);

      const matchesCategory =
        selectedCategory === 'All' ||
        book.category === selectedCategory;

      const matchesLibrary =
        libraryFilter
          ? book.libraryId === libraryFilter
          : selectedLibrary === 'All' ||
            book.libraryId === selectedLibrary;

      const isAvailable =
        Number(book.availableCopies || 0) > 0;

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
    }
  );

  // =========================================================
  // MY REQUESTS
  // =========================================================

  const myRequests = borrowRequests
    .filter(
      (request) =>
        request.visitorId === user?.id
    )
    .sort(
      (a, b) =>
        new Date(b.requestDate) -
        new Date(a.requestDate)
    );

  // =========================================================
  // BORROW / RESERVE
  // =========================================================

  const handleBorrowOrReserve = (
    bookEntry
  ) => {
    try {
      if (!user?.id) {
        setNotice(
          'Please log in before requesting a book.'
        );
        return;
      }

      const request = requestBorrow(
        user.id,
        bookEntry.id
      );

      if (
        request.status ===
        'ready_for_pickup'
      ) {
        setNotice(
          `"${bookEntry.title}" is on hold for you at ${libraryName(
            bookEntry.libraryId
          )}! Visit within ${PICKUP_WINDOW_HOURS} hours to scan your QR pass.`
        );
      } else {
        setNotice(
          `"${bookEntry.title}" is currently unavailable at this branch — you are #${request.queuePosition} in the reservation queue.`
        );
      }
    } catch (error) {
      setNotice(
        error?.message ||
          'Unable to process the request.'
      );
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

      setNotice(
        'Request cancelled.'
      );
    } catch (error) {
      setNotice(
        error?.message ||
          'Unable to cancel request.'
      );
    }
  };

  // =========================================================
  // VIEW LIBRARY MAP
  // =========================================================

  const handleViewMap = (libraryId) => {
    const library = libraries.find(
      (item) => item.id === libraryId
    );

    if (!library) {
      setNotice(
        'Library location could not be found.'
      );
      return;
    }

    if (
      library.lat === null ||
      library.lat === undefined ||
      library.lng === null ||
      library.lng === undefined
    ) {
      setNotice(
        'GPS coordinates are not available for this library yet.'
      );
      return;
    }

    if (selectedBook) {
      setMapReturnBook(selectedBook);
    }

    setMapLibrary(library);
    setSelectedBook(null);

    globalThis.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };

  // =========================================================
  // CLOSE MAP
  // =========================================================

  const handleCloseMap = () => {
    setMapLibrary(null);

    if (mapReturnBook) {
      setSelectedBook(mapReturnBook);
    }

    setMapReturnBook(null);
  };

  // =========================================================
  // FIND PARTNER LIBRARY ENTRIES
  // =========================================================

  const getPartnerLibraryEntries = (
    book
  ) => {
    if (!book) {
      return [];
    }

    return books.filter(
      (entry) =>
        entry.title === book.title ||
        (
          book.isbn &&
          entry.isbn === book.isbn
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
      ====================================================== */}

      {notice && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs px-4 py-3 rounded-lg flex justify-between items-start gap-3">
          <span>{notice}</span>

          <button
            type="button"
            onClick={() => setNotice('')}
            className="font-bold text-blue-400 hover:text-blue-700"
            aria-label="Close notification"
          >
            ✕
          </button>
        </div>
      )}

      {/* =====================================================
          NAVIGATION TABS
      ====================================================== */}

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
            (request) =>
              [
                'queued',
                'ready_for_pickup',
                'borrowed',
              ].includes(
                request.status
              )
          ).length > 0 && (
            <span className="bg-[#002046] text-white text-xs px-2 py-0.5 rounded-full">
              {
                myRequests.filter(
                  (request) =>
                    [
                      'queued',
                      'ready_for_pickup',
                      'borrowed',
                    ].includes(
                      request.status
                    )
                ).length
              }
            </span>
          )}
        </button>

      </div>

      {/* =====================================================
          CATALOG
      ====================================================== */}

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
          ================================================== */}

          <div className="flex flex-col md:flex-row gap-3 flex-wrap">

            <form
              onSubmit={handleSearch}
              className="flex flex-1 min-w-[280px] gap-2"
            >
              <input
                type="text"
                placeholder="Search by Title, Author, ISBN, or Category..."
                value={searchInput}
                onChange={handleSearchInputChange}
                className="flex-1 min-w-0 px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                aria-label="Search catalog"
              />

              <button
                type="submit"
                className="px-5 py-2.5 bg-[#002046] text-white rounded-lg text-sm font-bold hover:opacity-90 transition"
              >
                Search
              </button>
            </form>

            {searchTerm && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-lg text-sm font-bold hover:bg-slate-200 transition"
              >
                Clear
              </button>
            )}

            {!libraryFilter && (
              <select
                value={selectedLibrary}
                onChange={(event) =>
                  setSelectedLibrary(
                    event.target.value
                  )
                }
                className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none"
              >
                <option value="All">
                  All Libraries
                </option>

                {libraryOptions
                  .filter(
                    (libraryId) =>
                      libraryId !== 'All'
                  )
                  .map((libraryId) => (
                    <option
                      key={libraryId}
                      value={libraryId}
                    >
                      {libraryName(
                        libraryId
                      )}
                    </option>
                  ))}
              </select>
            )}

            <select
              value={selectedCategory}
              onChange={(event) =>
                setSelectedCategory(
                  event.target.value
                )
              }
              className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none"
            >
              <option value="All">
                All Categories
              </option>

              {categories
                .filter(
                  (category) =>
                    category !== 'All'
                )
                .map((category) => (
                  <option
                    key={category}
                    value={category}
                  >
                    {category}
                  </option>
                ))}
            </select>

            <select
              value={selectedAvailability}
              onChange={(event) =>
                setSelectedAvailability(
                  event.target.value
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
              SEARCH RESULT INFORMATION
          ================================================== */}

          {searchTerm && (
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                Search results for:{' '}
                <strong className="text-slate-800">
                  "{searchTerm}"
                </strong>
              </span>

              <span>
                {filteredBooks.length}{' '}
                {filteredBooks.length === 1
                  ? 'book'
                  : 'books'} found
              </span>
            </div>
          )}

          {/* =================================================
              BOOK RESULTS
          ================================================== */}

          {books.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500">
              No books in the catalog yet.
              Please check back soon — the
              library team is still populating
              the collection.
            </div>
          ) : filteredBooks.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500">
              <p className="font-bold text-slate-700 mb-1">
                No books found
              </p>

              <p>
                No books matched your search
                or filter criteria.
              </p>

              {(searchTerm ||
                selectedCategory !== 'All' ||
                selectedLibrary !== 'All' ||
                selectedAvailability !== 'All') && (
                <button
                  type="button"
                  onClick={() => {
                    handleClearSearch();
                    setSelectedCategory('All');
                    setSelectedLibrary('All');
                    setSelectedAvailability('All');
                  }}
                  className="mt-4 px-4 py-2 bg-[#002046] text-white rounded-lg text-xs font-bold hover:opacity-90 transition"
                >
                  Clear All Filters
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

              {filteredBooks.map(
                (book) => (
                  <div
                    key={book.id}
                    className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition flex flex-col justify-between"
                  >

                    <div className="p-4 flex gap-4">

                      <img
                        src={
                          book.coverUrl ||
                          'https://placehold.co/96x128?text=No+Cover'
                        }
                        alt={
                          book.title ||
                          'Book cover'
                        }
                        className="w-24 h-32 object-cover rounded-md border border-slate-200 bg-slate-50"
                        onError={(event) => {
                          event.currentTarget.src =
                            'https://placehold.co/96x128?text=No+Cover';
                        }}
                      />

                      <div className="space-y-1 min-w-0">

                        <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                          {book.category ||
                            'Uncategorized'}
                        </span>

                        <h3 className="font-bold text-slate-800 text-sm line-clamp-2">
                          {book.title ||
                            'Untitled Book'}
                        </h3>

                        <p className="text-xs text-slate-500">
                          {book.author ||
                            'Unknown Author'}
                        </p>

                        <p className="text-xs text-slate-400 font-mono">
                          ISBN:{' '}
                          {book.isbn ||
                            'N/A'}
                        </p>

                        <div className="pt-2">

                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                              Number(
                                book.availableCopies || 0
                              ) > 0
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {Number(
                              book.availableCopies || 0
                            ) > 0
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
                )
              )}

            </div>
          )}

        </div>
      ) : (

        /* =====================================================
           MY REQUESTS
        ====================================================== */

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

                {myRequests.map(
                  (request) => {
                    const currentFine =
                      calculateCurrentFine(
                        request
                      );

                    const isOverdue =
                      request.status ===
                        'borrowed' &&
                      currentFine > 0;

                    const overdueDays =
                      request.dueDate &&
                      isOverdue
                        ? Math.ceil(
                            (
                              Date.now() -
                              new Date(
                                request.dueDate
                              ).getTime()
                            ) /
                              (
                                1000 *
                                60 *
                                60 *
                                24
                              )
                          )
                        : 0;

                    return (
                      <tr
                        key={request.id}
                        className="hover:bg-slate-50"
                      >

                        <td className="p-4 font-bold text-slate-800">
                          {request.bookTitle}
                        </td>

                        <td className="p-4">

                          <div className="flex flex-col items-start gap-1">

                            <span
                              className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                                isOverdue
                                  ? 'bg-red-100 text-red-700'
                                  : STATUS_STYLES[
                                      request.status
                                    ] ||
                                    'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {isOverdue
                                ? 'Overdue'
                                : STATUS_LABELS[
                                    request.status
                                  ] ||
                                  request.status}
                            </span>

                          </div>

                        </td>

                        <td className="p-4 text-xs text-slate-500 space-y-0.5">

                          {request.status ===
                            'queued' && (
                            <p>
                              Queue position: #
                              {
                                request.queuePosition
                              }
                            </p>
                          )}

                          {request.status ===
                            'ready_for_pickup' && (
                            <p>
                              Pick up by:{' '}
                              {formatDateTime(
                                request.pickupDeadline
                              )}
                            </p>
                          )}

                          {request.status ===
                            'borrowed' && (
                            <>
                              <p>
                                Due:{' '}
                                {formatDate(
                                  request.dueDate
                                )}
                              </p>

                              {isOverdue && (
                                <p className="font-bold text-red-600">
                                  Overdue by{' '}
                                  {overdueDays}{' '}
                                  day
                                  {overdueDays !== 1
                                    ? 's'
                                    : ''}
                                </p>
                              )}
                            </>
                          )}

                          {request.status ===
                            'returned' && (
                            <p>
                              Returned:{' '}
                              {formatDate(
                                request.returnDate
                              )}
                            </p>
                          )}

                        </td>

                        <td
                          className={`p-4 font-mono font-bold text-xs ${
                            currentFine > 0
                              ? 'text-red-600'
                              : 'text-slate-500'
                          }`}
                        >
                          ₱{currentFine.toFixed(2)}
                        </td>

                        <td className="p-4 text-right">

                          {[
                            'queued',
                            'ready_for_pickup',
                          ].includes(
                            request.status
                          ) && (
                            <button
                              type="button"
                              onClick={() =>
                                handleCancel(
                                  request.id
                                )
                              }
                              className="bg-red-50 text-red-600 text-xs px-3 py-1.5 rounded-lg font-bold hover:bg-red-100 transition"
                            >
                              Cancel
                            </button>
                          )}

                        </td>

                      </tr>
                    );
                  }
                )}

              </tbody>

            </table>

          )}

        </div>
      )}

      {/* =====================================================
          VIEW INFO & REQUEST MODAL
      ====================================================== */}

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
              aria-label="Close book information"
            >
              ✕
            </button>

            {/* BOOK HEADER */}

            <div className="flex gap-4 pr-8">

              <img
                src={
                  selectedBook.coverUrl ||
                  'https://placehold.co/96x128?text=No+Cover'
                }
                alt={
                  selectedBook.title ||
                  'Book cover'
                }
                className="w-24 h-32 object-cover rounded-lg border border-slate-200 bg-slate-50"
                onError={(event) => {
                  event.currentTarget.src =
                    'https://placehold.co/96x128?text=No+Cover';
                }}
              />

              <div className="space-y-1">

                <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                  {selectedBook.category ||
                    'Uncategorized'}
                </span>

                <h3 className="text-lg font-bold text-slate-800">
                  {selectedBook.title ||
                    'Untitled Book'}
                </h3>

                <p className="text-xs text-slate-500">
                  By{' '}
                  {selectedBook.author ||
                    'Unknown Author'}
                </p>

                <p className="text-xs text-slate-400 font-mono">
                  ISBN:{' '}
                  {selectedBook.isbn ||
                    'N/A'}
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
                    className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs gap-3"
                  >

                    <div>

                      <p className="font-bold text-slate-800 text-sm">
                        {libraryName(
                          entry.libraryId
                        )}
                      </p>

                      <p className="text-slate-500">
                        {Number(
                          entry.availableCopies || 0
                        ) > 0
                          ? `${entry.availableCopies} available`
                          : 'Out of stock (Queue available)'}
                      </p>

                    </div>

                    <div className="flex items-center gap-2 shrink-0">

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
                        {Number(
                          entry.availableCopies || 0
                        ) > 0
                          ? 'Borrow'
                          : 'Reserve'}
                      </button>

                    </div>

                  </div>

                ))}

              </div>

            </div>

            {/* REVIEWS & RATINGS */}

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
                onSubmit={
                  handleSubmitReview
                }
                className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3"
              >

                <div className="flex items-center justify-between gap-3">

                  <label className="text-xs font-bold text-slate-700">
                    Leave a Review:
                  </label>

                  <div className="flex items-center gap-1">

                    <span className="text-xs text-slate-500 mr-1">
                      Rating:
                    </span>

                    <select
                      value={userRating}
                      onChange={(event) =>
                        setUserRating(
                          Number(
                            event.target.value
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
                  onChange={(event) =>
                    setUserComment(
                      event.target.value
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
                    Loading reviews...
                  </p>

                ) : reviews.length === 0 ? (

                  <p className="text-xs text-slate-400 italic">
                    No reviews yet for this book.
                    Be the first to leave a
                    review!
                  </p>

                ) : (

                  reviews.map((review) => (

                    <div
                      key={review.id}
                      className="p-3 bg-white rounded-lg border border-slate-100 shadow-sm text-xs space-y-1"
                    >

                      <div className="flex justify-between items-center gap-3">

                        <span className="font-bold text-slate-800">
                          {review.visitor_name}
                        </span>

                        <span className="text-amber-500 font-bold">
                          {'⭐'.repeat(
                            Math.max(
                              0,
                              Math.min(
                                5,
                                Number(
                                  review.rating
                                ) || 0
                              )
                            )
                          )}
                        </span>

                      </div>

                      <p className="text-slate-600">
                        {review.comment}
                      </p>

                      <p className="text-[10px] text-slate-400">
                        {formatDate(
                          review.created_at
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
              Overdue books are charged ₱10 per
              overdue day.
            </p>

          </div>

        </div>
      )}

    </div>
  );
}
