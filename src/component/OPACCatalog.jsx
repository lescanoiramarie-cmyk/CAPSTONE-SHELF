import { useEffect, useState } from 'react';
import { useAuth } from '../context/useAuth.js';
import { BookOpen, MapPinned, Search, X } from 'lucide-react';
import {
  useLibrary,
  useLibraryData,
} from '../context/useLibrary.js';
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

function calculateOverdueDays(dueDate) {
  return Math.ceil(
    (Date.now() - new Date(dueDate).getTime()) /
      (1000 * 60 * 60 * 24)
  );
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
  activeView = 'catalog',
  onViewChange = () => {},
  catalogResetKey = 0,
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

  const [categorySelection, setCategorySelection] = useState({
    resetKey: catalogResetKey,
    value: 'All',
  });

  const selectedCategory =
    categorySelection.resetKey === catalogResetKey
      ? categorySelection.value
      : 'All';

  const setSelectedCategory = (value) => {
    setCategorySelection({
      resetKey: catalogResetKey,
      value,
    });
  };

  const [selectedLibrary, setSelectedLibrary] =
    useState('All');

  const [selectedAvailability, setSelectedAvailability] =
    useState('All');

  // =========================================================
  // UI STATES
  // =========================================================

  const [selectedBook, setSelectedBook] =
    useState(null);

  const [notice, setNotice] =
    useState('');

  const [cancellingRequestId, setCancellingRequestId] =
    useState(null);

  const [submittingBorrow, setSubmittingBorrow] =
    useState(false);

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

  const uniqueBooksByCategory = new Map();

  books.forEach((book) => {
    const category =
      book.category?.trim() || 'Uncategorized';

    const categoryKey =
      category.toLocaleLowerCase();

    const normalizedIsbn = String(book.isbn || '')
      .replace(/[^a-z0-9]/gi, '')
      .toLocaleLowerCase();

    const normalizedTitle = String(book.title || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase();

    const normalizedAuthor = String(book.author || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase();

    const bookKey = normalizedIsbn
      ? `isbn:${normalizedIsbn}`
      : normalizedTitle || normalizedAuthor
        ? `title-author:${normalizedTitle}|${normalizedAuthor}`
        : `id:${book.id}`;

    if (!uniqueBooksByCategory.has(categoryKey)) {
      uniqueBooksByCategory.set(categoryKey, {
        label: category,
        books: new Set(),
      });
    }

    uniqueBooksByCategory
      .get(categoryKey)
      .books.add(bookKey);
  });

  const categorySummaries =
    [...uniqueBooksByCategory.values()]
      .map(({ label, books: uniqueBooks }) => ({
        label,
        count: uniqueBooks.size,
      }))
      .sort((a, b) =>
        a.label.localeCompare(b.label)
      );

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

  const handleSearchInputChange = (event) => {
    const value = event.target.value;

    setSearchInput(value);

    if (value.trim() === '') {
      setSearchTerm('');
    }
  };

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
        String(
          book.category || 'Uncategorized'
        )
          .trim()
          .toLocaleLowerCase() ===
          selectedCategory.toLocaleLowerCase();

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
        String(request.visitorId) ===
        String(user?.id)
    )
    .sort(
      (a, b) =>
        new Date(b.requestDate || 0) -
        new Date(a.requestDate || 0)
    );

  // =========================================================
  // BORROW / RESERVE
  // =========================================================

  const handleBorrowOrReserve = async (
    bookEntry
  ) => {
    if (!user?.id) {
      setNotice(
        'Please log in before requesting a book.'
      );
      return;
    }

    if (!bookEntry?.id) {
      setNotice(
        'Unable to identify the selected book.'
      );
      return;
    }

    if (submittingBorrow) {
      return;
    }

    setSubmittingBorrow(true);
    setNotice('');

    try {
      const request = await requestBorrow(
        user.id,
        bookEntry.id
      );

      if (!request) {
        throw new Error(
          'The borrow request was not created. Please try again.'
        );
      }

      const status =
        request.status ||
        request.requestStatus;

      const rawQueuePosition =
        request.queuePosition ??
        request.queue_position ??
        request.position;

      const queuePosition =
        rawQueuePosition !== null &&
        rawQueuePosition !== undefined &&
        rawQueuePosition !== ''
          ? Number(rawQueuePosition)
          : null;

      if (status === 'ready_for_pickup') {
        setNotice(
          `"${bookEntry.title}" is on hold for you at ${libraryName(
            bookEntry.libraryId
          )}. Please visit within ${PICKUP_WINDOW_HOURS} hours to scan your QR pass.`
        );
      } else if (status === 'queued') {
        if (
          Number.isFinite(queuePosition)
        ) {
          setNotice(
            `"${bookEntry.title}" is currently unavailable at this branch — you are #${queuePosition} in the reservation queue.`
          );
        } else {
          setNotice(
            `"${bookEntry.title}" is currently unavailable at this branch. Your reservation has been added to the queue.`
          );
        }
      } else {
        setNotice(
          `"${bookEntry.title}" borrow request was created successfully.`
        );
      }

      setSelectedBook(null);
      onViewChange('myBorrows');
    } catch (error) {
      console.error(
        'Borrow request error:',
        error
      );

      setNotice(
        error?.message ||
          'Unable to process the borrow request. Please try again.'
      );
    } finally {
      setSubmittingBorrow(false);
    }
  };

  // =========================================================
  // CANCEL REQUEST
  // =========================================================

  const handleCancel = async (
    requestId
  ) => {
    if (!requestId) {
      setNotice(
        'Unable to identify the borrow request.'
      );
      return;
    }

    if (cancellingRequestId) {
      return;
    }

    setCancellingRequestId(requestId);
    setNotice('');

    try {
      await cancelBorrowRequest(
        requestId,
        'cancelled'
      );

      setNotice(
        'Request cancelled successfully.'
      );
    } catch (error) {
      console.error(
        'Cancel request error:',
        error
      );

      setNotice(
        error?.message ||
          'Unable to cancel request. Please try again.'
      );
    } finally {
      setCancellingRequestId(null);
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

    const normalizedIsbn =
      String(book.isbn || '')
        .replace(/[^a-z0-9]/gi, '')
        .toLowerCase();

    const normalizedTitle =
      String(book.title || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();

    const normalizedAuthor =
      String(book.author || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();

    return books.filter((entry) => {
      const hasInventory =
        Number(entry.totalCopies || 0) > 0 &&
        entry.libraryId;

      const entryIsbn =
        String(entry.isbn || '')
          .replace(/[^a-z0-9]/gi, '')
          .toLowerCase();

      const sameBook =
        normalizedIsbn && entryIsbn
          ? normalizedIsbn === entryIsbn
          : normalizedTitle ===
              String(entry.title || '')
                .trim()
                .replace(/\s+/g, ' ')
                .toLowerCase() &&
            normalizedAuthor ===
              String(entry.author || '')
                .trim()
                .replace(/\s+/g, ' ')
                .toLowerCase();

      return hasInventory && sameBook;
    });
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
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* =====================================================
          CATALOG
      ====================================================== */}

      {activeView === 'catalog' ? (
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

          {selectedCategory !== 'All' && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-800">
                  Books in {selectedCategory}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {filteredBooks.length}{' '}
                  catalog{' '}
                  {filteredBooks.length === 1
                    ? 'entry'
                    : 'entries'}
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setSelectedCategory('All')
                }
                className="text-xs font-semibold text-[#002046] hover:underline"
              >
                Clear category
              </button>
            </div>
          )}

          {/* =================================================
              BOOK RESULTS
          ================================================== */}

          {books.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-full bg-amber-50 text-amber-700">
                <BookOpen
                  size={26}
                  aria-hidden="true"
                />
              </span>

              <h3 className="mt-4 text-lg font-bold text-slate-800">
                The shelves are waiting for their first readers.
              </h3>

              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                This catalog is being prepared.
                Explore nearby branches while new
                titles are added.
              </p>

              <button
                type="button"
                onClick={() =>
                  onViewChange?.('map')
                }
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-amber-400"
              >
                <MapPinned
                  size={16}
                  aria-hidden="true"
                />
                Explore library locations
              </button>
            </div>
          ) : filteredBooks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center">
              <Search
                size={28}
                className="mx-auto text-slate-400"
                aria-hidden="true"
              />

              <h3 className="mt-3 text-base font-bold text-slate-800">
                Nothing on the shelf matched that search.
              </h3>

              <p className="mt-1 text-sm text-slate-500">
                Try another title or clear your
                filters to see more books.
              </p>

              {(
                searchTerm ||
                selectedCategory !== 'All' ||
                selectedLibrary !== 'All' ||
                selectedAvailability !== 'All'
              ) && (
                <button
                  type="button"
                  onClick={() => {
                    handleClearSearch();
                    setSelectedCategory('All');
                    setSelectedLibrary('All');
                    setSelectedAvailability('All');
                  }}
                  className="mt-4 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 transition hover:bg-amber-400"
                >
                  Clear All Filters
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

              {filteredBooks.map(
                (book) => (
                  <button
                    type="button"
                    key={book.id}
                    onClick={() =>
                      setSelectedBook(book)
                    }
                    aria-label={`View details for ${
                      book.title ||
                      'Untitled Book'
                    }`}
                    className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md flex flex-col justify-between text-left"
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

                  </button>
                )
              )}

            </div>
          )}

        </div>
      ) : activeView === 'categories' ? (
        <section
          aria-labelledby="opac-category-heading"
          className="space-y-5"
        >
          <div>
            <h2
              id="opac-category-heading"
              className="text-lg font-bold text-slate-800"
            >
              Book Categories
            </h2>

            <p className="mt-1 text-xs text-slate-500">
              Unique titles across participating libraries
            </p>
          </div>

          {categorySummaries.length ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {categorySummaries.map(
                ({ label, count }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      setSelectedCategory(
                        label
                      );
                      setSearchInput('');
                      setSearchTerm('');
                      setSelectedLibrary('All');
                      setSelectedAvailability(
                        'All'
                      );
                      onViewChange('catalog');
                    }}
                    className="flex min-h-16 items-center justify-between gap-3 border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-[#002046] hover:bg-blue-50"
                  >
                    <span className="min-w-0 text-sm font-semibold text-slate-700">
                      {label}
                    </span>

                    <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                      {count}{' '}
                      {count === 1
                        ? 'book'
                        : 'books'}
                    </span>
                  </button>
                )
              )}
            </div>
          ) : (
            <p className="border border-dashed border-slate-300 px-4 py-5 text-center text-sm text-slate-500">
              No book categories are available yet.
            </p>
          )}
        </section>
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
                        ? calculateOverdueDays(
                            request.dueDate
                          )
                        : 0;

                    const canCancel = [
                      'queued',
                      'ready_for_pickup',
                    ].includes(
                      request.status
                    );

                    const isCancelling =
                      cancellingRequestId ===
                      request.id;

                    const queuePosition =
                      request.queuePosition ??
                      request.queue_position ??
                      request.position;

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
                              Queue position:{' '}
                              {queuePosition !==
                                undefined &&
                              queuePosition !==
                                null
                                ? `#${queuePosition}`
                                : 'Pending'}
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

                          {canCancel && (
                            <button
                              type="button"
                              disabled={
                                Boolean(
                                  cancellingRequestId
                                )
                              }
                              onClick={() =>
                                handleCancel(
                                  request.id
                                )
                              }
                              className="bg-red-50 text-red-600 text-xs px-3 py-1.5 rounded-lg font-bold hover:bg-red-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isCancelling
                                ? 'Cancelling...'
                                : 'Cancel'}
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

            <button
              type="button"
              onClick={() =>
                setSelectedBook(null)
              }
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 font-bold"
              aria-label="Close book information"
            >
              <X size={18} aria-hidden="true" />
            </button>

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

            <div className="space-y-1 bg-slate-50 p-3 rounded-lg border border-slate-100">

              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Book Summary
              </h4>

              <p className="text-xs text-slate-600 leading-relaxed">
                {selectedBook.summary ||
                  'No summary provided yet.'}
              </p>

            </div>

            <div className="space-y-3 pt-2">

              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Available Library Locations:
              </h4>

              <div className="space-y-2">

                {getPartnerLibraryEntries(
                  selectedBook
                ).length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No libraries currently have
                    this book in inventory.
                  </p>
                ) : (
                  getPartnerLibraryEntries(
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
                          disabled={
                            submittingBorrow
                          }
                          onClick={() =>
                            handleBorrowOrReserve(
                              entry
                            )
                          }
                          className="px-3 py-1.5 bg-[#002046] text-white rounded-lg font-bold hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {submittingBorrow
                            ? 'Processing...'
                            : Number(
                                  entry.availableCopies ||
                                    0
                                ) > 0
                              ? 'Borrow'
                              : 'Reserve'}
                        </button>

                      </div>

                    </div>

                  ))
                )}

              </div>

            </div>

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
