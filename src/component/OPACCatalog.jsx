import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/useAuth.js';
import {
  BookOpen,
  MapPinned,
  Search,
  X,
  Plus,
  Library,
  UserRound,
  Users,
  Clock3,
  MapPin,
} from 'lucide-react';

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
// PERSONAL BOOK CONSTANTS
// =========================================================

const PERSONAL_BOOK_CONDITIONS = [
  'New',
  'Like New',
  'Good',
  'Fair',
  'Poor',
];

const PERSONAL_BOOK_MIN_LENDING_DAYS = 1;
const PERSONAL_BOOK_MAX_LENDING_DAYS = 30;

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
    personalBooks = [],
    communityBooks = [],
  } = useLibraryData();

  const {
    requestBorrow,
    cancelBorrowRequest,
    addPersonalBook,
    requestCommunityBook,
    fetchOwnerCommunityBookRequests,
    approveCommunityBookRequest,
    rejectCommunityBookRequest,
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

  const [submittingCommunityRequest, setSubmittingCommunityRequest] =
    useState(false);

  // =========================================================
  // PERSONAL / COMMUNITY BOOK STATES
  // =========================================================

  const [loadingPersonalBooks, setLoadingPersonalBooks] =
    useState(false);

  const [loadingCommunityBooks, setLoadingCommunityBooks] =
    useState(false);

  const [personalBookError, setPersonalBookError] =
    useState('');

  const [communityBookError, setCommunityBookError] =
    useState('');

  // =========================================================
  // COMMUNITY BOOK OWNER REQUEST STATES
  // =========================================================

  const [ownerCommunityRequests, setOwnerCommunityRequests] =
    useState([]);

  const [loadingOwnerCommunityRequests, setLoadingOwnerCommunityRequests] =
    useState(false);

  const [ownerCommunityRequestError, setOwnerCommunityRequestError] =
    useState('');

  const [processingCommunityRequestId, setProcessingCommunityRequestId] =
    useState(null);

  const [showRejectCommunityRequest, setShowRejectCommunityRequest] =
    useState(null);

  const [communityRequestResponse, setCommunityRequestResponse] =
    useState('');

  const [communityRequestNotice, setCommunityRequestNotice] =
    useState('');

  const [showAddPersonalBook, setShowAddPersonalBook] =
    useState(false);

  const [addingPersonalBook, setAddingPersonalBook] =
    useState(false);

  // =========================================================
  // ADD PERSONAL BOOK FORM
  // =========================================================

  const [personalBookForm, setPersonalBookForm] =
    useState({
      title: '',
      author: '',
      category: '',
      isbn: '',
      summary: '',
      condition: 'Good',
      lendingPeriodDays: 7,
      handoverMethod: 'arrange_with_owner',
      handoverDetails: '',
      lendingEnabled: true,
    });

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
  // PERSONAL / COMMUNITY BOOK DATA
  // =========================================================
  //
  // LibraryProvider already loads these collections centrally.
  // This component consumes them through useLibraryData().
  // =========================================================

  useEffect(() => {
    setLoadingPersonalBooks(false);
    setLoadingCommunityBooks(false);
  }, [personalBooks, communityBooks]);

  // =========================================================
  // LOAD COMMUNITY BOOK REQUESTS FOR THE OWNER
  // =========================================================

  useEffect(() => {
    let cancelled = false;

    const loadOwnerCommunityRequests = async () => {
      if (!user?.id) {
        setOwnerCommunityRequests([]);
        setLoadingOwnerCommunityRequests(false);
        return;
      }

      if (typeof window !== 'undefined') {
        // Keep the owner section tied to the currently logged-in visitor.
        // The actual ownership check is also enforced by the RPC.
      }

      if (typeof fetchOwnerCommunityBookRequests !== 'function') {
        if (!cancelled) {
          setOwnerCommunityRequests([]);
          setOwnerCommunityRequestError(
            'Community book request service is not available. Please refresh the page.'
          );
        }
        return;
      }

      setLoadingOwnerCommunityRequests(true);
      setOwnerCommunityRequestError('');

      try {
        const requests = await fetchOwnerCommunityBookRequests(user.id);

        if (!cancelled) {
          setOwnerCommunityRequests(
            Array.isArray(requests) ? requests : []
          );
        }
      } catch (error) {
        console.error('Load owner community requests error:', error);

        if (!cancelled) {
          setOwnerCommunityRequests([]);
          setOwnerCommunityRequestError(
            error?.message ||
              'Unable to load community book requests.'
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingOwnerCommunityRequests(false);
        }
      }
    };

    loadOwnerCommunityRequests();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // =========================================================
  // PERSONAL BOOK FORM HELPERS
  // =========================================================

  const updatePersonalBookForm = (
    field,
    value
  ) => {
    setPersonalBookForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const resetPersonalBookForm = () => {
    setPersonalBookForm({
      title: '',
      author: '',
      category: '',
      isbn: '',
      summary: '',
      condition: 'Good',
      lendingPeriodDays: 7,
      handoverMethod: 'arrange_with_owner',
      handoverDetails: '',
      lendingEnabled: true,
    });
  };

  // =========================================================
  // ADD PERSONAL BOOK
  // =========================================================

  const handleAddPersonalBook = async (
    event
  ) => {
    event.preventDefault();

    if (!user?.id) {
      setNotice(
        'Please log in before adding a personal book.'
      );
      return;
    }

    const title =
      personalBookForm.title.trim();

    const author =
      personalBookForm.author.trim();

    const category =
      personalBookForm.category.trim();

    const isbn =
      personalBookForm.isbn.trim();

    const summary =
      personalBookForm.summary.trim();

    const handoverMethod =
      String(
        personalBookForm.handoverMethod || ''
      ).trim();

    const handoverDetails =
      personalBookForm.handoverDetails.trim();

    const lendingPeriodDays =
      Number(
        personalBookForm.lendingPeriodDays
      );

    if (!title) {
      setNotice(
        'Book title is required.'
      );
      return;
    }

    if (!author) {
      setNotice(
        'Book author is required.'
      );
      return;
    }

    if (
      !Number.isInteger(
        lendingPeriodDays
      ) ||
      lendingPeriodDays <
        PERSONAL_BOOK_MIN_LENDING_DAYS ||
      lendingPeriodDays >
        PERSONAL_BOOK_MAX_LENDING_DAYS
    ) {
      setNotice(
        `Lending period must be between ${PERSONAL_BOOK_MIN_LENDING_DAYS} and ${PERSONAL_BOOK_MAX_LENDING_DAYS} days.`
      );
      return;
    }

    if (
      personalBookForm.lendingEnabled &&
      !handoverMethod
    ) {
      setNotice(
        'Please select a handover method when lending is enabled.'
      );
      return;
    }

    if (handoverDetails.length > 500) {
      setNotice(
        'Handover details must not exceed 500 characters.'
      );
      return;
    }

    if (addingPersonalBook) {
      return;
    }

    setAddingPersonalBook(true);
    setNotice('');

    try {
      const createdBook =
        await addPersonalBook({
          visitorId: user.id,
          title,
          author,
          category: category || null,
          isbn: isbn || null,
          summary: summary || null,
          condition:
            personalBookForm.condition,
          lendingPeriodDays,
          handoverMethod:
            handoverMethod || 'arrange_with_owner',
          handoverDetails:
            handoverDetails || null,
          lendingEnabled:
            Boolean(
              personalBookForm.lendingEnabled
            ),
        });

      if (!createdBook) {
        throw new Error(
          'The personal book was not created. Please try again.'
        );
      }

      setShowAddPersonalBook(false);
      resetPersonalBookForm();

      setNotice(
        `"${title}" was added to your personal books successfully.`
      );
    } catch (error) {
      console.error(
        'Add personal book error:',
        error
      );

      setNotice(
        error?.message ||
          'Unable to add the personal book. Please try again.'
      );
    } finally {
      setAddingPersonalBook(false);
    }
  };

  // =========================================================
  // DYNAMIC FILTER OPTIONS
  // =========================================================

  const uniqueBooksByCategory = new Map();

  books.forEach((book) => {
    const category =
      book.category?.trim() ||
      'Uncategorized';

    const categoryKey =
      category.toLocaleLowerCase();

    const normalizedIsbn =
      String(book.isbn || '')
        .replace(/[^a-z0-9]/gi, '')
        .toLocaleLowerCase();

    const normalizedTitle =
      String(book.title || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase();

    const normalizedAuthor =
      String(book.author || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase();

    const bookKey = normalizedIsbn
      ? `isbn:${normalizedIsbn}`
      : normalizedTitle ||
          normalizedAuthor
        ? `title-author:${normalizedTitle}|${normalizedAuthor}`
        : `id:${book.id}`;

    if (
      !uniqueBooksByCategory.has(
        categoryKey
      )
    ) {
      uniqueBooksByCategory.set(
        categoryKey,
        {
          label: category,
          books: new Set(),
        }
      );
    }

    uniqueBooksByCategory
      .get(categoryKey)
      .books.add(bookKey);
  });

  const categorySummaries =
    [
      ...uniqueBooksByCategory.values(),
    ]
      .map(
        ({
          label,
          books: uniqueBooks,
        }) => ({
          label,
          count: uniqueBooks.size,
        })
      )
      .sort((a, b) =>
        a.label.localeCompare(b.label)
      );

  const libraryOptions = [
    'All',
    ...new Set(
      books
        .map(
          (book) =>
            book.libraryId
        )
        .filter(Boolean)
    ),
  ];

  const libraryName = (id) =>
    libraries.find(
      (library) =>
        library.id === id
    )?.name || id;

  // =========================================================
  // SEARCH HANDLERS
  // =========================================================

  const handleSearch = (event) => {
    if (event) {
      event.preventDefault();
    }

    setSearchTerm(
      searchInput.trim()
    );
  };

  const handleSearchInputChange = (
    event
  ) => {
    const value =
      event.target.value;

    setSearchInput(value);

    if (
      value.trim() === ''
    ) {
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

      const {
        data,
        error,
      } = await supabase
        .from('book_reviews')
        .select('*')
        .eq(
          'book_id',
          String(
            selectedBook.id
          )
        )
        .order(
          'created_at',
          {
            ascending: false,
          }
        );

      if (error) {
        console.error(
          'Error fetching reviews:',
          error.message
        );

        setReviews([]);
      } else {
        setReviews(
          data || []
        );
      }

      setLoadingReviews(false);
    };

    fetchReviews();
  }, [selectedBook]);

  // =========================================================
  // SUBMIT REVIEW
  // =========================================================

  const handleSubmitReview = async (
    event
  ) => {
    event.preventDefault();

    if (
      !userComment.trim() ||
      !selectedBook
    ) {
      return;
    }

    setIsSubmitting(true);

    const newReview = {
      book_id: String(
        selectedBook.id
      ),

      visitor_id: user?.id
        ? String(user.id)
        : null,

      visitor_name:
        user?.full_name ||
        user?.name ||
        user?.email ||
        'Anonymous Visitor',

      rating: Number(
        userRating
      ),

      comment:
        userComment.trim(),
    };

    const {
      data,
      error,
    } = await supabase
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

    if (
      data &&
      data.length > 0
    ) {
      setReviews(
        (currentReviews) => [
          data[0],
          ...currentReviews,
        ]
      );

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
    searchTerm
      .trim()
      .toLowerCase();

  const filteredBooks =
    books.filter(
      (book) => {
        const title =
          String(
            book.title || ''
          ).toLowerCase();

        const author =
          String(
            book.author || ''
          ).toLowerCase();

        const isbn =
          String(
            book.isbn || ''
          ).toLowerCase();

        const category =
          String(
            book.category || ''
          ).toLowerCase();

        const matchesSearch =
          normalizedSearch === '' ||
          title.includes(
            normalizedSearch
          ) ||
          author.includes(
            normalizedSearch
          ) ||
          isbn.includes(
            normalizedSearch
          ) ||
          category.includes(
            normalizedSearch
          );

        const matchesCategory =
          selectedCategory ===
            'All' ||
          String(
            book.category ||
              'Uncategorized'
          )
            .trim()
            .toLocaleLowerCase() ===
            selectedCategory.toLocaleLowerCase();

        const matchesLibrary =
          libraryFilter
            ? book.libraryId ===
              libraryFilter
            : selectedLibrary ===
                'All' ||
              book.libraryId ===
                selectedLibrary;

        const isAvailable =
          Number(
            book.availableCopies ||
              0
          ) > 0;

        const matchesAvailability =
          selectedAvailability ===
            'All' ||
          (selectedAvailability ===
            'Available' &&
            isAvailable) ||
          (selectedAvailability ===
            'Unavailable' &&
            !isAvailable);

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

  const myRequests =
    borrowRequests
      .filter(
        (request) =>
          String(
            request.visitorId
          ) ===
          String(
            user?.id
          )
      )
      .sort(
        (a, b) =>
          new Date(
            b.requestDate || 0
          ) -
          new Date(
            a.requestDate || 0
          )
      );

  // =========================================================
  // PERSONAL BOOK SEARCH
  // =========================================================

  const filteredPersonalBooks =
    useMemo(() => {
      const term =
        normalizedSearch;

      if (!term) {
        return personalBooks;
      }

      return personalBooks.filter(
        (book) =>
          String(
            book.title || ''
          )
            .toLowerCase()
            .includes(term) ||
          String(
            book.author || ''
          )
            .toLowerCase()
            .includes(term) ||
          String(
            book.category || ''
          )
            .toLowerCase()
            .includes(term) ||
          String(
            book.isbn || ''
          )
            .toLowerCase()
            .includes(term)
      );
    }, [
      personalBooks,
      normalizedSearch,
    ]);

  // =========================================================
  // COMMUNITY BOOK SEARCH
  // =========================================================

  const filteredCommunityBooks =
    useMemo(() => {
      const term =
        normalizedSearch;

      if (!term) {
        return communityBooks;
      }

      return communityBooks.filter(
        (book) =>
          String(
            book.title || ''
          )
            .toLowerCase()
            .includes(term) ||
          String(
            book.author || ''
          )
            .toLowerCase()
            .includes(term) ||
          String(
            book.category || ''
          )
            .toLowerCase()
            .includes(term) ||
          String(
            book.isbn || ''
          )
            .toLowerCase()
            .includes(term)
      );
    }, [
      communityBooks,
      normalizedSearch,
    ]);

  // =========================================================
  // BORROW / RESERVE
  // =========================================================

  const handleBorrowOrReserve =
    async (bookEntry) => {
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

      // Personal books are intentionally not processed
      // by the normal library borrow RPC yet.
      if (
        bookEntry.bookType ===
        'personal'
      ) {
        setNotice(
          'Community book borrowing will be available after the owner approval workflow is enabled.'
        );
        return;
      }

      if (submittingBorrow) {
        return;
      }

      setSubmittingBorrow(true);
      setNotice('');

      try {
        const request =
          await requestBorrow(
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
          rawQueuePosition !==
            null &&
          rawQueuePosition !==
            undefined &&
          rawQueuePosition !== ''
            ? Number(
                rawQueuePosition
              )
            : null;

        if (
          status ===
          'ready_for_pickup'
        ) {
          setNotice(
            `"${bookEntry.title}" is ready for pickup at ${libraryName(
              bookEntry.libraryId
            )}. Please visit within ${PICKUP_WINDOW_HOURS} hours to scan your QR pass.`
          );
        } else if (
          status === 'queued'
        ) {
          if (
            Number.isFinite(
              queuePosition
            )
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
        onViewChange(
          'myBorrows'
        );
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
        setSubmittingBorrow(
          false
        );
      }
    };

  // =========================================================
  // REQUEST COMMUNITY BOOK
  // =========================================================

  const handleRequestCommunityBook = async (book) => {
    if (!book?.id) {
      setNotice('Unable to identify this community book.');
      return;
    }

    if (!user?.id) {
      setNotice('Please log in before requesting a community book.');
      return;
    }

    if (book.bookType !== 'personal') {
      setNotice('This is not a community book.');
      return;
    }

    if (
      book.ownerVisitorId &&
      String(book.ownerVisitorId) === String(user.id)
    ) {
      setNotice('You cannot request your own personal book.');
      return;
    }

    if (book.lendingEnabled === false) {
      setNotice('This community book is not currently available for lending.');
      return;
    }

    if (submittingCommunityRequest) {
      return;
    }

    if (typeof requestCommunityBook !== 'function') {
      setNotice('Community book request service is not available. Please refresh the page and try again.');
      console.error('requestCommunityBook is missing from LibraryContext.');
      return;
    }

    setSubmittingCommunityRequest(true);
    setNotice('');

    try {
      const request = await requestCommunityBook(user.id, book.id);

      if (!request?.id) {
        throw new Error('The community book request was not created. Please try again.');
      }

      setNotice(
        `"${book.title}" request was submitted successfully. The owner must approve your request before borrowing can proceed.`
      );

      setSelectedBook(null);
    } catch (error) {
      console.error('Community book request error:', error);
      setNotice(
        error?.message ||
          'Unable to request this community book. Please try again.'
      );
    } finally {
      setSubmittingCommunityRequest(false);
    }
  };

  // =========================================================
  // OWNER COMMUNITY BOOK REQUEST ACTIONS
  // =========================================================

  const reloadOwnerCommunityRequests = async () => {
    if (!user?.id || typeof fetchOwnerCommunityBookRequests !== 'function') {
      return;
    }

    try {
      const requests = await fetchOwnerCommunityBookRequests(user.id);
      setOwnerCommunityRequests(
        Array.isArray(requests) ? requests : []
      );
    } catch (error) {
      console.error('Reload owner community requests error:', error);
    }
  };

  const handleApproveCommunityRequest = async (request) => {
    if (!request?.id || !user?.id) {
      setNotice('Unable to identify this community book request.');
      return;
    }

    if (processingCommunityRequestId) {
      return;
    }

    if (typeof approveCommunityBookRequest !== 'function') {
      setNotice(
        'Community book approval service is not available. Please refresh the page.'
      );
      return;
    }

    setProcessingCommunityRequestId(request.id);
    setOwnerCommunityRequestError('');
    setCommunityRequestNotice('');

    try {
      const result = await approveCommunityBookRequest(
        request.id,
        user.id,
        null
      );

      if (!result?.id) {
        throw new Error('The community book request could not be approved.');
      }

      setCommunityRequestNotice(
        `Request for "${request.bookTitle}" was approved successfully.`
      );

      await reloadOwnerCommunityRequests();
    } catch (error) {
      console.error('Approve community request error:', error);
      setOwnerCommunityRequestError(
        error?.message ||
          'Unable to approve the community book request. Please try again.'
      );
    } finally {
      setProcessingCommunityRequestId(null);
    }
  };

  const openRejectCommunityRequest = (request) => {
    setShowRejectCommunityRequest(request);
    setCommunityRequestResponse('');
    setCommunityRequestNotice('');
    setOwnerCommunityRequestError('');
  };

  const handleRejectCommunityRequest = async () => {
    const request = showRejectCommunityRequest;

    if (!request?.id || !user?.id) {
      setOwnerCommunityRequestError(
        'Unable to identify this community book request.'
      );
      return;
    }

    if (processingCommunityRequestId) {
      return;
    }

    if (typeof rejectCommunityBookRequest !== 'function') {
      setOwnerCommunityRequestError(
        'Community book rejection service is not available. Please refresh the page.'
      );
      return;
    }

    setProcessingCommunityRequestId(request.id);
    setOwnerCommunityRequestError('');
    setCommunityRequestNotice('');

    try {
      const result = await rejectCommunityBookRequest(
        request.id,
        user.id,
        communityRequestResponse.trim() || null
      );

      if (!result?.id) {
        throw new Error('The community book request could not be rejected.');
      }

      setShowRejectCommunityRequest(null);
      setCommunityRequestResponse('');
      setCommunityRequestNotice(
        `Request for "${request.bookTitle}" was rejected.`
      );

      await reloadOwnerCommunityRequests();
    } catch (error) {
      console.error('Reject community request error:', error);
      setOwnerCommunityRequestError(
        error?.message ||
          'Unable to reject the community book request. Please try again.'
      );
    } finally {
      setProcessingCommunityRequestId(null);
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

    setCancellingRequestId(
      requestId
    );

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
      setCancellingRequestId(
        null
      );
    }
  };

  // =========================================================
  // VIEW LIBRARY MAP
  // =========================================================

  const handleViewMap = (
    libraryId
  ) => {
    const library =
      libraries.find(
        (item) =>
          item.id ===
          libraryId
      );

    if (!library) {
      setNotice(
        'Library location could not be found.'
      );
      return;
    }

    if (
      library.lat === null ||
      library.lat ===
        undefined ||
      library.lng === null ||
      library.lng ===
        undefined
    ) {
      setNotice(
        'GPS coordinates are not available for this library yet.'
      );
      return;
    }

    if (selectedBook) {
      setMapReturnBook(
        selectedBook
      );
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
      setSelectedBook(
        mapReturnBook
      );
    }

    setMapReturnBook(null);
  };

  // =========================================================
  // FIND PARTNER LIBRARY ENTRIES
  // =========================================================

  const getPartnerLibraryEntries =
    (book) => {
      if (!book) {
        return [];
      }

      const normalizedIsbn =
        String(
          book.isbn || ''
        )
          .replace(
            /[^a-z0-9]/gi,
            ''
          )
          .toLowerCase();

      const normalizedTitle =
        String(
          book.title || ''
        )
          .trim()
          .replace(
            /\s+/g,
            ' '
          )
          .toLowerCase();

      const normalizedAuthor =
        String(
          book.author || ''
        )
          .trim()
          .replace(
            /\s+/g,
            ' '
          )
          .toLowerCase();

      return books.filter(
        (entry) => {
          const hasInventory =
            Number(
              entry.totalCopies ||
                0
            ) > 0 &&
            entry.libraryId;

          const entryIsbn =
            String(
              entry.isbn || ''
            )
              .replace(
                /[^a-z0-9]/gi,
                ''
              )
              .toLowerCase();

          const sameBook =
            normalizedIsbn &&
            entryIsbn
              ? normalizedIsbn ===
                entryIsbn
              : normalizedTitle ===
                  String(
                    entry.title ||
                      ''
                  )
                    .trim()
                    .replace(
                      /\s+/g,
                      ' '
                    )
                    .toLowerCase() &&
                normalizedAuthor ===
                  String(
                    entry.author ||
                      ''
                  )
                    .trim()
                    .replace(
                      /\s+/g,
                      ' '
                    )
                    .toLowerCase();

          return (
            hasInventory &&
            sameBook
          );
        }
      );
    };

  // =========================================================
  // PERSONAL BOOK HANDOVER LABEL
  // =========================================================

  const getHandoverMethodLabel = (method) => {
    const labels = {
      arrange_with_owner: 'Arrange with Owner',
      meet_in_person: 'Meet in Person',
      public_place: 'Public Place',
      courier: 'Courier / Delivery',
    };

    return labels[method] || 'Arrange with Owner';
  };

  // =========================================================
  // PERSONAL BOOK CARD
  // =========================================================

  const renderPersonalBookCard =
    (book) => (
      <div
        key={book.id}
        className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
      >
        <div className="p-5">

          <div className="flex items-start justify-between gap-3">

            <div className="min-w-0">

              <div className="flex flex-wrap items-center gap-2 mb-2">

                <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700 px-2 py-1 rounded">
                  Personal Book
                </span>

                {book.lendingEnabled ? (
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 px-2 py-1 rounded">
                    Available for Lending
                  </span>
                ) : (
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-2 py-1 rounded">
                    Not for Lending
                  </span>
                )}

              </div>

              <h3 className="text-base font-bold text-slate-800">
                {book.title ||
                  'Untitled Book'}
              </h3>

              <p className="mt-1 text-xs text-slate-500">
                By{' '}
                {book.author ||
                  'Unknown Author'}
              </p>

            </div>

            <BookOpen
              size={22}
              className="shrink-0 text-slate-400"
              aria-hidden="true"
            />

          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">

            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-slate-400">
                Category
              </p>
              <p className="font-semibold text-slate-700">
                {book.category ||
                  'Uncategorized'}
              </p>
            </div>

            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-slate-400">
                Condition
              </p>
              <p className="font-semibold text-slate-700">
                {book.condition ||
                  'Not specified'}
              </p>
            </div>

            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-slate-400">
                Lending Period
              </p>
              <p className="font-semibold text-slate-700">
                {book.lendingEnabled
                  ? `${book.lendingPeriodDays || 7} days`
                  : 'Not applicable'}
              </p>
            </div>

            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-slate-400">
                ISBN
              </p>
              <p className="font-semibold text-slate-700 font-mono">
                {book.isbn ||
                  'N/A'}
              </p>
            </div>

          </div>

          {book.lendingEnabled && (
            <div className="mt-3 rounded-lg bg-amber-50 border border-amber-100 p-3">

              <div className="flex items-start gap-2">
                <MapPin
                  size={15}
                  className="mt-0.5 shrink-0 text-amber-600"
                  aria-hidden="true"
                />

                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                    Handover Arrangement
                  </p>

                  <p className="mt-0.5 text-xs font-semibold text-slate-700">
                    {getHandoverMethodLabel(
                      book.handoverMethod
                    )}
                  </p>

                  {book.handoverDetails && (
                    <p className="mt-1 text-xs text-slate-600">
                      {book.handoverDetails}
                    </p>
                  )}
                </div>
              </div>

            </div>
          )}

          {book.summary && (
            <div className="mt-3">
              <p className="text-xs text-slate-500 line-clamp-3">
                {book.summary}
              </p>
            </div>
          )}

        </div>
      </div>
    );

  // =========================================================
  // COMMUNITY BOOK CARD
  // =========================================================

  const renderCommunityBookCard =
    (book) => (
      <button
        key={book.id}
        type="button"
        onClick={() =>
          setSelectedBook(book)
        }
        className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden text-left transition hover:-translate-y-0.5 hover:shadow-md"
      >

        <div className="p-5">

          <div className="flex items-start justify-between gap-3">

            <div className="min-w-0">

              <div className="flex flex-wrap gap-2 mb-2">

                <span className="text-[10px] font-bold uppercase tracking-wider bg-violet-100 text-violet-700 px-2 py-1 rounded">
                  Community Book
                </span>

                <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 px-2 py-1 rounded">
                  Lending Enabled
                </span>

              </div>

              <h3 className="font-bold text-slate-800 text-sm line-clamp-2">
                {book.title ||
                  'Untitled Book'}
              </h3>

              <p className="mt-1 text-xs text-slate-500">
                By{' '}
                {book.author ||
                  'Unknown Author'}
              </p>

            </div>

            <Users
              size={22}
              className="shrink-0 text-violet-500"
              aria-hidden="true"
            />

          </div>

          <div className="mt-4 space-y-2">

            <div className="flex items-center justify-between text-xs">

              <span className="text-slate-400">
                Category
              </span>

              <span className="font-semibold text-slate-700">
                {book.category ||
                  'Uncategorized'}
              </span>

            </div>

            <div className="flex items-center justify-between text-xs">

              <span className="text-slate-400">
                Condition
              </span>

              <span className="font-semibold text-slate-700">
                {book.condition ||
                  'Good'}
              </span>

            </div>

            <div className="flex items-center justify-between text-xs">

              <span className="text-slate-400 flex items-center gap-1">
                <Clock3
                  size={12}
                  aria-hidden="true"
                />
                Lending period
              </span>

              <span className="font-semibold text-slate-700">
                {book.lendingPeriodDays ||
                  7}{' '}
                days
              </span>

            </div>

          </div>

          {(book.handoverMethod ||
            book.handoverDetails) && (
            <div className="mt-4 rounded-lg bg-slate-50 p-3">

              <div className="flex items-start gap-2">

                <MapPin
                  size={14}
                  className="mt-0.5 shrink-0 text-slate-400"
                  aria-hidden="true"
                />

                <div>

                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                    Handover Arrangement
                  </p>

                  <p className="text-xs font-semibold text-slate-700 mt-0.5">
                    {getHandoverMethodLabel(
                      book.handoverMethod
                    )}
                  </p>

                  {book.handoverDetails && (
                    <p className="text-xs text-slate-600 mt-1">
                      {book.handoverDetails}
                    </p>
                  )}

                </div>

              </div>

            </div>
          )}

          <div className="mt-4 rounded-lg bg-violet-50 border border-violet-100 px-3 py-2">

            <p className="text-[11px] text-violet-700 font-semibold">
              Borrowing requires owner approval.
            </p>

          </div>

        </div>

      </button>
    );

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
            onClick={() =>
              setNotice('')
            }
            className="font-bold text-blue-400 hover:text-blue-700"
            aria-label="Close notification"
          >
            <X
              size={16}
              aria-hidden="true"
            />
          </button>

        </div>
      )}

      {/* =====================================================
          COMMON SEARCH
      ====================================================== */}

      {(
        activeView ===
          'communityBooks' ||
        activeView ===
          'personalBooks'
      ) && (
        <div className="flex flex-col sm:flex-row gap-3">

          <form
            onSubmit={handleSearch}
            className="flex flex-1 gap-2"
          >

            <input
              type="text"
              placeholder={
                activeView ===
                'communityBooks'
                  ? 'Search community books...'
                  : 'Search your personal books...'
              }
              value={searchInput}
              onChange={
                handleSearchInputChange
              }
              className="flex-1 px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
            />

            <button
              type="submit"
              className="px-5 py-2.5 bg-[#002046] text-white rounded-lg text-sm font-bold hover:opacity-90"
            >
              Search
            </button>

          </form>

          {searchTerm && (
            <button
              type="button"
              onClick={
                handleClearSearch
              }
              className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-lg text-sm font-bold hover:bg-slate-200"
            >
              Clear
            </button>
          )}

        </div>
      )}

      {/* =====================================================
          CATALOG
      ====================================================== */}

      {activeView ===
      'catalog' ? (
        <div className="space-y-6">

          {/* MAP DISPLAY */}

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
                  onClick={
                    handleCloseMap
                  }
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

          {/* SEARCH & FILTERS */}

          <div className="flex flex-col md:flex-row gap-3 flex-wrap">

            <form
              onSubmit={
                handleSearch
              }
              className="flex flex-1 min-w-[280px] gap-2"
            >

              <input
                type="text"
                placeholder="Search by Title, Author, ISBN, or Category..."
                value={searchInput}
                onChange={
                  handleSearchInputChange
                }
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
                onClick={
                  handleClearSearch
                }
                className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-lg text-sm font-bold hover:bg-slate-200 transition"
              >
                Clear
              </button>
            )}

            {!libraryFilter && (
              <select
                value={
                  selectedLibrary
                }
                onChange={(
                  event
                ) =>
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
                    (
                      libraryId
                    ) =>
                      libraryId !==
                      'All'
                  )
                  .map(
                    (
                      libraryId
                    ) => (
                      <option
                        key={
                          libraryId
                        }
                        value={
                          libraryId
                        }
                      >
                        {libraryName(
                          libraryId
                        )}
                      </option>
                    )
                  )}

              </select>
            )}

            <select
              value={
                selectedAvailability
              }
              onChange={(
                event
              ) =>
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

          {/* SEARCH INFO */}

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
                {filteredBooks.length ===
                1
                  ? 'book'
                  : 'books'}{' '}
                found
              </span>

            </div>
          )}

          {/* CATEGORY HEADER */}

          {selectedCategory !==
            'All' && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">

              <div>

                <h2 className="text-base font-bold text-slate-800">
                  Books in{' '}
                  {selectedCategory}
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  {filteredBooks.length}{' '}
                  catalog{' '}
                  {filteredBooks.length ===
                  1
                    ? 'entry'
                    : 'entries'}
                </p>

              </div>

              <button
                type="button"
                onClick={() =>
                  setSelectedCategory(
                    'All'
                  )
                }
                className="text-xs font-semibold text-[#002046] hover:underline"
              >
                Clear category
              </button>

            </div>
          )}

          {/* BOOK RESULTS */}

          {books.length ===
          0 ? (
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
                This catalog is
                being prepared.
                Explore nearby
                branches while
                new titles are
                added.
              </p>

              <button
                type="button"
                onClick={() =>
                  onViewChange?.(
                    'map'
                  )
                }
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-amber-400"
              >

                <MapPinned
                  size={16}
                  aria-hidden="true"
                />

                Explore library
                locations

              </button>

            </div>
          ) : filteredBooks.length ===
            0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center">

              <Search
                size={28}
                className="mx-auto text-slate-400"
                aria-hidden="true"
              />

              <h3 className="mt-3 text-base font-bold text-slate-800">
                Nothing on the
                shelf matched
                that search.
              </h3>

              <p className="mt-1 text-sm text-slate-500">
                Try another title
                or clear your
                filters to see
                more books.
              </p>

              <button
                type="button"
                onClick={() => {
                  handleClearSearch();
                  setSelectedCategory(
                    'All'
                  );
                  setSelectedLibrary(
                    'All'
                  );
                  setSelectedAvailability(
                    'All'
                  );
                }}
                className="mt-4 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 transition hover:bg-amber-400"
              >
                Clear All Filters
              </button>

            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

              {filteredBooks.map(
                (book) => (
                  <button
                    type="button"
                    key={
                      book.id
                    }
                    onClick={() =>
                      setSelectedBook(
                        book
                      )
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
                        onError={(
                          event
                        ) => {
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
                                book.availableCopies ||
                                  0
                              ) >
                              0
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {Number(
                              book.availableCopies ||
                                0
                            ) >
                            0
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
      ) : activeView ===
        'categories' ? (
        /* =====================================================
           CATEGORIES
        ====================================================== */

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
              Unique titles across
              participating libraries
            </p>

          </div>

          {categorySummaries.length ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">

              {categorySummaries.map(
                ({
                  label,
                  count,
                }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      setSelectedCategory(
                        label
                      );
                      setSearchInput(
                        ''
                      );
                      setSearchTerm(
                        ''
                      );
                      setSelectedLibrary(
                        'All'
                      );
                      setSelectedAvailability(
                        'All'
                      );
                      onViewChange(
                        'catalog'
                      );
                    }}
                    className="flex min-h-16 items-center justify-between gap-3 border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-[#002046] hover:bg-blue-50"
                  >

                    <span className="min-w-0 text-sm font-semibold text-slate-700">
                      {label}
                    </span>

                    <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                      {count}{' '}
                      {count ===
                      1
                        ? 'book'
                        : 'books'}
                    </span>

                  </button>
                )
              )}

            </div>
          ) : (
            <p className="border border-dashed border-slate-300 px-4 py-5 text-center text-sm text-slate-500">
              No book categories are
              available yet.
            </p>
          )}

        </section>
      ) : activeView ===
        'communityBooks' ? (
        /* =====================================================
           COMMUNITY BOOKS
        ====================================================== */

        <section className="space-y-5">

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">

            <div>

              <div className="flex items-center gap-2">

                <Users
                  size={20}
                  className="text-violet-600"
                  aria-hidden="true"
                />

                <h2 className="text-lg font-bold text-slate-800">
                  Community Books
                </h2>

              </div>

              <p className="mt-1 text-xs text-slate-500">
                Books shared by SHELF
                visitors for community
                lending.
              </p>

            </div>

          </div>

          {communityBookError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
              {communityBookError}
            </div>
          )}

          {loadingCommunityBooks ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">

              <p className="text-sm text-slate-500">
                Loading community
                books...
              </p>

            </div>
          ) : filteredCommunityBooks.length ===
            0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">

              <Users
                size={32}
                className="mx-auto text-slate-300"
                aria-hidden="true"
              />

              <h3 className="mt-3 text-base font-bold text-slate-700">
                No community books
                available yet.
              </h3>

              <p className="mt-1 text-xs text-slate-500">
                When visitors share
                books for lending,
                they will appear
                here.
              </p>

            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">

              {filteredCommunityBooks.map(
                renderCommunityBookCard
              )}

            </div>
          )}

        </section>
      ) : activeView ===
        'personalBooks' ? (
        /* =====================================================
           MY PERSONAL BOOKS
        ====================================================== */

        <section className="space-y-5">

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">

            <div>

              <div className="flex items-center gap-2">

                <UserRound
                  size={20}
                  className="text-blue-600"
                  aria-hidden="true"
                />

                <h2 className="text-lg font-bold text-slate-800">
                  My Personal Books
                </h2>

              </div>

              <p className="mt-1 text-xs text-slate-500">
                Manage books that you
                personally own and
                optionally share with
                the SHELF community.
              </p>

            </div>

            <button
              type="button"
              onClick={() => {
                resetPersonalBookForm();
                setShowAddPersonalBook(
                  true
                );
              }}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#002046] px-4 py-2.5 text-sm font-bold text-white hover:opacity-90"
            >

              <Plus
                size={16}
                aria-hidden="true"
              />

              Add Personal Book

            </button>

          </div>

          {/* =====================================================
              COMMUNITY BOOK REQUESTS FOR THIS OWNER
          ====================================================== */}

          <div className="rounded-xl border border-violet-200 bg-white shadow-sm overflow-hidden">

            <div className="px-5 py-4 border-b border-violet-100 bg-violet-50">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-violet-900">
                    Community Book Requests
                  </h3>
                  <p className="mt-1 text-xs text-violet-700">
                    Review requests from visitors who want to borrow your personal books.
                  </p>
                </div>

                {ownerCommunityRequests.length > 0 && (
                  <span className="shrink-0 rounded-full bg-violet-600 px-2.5 py-1 text-[11px] font-bold text-white">
                    {ownerCommunityRequests.length}
                  </span>
                )}
              </div>
            </div>

            {ownerCommunityRequestError && (
              <div className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                {ownerCommunityRequestError}
              </div>
            )}

            {communityRequestNotice && (
              <div className="mx-5 mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">
                {communityRequestNotice}
              </div>
            )}

            {loadingOwnerCommunityRequests ? (
              <div className="p-6 text-center">
                <p className="text-xs text-slate-500">
                  Loading community book requests...
                </p>
              </div>
            ) : ownerCommunityRequests.length === 0 ? (
              <div className="p-6 text-center">
                <Users size={28} className="mx-auto text-slate-300" aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold text-slate-600">
                  No community book requests yet.
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Requests from other visitors will appear here when they ask to borrow one of your books.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {ownerCommunityRequests.map((request) => {
                  const status = String(request.status || '').toLowerCase();
                  const isPending = status === 'pending';
                  const isProcessing = processingCommunityRequestId === request.id;

                  return (
                    <div key={request.id} className="p-5">
                      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-violet-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-700">
                              Community Request
                            </span>
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                              status === 'approved'
                                ? 'bg-emerald-100 text-emerald-700'
                                : status === 'rejected'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-amber-100 text-amber-700'
                            }`}>
                              {status === 'approved'
                                ? 'Approved'
                                : status === 'rejected'
                                  ? 'Rejected'
                                  : 'Pending'}
                            </span>
                          </div>

                          <h4 className="mt-2 text-sm font-bold text-slate-800">
                            {request.bookTitle || 'Untitled Book'}
                          </h4>

                          <p className="mt-1 text-xs text-slate-500">
                            Requested by <span className="font-semibold text-slate-700">{request.requesterName || 'SHELF Visitor'}</span>
                          </p>

                          <p className="mt-1 text-[11px] text-slate-400">
                            Requested: {formatDateTime(request.requestDate)}
                          </p>

                          {request.ownerResponse && (
                            <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Owner response
                              </p>
                              <p className="mt-1 text-xs text-slate-600">
                                {request.ownerResponse}
                              </p>
                            </div>
                          )}
                        </div>

                        {isPending && (
                          <div className="flex flex-col sm:flex-row gap-2 lg:min-w-[230px] lg:justify-end">
                            <button
                              type="button"
                              disabled={Boolean(processingCommunityRequestId)}
                              onClick={() => handleApproveCommunityRequest(request)}
                              className="rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isProcessing ? 'Processing...' : 'Approve Request'}
                            </button>

                            <button
                              type="button"
                              disabled={Boolean(processingCommunityRequestId)}
                              onClick={() => openRejectCommunityRequest(request)}
                              className="rounded-lg bg-red-50 px-4 py-2.5 text-xs font-bold text-red-600 hover:bg-red-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Reject Request
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

          </div>

          {personalBookError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
              {personalBookError}
            </div>
          )}

          {loadingPersonalBooks ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">

              <p className="text-sm text-slate-500">
                Loading your personal
                books...
              </p>

            </div>
          ) : filteredPersonalBooks.length ===
            0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">

              <UserRound
                size={32}
                className="mx-auto text-slate-300"
                aria-hidden="true"
              />

              <h3 className="mt-3 text-base font-bold text-slate-700">
                You have no personal
                books yet.
              </h3>

              <p className="mt-1 text-xs text-slate-500">
                Add a book that you
                personally own to keep
                it in your SHELF
                collection.
              </p>

              <button
                type="button"
                onClick={() => {
                  resetPersonalBookForm();
                  setShowAddPersonalBook(
                    true
                  );
                }}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
              >

                <Plus
                  size={15}
                  aria-hidden="true"
                />

                Add Your First Book

              </button>

            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

              {filteredPersonalBooks.map(
                renderPersonalBookCard
              )}

            </div>
          )}

        </section>
      ) : (
        /* =====================================================
           MY REQUESTS
        ====================================================== */

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">

          {myRequests.length ===
          0 ? (
            <p className="p-6 text-sm text-slate-500">
              You have no borrow
              requests yet. Browse
              the catalog to get
              started.
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
                      currentFine >
                        0;

                    const overdueDays =
                      request.dueDate &&
                      isOverdue
                        ? calculateOverdueDays(
                            request.dueDate
                          )
                        : 0;

                    const canCancel =
                      [
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
                        key={
                          request.id
                        }
                        className="hover:bg-slate-50"
                      >

                        <td className="p-4 font-bold text-slate-800">
                          {
                            request.bookTitle
                          }
                        </td>

                        <td className="p-4">

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

                        </td>

                        <td className="p-4 text-xs text-slate-500 space-y-0.5">

                          {request.status ===
                            'queued' && (
                            <p>
                              Queue
                              position:{' '}
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
                            <>
                              <p className="font-semibold text-amber-700">
                                Ready for
                                pickup.
                              </p>

                              <p>
                                Pick up
                                by:{' '}
                                {formatDateTime(
                                  request.pickupDeadline
                                )}
                              </p>

                              <p>
                                Please
                                scan
                                your QR
                                pass at
                                the
                                library.
                              </p>
                            </>
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
                                  Overdue
                                  by{' '}
                                  {
                                    overdueDays
                                  }{' '}
                                  day
                                  {overdueDays !==
                                  1
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
                            currentFine >
                            0
                              ? 'text-red-600'
                              : 'text-slate-500'
                          }`}
                        >
                          ₱
                          {currentFine.toFixed(
                            2
                          )}
                        </td>

                        <td className="p-4 text-right">

                          {canCancel && (
                            <button
                              type="button"
                              disabled={Boolean(
                                cancellingRequestId
                              )}
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
          REJECT COMMUNITY REQUEST MODAL
      ====================================================== */}

      {showRejectCommunityRequest && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-200">
            <div className="px-6 py-5 border-b border-slate-200 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-800">
                  Reject Community Book Request
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {showRejectCommunityRequest.bookTitle || 'Community Book'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!processingCommunityRequestId) {
                    setShowRejectCommunityRequest(null);
                    setCommunityRequestResponse('');
                  }
                }}
                className="text-slate-400 hover:text-slate-700"
                aria-label="Close reject request dialog"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Reason / Response (Optional)
                </label>
                <textarea
                  value={communityRequestResponse}
                  onChange={(event) => setCommunityRequestResponse(event.target.value)}
                  maxLength={500}
                  rows={4}
                  placeholder="Add a short message for the requester."
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20 resize-none"
                />
                <p className="mt-1 text-[10px] text-slate-400 text-right">
                  {communityRequestResponse.length}/500
                </p>
              </div>

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
                <button
                  type="button"
                  disabled={Boolean(processingCommunityRequestId)}
                  onClick={() => {
                    setShowRejectCommunityRequest(null);
                    setCommunityRequestResponse('');
                  }}
                  className="px-4 py-2.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={Boolean(processingCommunityRequestId)}
                  onClick={handleRejectCommunityRequest}
                  className="px-4 py-2.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {processingCommunityRequestId ? 'Rejecting...' : 'Confirm Rejection'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================
          ADD PERSONAL BOOK MODAL
      ====================================================== */}

      {showAddPersonalBook && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">

          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl border border-slate-200">

            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">

              <div>

                <h2 className="text-lg font-bold text-slate-800">
                  Add Personal Book
                </h2>

                <p className="text-xs text-slate-500 mt-1">
                  Add a book that you
                  personally own.
                </p>

              </div>

              <button
                type="button"
                onClick={() => {
                  if (
                    addingPersonalBook
                  ) {
                    return;
                  }

                  setShowAddPersonalBook(
                    false
                  );
                  resetPersonalBookForm();
                }}
                className="text-slate-400 hover:text-slate-700"
                aria-label="Close add personal book form"
              >
                <X
                  size={20}
                  aria-hidden="true"
                />
              </button>

            </div>

            <form
              onSubmit={
                handleAddPersonalBook
              }
              className="p-6 space-y-5"
            >

              {/* BASIC INFORMATION */}

              <div className="space-y-4">

                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Book Information
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                  <div className="md:col-span-2">

                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Book Title *
                    </label>

                    <input
                      type="text"
                      value={
                        personalBookForm.title
                      }
                      onChange={(
                        event
                      ) =>
                        updatePersonalBookForm(
                          'title',
                          event.target
                            .value
                        )
                      }
                      placeholder="Enter book title"
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                      required
                    />

                  </div>

                  <div>

                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Author *
                    </label>

                    <input
                      type="text"
                      value={
                        personalBookForm.author
                      }
                      onChange={(
                        event
                      ) =>
                        updatePersonalBookForm(
                          'author',
                          event.target
                            .value
                        )
                      }
                      placeholder="Author name"
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                      required
                    />

                  </div>

                  <div>
  <label className="block text-xs font-bold text-slate-700 mb-1.5">
    Category
  </label>

  <select
    value={personalBookForm.category || ''}
    onChange={(event) => {
      console.log('CATEGORY SELECTED:', event.target.value);
      updatePersonalBookForm('category', event.target.value);
    }}
    style={{
      width: '100%',
      padding: '10px 12px',
      border: '1px solid #cbd5e1',
      borderRadius: '8px',
      backgroundColor: '#ffffff',
      color: '#0f172a',
      cursor: 'pointer',
    }}
  >
    <option value="">Select a category</option>
    <option value="Fiction">Fiction</option>
    <option value="Non-Fiction">Non-Fiction</option>
    <option value="Academic">Academic</option>
    <option value="Computer Science">Computer Science</option>
    <option value="Engineering">Engineering</option>
    <option value="Education">Education</option>
    <option value="Business">Business</option>
    <option value="Science">Science</option>
    <option value="Mathematics">Mathematics</option>
    <option value="History">History</option>
    <option value="Literature">Literature</option>
    <option value="Arts">Arts</option>
    <option value="Social Sciences">Social Sciences</option>
    <option value="Reference">Reference</option>
    <option value="Other">Other</option>
  </select>
</div>
                  <div>

                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      ISBN
                    </label>

                    <input
                      type="text"
                      value={
                        personalBookForm.isbn
                      }
                      onChange={(
                        event
                      ) =>
                        updatePersonalBookForm(
                          'isbn',
                          event.target
                            .value
                        )
                      }
                      placeholder="Optional ISBN"
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                    />

                  </div>

                  <div>

                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Condition *
                    </label>

                    <select
                      value={
                        personalBookForm.condition
                      }
                      onChange={(
                        event
                      ) =>
                        updatePersonalBookForm(
                          'condition',
                          event.target
                            .value
                        )
                      }
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                      required
                    >

                      {PERSONAL_BOOK_CONDITIONS.map(
                        (
                          condition
                        ) => (
                          <option
                            key={
                              condition
                            }
                            value={
                              condition
                            }
                          >
                            {condition}
                          </option>
                        )
                      )}

                    </select>

                  </div>

                  <div className="md:col-span-2">

                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Summary
                    </label>

                    <textarea
                      value={
                        personalBookForm.summary
                      }
                      onChange={(
                        event
                      ) =>
                        updatePersonalBookForm(
                          'summary',
                          event.target
                            .value
                        )
                      }
                      placeholder="Brief description of the book"
                      rows={3}
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20 resize-none"
                    />

                  </div>

                </div>

              </div>

              {/* LENDING */}

              <div className="border-t border-slate-200 pt-5 space-y-4">

                <div>

                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Community Lending
                  </h3>

                  <p className="text-[11px] text-slate-400 mt-1">
                    Choose whether other SHELF
                    visitors may request this
                    book.
                  </p>

                </div>

                <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 cursor-pointer">

                  <input
                    type="checkbox"
                    checked={
                      personalBookForm.lendingEnabled
                    }
                    onChange={(
                      event
                    ) =>
                      updatePersonalBookForm(
                        'lendingEnabled',
                        event.target
                          .checked
                      )
                    }
                    className="mt-0.5"
                  />

                  <div>

                    <p className="text-sm font-bold text-slate-700">
                      Make this book available
                      for community lending
                    </p>

                    <p className="text-xs text-slate-500 mt-1">
                      Other visitors may see
                      this book in Community
                      Books. Actual borrowing
                      will require owner
                      approval.
                    </p>

                  </div>

                </label>

                {personalBookForm.lendingEnabled && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                    <div>

                      <label className="block text-xs font-bold text-slate-700 mb-1.5">
                        Lending Period *
                      </label>

                      <div className="relative">

                        <input
                          type="number"
                          min={
                            PERSONAL_BOOK_MIN_LENDING_DAYS
                          }
                          max={
                            PERSONAL_BOOK_MAX_LENDING_DAYS
                          }
                          value={
                            personalBookForm.lendingPeriodDays
                          }
                          onChange={(
                            event
                          ) =>
                            updatePersonalBookForm(
                              'lendingPeriodDays',
                              event.target
                                .value
                            )
                          }
                          className="w-full px-3 py-2.5 pr-16 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                          required
                        />

                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                          days
                        </span>

                      </div>

                      <p className="text-[10px] text-slate-400 mt-1">
                        Allowed: 1–30 days
                      </p>

                    </div>

                    <div>

                      <label className="block text-xs font-bold text-slate-700 mb-1.5">
                        Handover Method *
                      </label>

                      <select
                        value={
                          personalBookForm.handoverMethod
                        }
                        onChange={(event) =>
                          updatePersonalBookForm(
                            'handoverMethod',
                            event.target.value
                          )
                        }
                        className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
                        required={
                          personalBookForm.lendingEnabled
                        }
                      >
                        <option value="arrange_with_owner">
                          Arrange with Owner
                        </option>
                        <option value="meet_in_person">
                          Meet in Person
                        </option>
                        <option value="public_place">
                          Public Place
                        </option>
                        <option value="courier">
                          Courier / Delivery
                        </option>
                      </select>

                    </div>

                    <div className="md:col-span-2">

                      <label className="block text-xs font-bold text-slate-700 mb-1.5">
                        Handover Details
                      </label>

                      <textarea
                        value={
                          personalBookForm.handoverDetails
                        }
                        onChange={(event) =>
                          updatePersonalBookForm(
                            'handoverDetails',
                            event.target.value
                          )
                        }
                        placeholder="Add instructions or details for arranging the handover."
                        maxLength={500}
                        rows={3}
                        className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20 resize-none"
                      />

                      <p className="text-[10px] text-slate-400 mt-1">
                        Optional, maximum 500 characters. Handover is arranged directly between users, not through a library.
                      </p>

                    </div>

                  </div>
                )}

              </div>

              {/* INFORMATION NOTICE */}

              <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3">

                <p className="text-xs font-bold text-violet-800">
                  Community lending note
                </p>

                <p className="mt-1 text-[11px] leading-relaxed text-violet-700">
                  Your personal book will remain
                  owned by you. If you enable
                  lending, other visitors can see
                  the book in Community Books.
                  Borrowing will use an owner
                  approval workflow once that
                  feature is enabled.
                </p>

              </div>

              {/* ACTIONS */}

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">

                <button
                  type="button"
                  disabled={
                    addingPersonalBook
                  }
                  onClick={() => {
                    setShowAddPersonalBook(
                      false
                    );
                    resetPersonalBookForm();
                  }}
                  className="px-4 py-2.5 rounded-lg bg-slate-100 text-slate-600 text-sm font-bold hover:bg-slate-200 disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={
                    addingPersonalBook
                  }
                  className="px-5 py-2.5 rounded-lg bg-[#002046] text-white text-sm font-bold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {addingPersonalBook
                    ? 'Adding Book...'
                    : 'Add Personal Book'}
                </button>

              </div>

            </form>

          </div>

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
                setSelectedBook(
                  null
                )
              }
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 font-bold"
              aria-label="Close book information"
            >
              <X
                size={18}
                aria-hidden="true"
              />
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
                onError={(
                  event
                ) => {
                  event.currentTarget.src =
                    'https://placehold.co/96x128?text=No+Cover';
                }}
              />

              <div className="space-y-1">

                <div className="flex flex-wrap gap-2">

                  {selectedBook.bookType ===
                  'personal' ? (
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-violet-100 text-violet-700 px-2 py-0.5 rounded">
                      Community Book
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                      Library Book
                    </span>
                  )}

                  {selectedBook.condition && (
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                      {selectedBook.condition}
                    </span>
                  )}

                </div>

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

            {/* PERSONAL BOOK DETAILS */}

            {selectedBook.bookType ===
              'personal' && (
              <div className="rounded-lg border border-violet-100 bg-violet-50 p-4 space-y-3">

                <h4 className="text-xs font-bold uppercase tracking-wider text-violet-800">
                  Community Lending
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

                  <div>

                    <p className="text-[10px] text-violet-500 uppercase font-bold">
                      Condition
                    </p>

                    <p className="text-xs font-semibold text-slate-700">
                      {selectedBook.condition ||
                        'Good'}
                    </p>

                  </div>

                  <div>

                    <p className="text-[10px] text-violet-500 uppercase font-bold">
                      Lending Period
                    </p>

                    <p className="text-xs font-semibold text-slate-700">
                      {selectedBook.lendingPeriodDays ||
                        7}{' '}
                      days
                    </p>

                  </div>

                  <div className="sm:col-span-2">

                    <p className="text-[10px] text-violet-500 uppercase font-bold">
                      Handover Arrangement
                    </p>

                    <p className="text-xs font-semibold text-slate-700">
                      {getHandoverMethodLabel(
                        selectedBook.handoverMethod
                      )}
                    </p>

                    {selectedBook.handoverDetails && (
                      <p className="mt-1 text-xs text-slate-600">
                        {selectedBook.handoverDetails}
                      </p>
                    )}

                  </div>

                </div>

                <div className="rounded-lg bg-white border border-violet-100 px-3 py-2">

                  <p className="text-[11px] font-semibold text-violet-700">
                    Owner approval is required
                    before this personal book can
                    be borrowed.
                  </p>

                </div>

              </div>
            )}

            {/* SUMMARY */}

            <div className="space-y-1 bg-slate-50 p-3 rounded-lg border border-slate-100">

              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Book Summary
              </h4>

              <p className="text-xs text-slate-600 leading-relaxed">
                {selectedBook.summary ||
                  'No summary provided yet.'}
              </p>

            </div>

            {/* LIBRARY LOCATIONS FOR REGULAR BOOKS */}

            {selectedBook.bookType !==
              'personal' && (
              <div className="space-y-3 pt-2">

                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Available Library Locations:
                </h4>

                <div className="space-y-2">

                  {getPartnerLibraryEntries(
                    selectedBook
                  ).length ===
                  0 ? (
                    <p className="text-xs text-slate-500">
                      No libraries currently
                      have this book in
                      inventory.
                    </p>
                  ) : (
                    getPartnerLibraryEntries(
                      selectedBook
                    ).map(
                      (
                        entry
                      ) => (
                        <div
                          key={
                            entry.id
                          }
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
                                entry.availableCopies ||
                                  0
                              ) >
                              0
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
                                    ) >
                                    0
                                  ? 'Borrow'
                                  : 'Reserve'}
                            </button>

                          </div>

                        </div>
                      )
                    )
                  )}

                </div>

              </div>
            )}

            {/* =====================================================
    COMMUNITY BOOK ACTION
====================================================== */}

{selectedBook?.bookType === 'personal' && (
  <div className="border-t border-slate-200 pt-4 space-y-3">
    <button
      type="button"
      onClick={() => handleRequestCommunityBook(selectedBook)}
      disabled={submittingCommunityRequest}
      className="w-full rounded-lg bg-violet-600 text-white py-2.5 text-sm font-bold hover:bg-violet-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {submittingCommunityRequest
        ? 'Submitting Request...'
        : 'Request Community Book'}
    </button>

    {selectedBook.ownerVisitorId &&
    String(selectedBook.ownerVisitorId) === String(user?.id) ? (
      <p className="text-xs text-amber-600 text-center">
        You own this book. You cannot request your own personal book.
      </p>
    ) : selectedBook.lendingEnabled === false ? (
      <p className="text-xs text-slate-500 text-center">
        This book is not currently available for community lending.
      </p>
    ) : (
      <p className="text-[10px] text-slate-400 text-center">
        Your request will be sent to the book owner for approval.
      </p>
    )}
  </div>
)}

            {/* RATINGS & REVIEWS */}

            <div className="pt-4 border-t border-slate-200 space-y-4">

              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">

                <span>
                  ⭐ Ratings & Reviews
                </span>

                <span className="text-slate-400 normal-case font-normal">
                  ({reviews.length}{' '}
                  {reviews.length ===
                  1
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
                      value={
                        userRating
                      }
                      onChange={(
                        event
                      ) =>
                        setUserRating(
                          Number(
                            event
                              .target
                              .value
                          )
                        )
                      }
                      className="text-xs bg-white border border-slate-300 rounded px-2 py-1 font-bold text-amber-600 focus:outline-none"
                    >

                      <option value="5">
                        ⭐⭐⭐⭐⭐
                        {' '}
                        (5/5)
                      </option>

                      <option value="4">
                        ⭐⭐⭐⭐
                        {' '}
                        (4/5)
                      </option>

                      <option value="3">
                        ⭐⭐⭐
                        {' '}
                        (3/5)
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
                  value={
                    userComment
                  }
                  onChange={(
                    event
                  ) =>
                    setUserComment(
                      event.target
                        .value
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
                    disabled={
                      isSubmitting
                    }
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
                ) : reviews.length ===
                  0 ? (
                  <p className="text-xs text-slate-400 italic">
                    No reviews yet for
                    this book. Be the
                    first to leave a
                    review!
                  </p>
                ) : (
                  reviews.map(
                    (
                      review
                    ) => (
                      <div
                        key={
                          review.id
                        }
                        className="p-3 bg-white rounded-lg border border-slate-100 shadow-sm text-xs space-y-1"
                      >

                        <div className="flex justify-between items-center gap-3">

                          <span className="font-bold text-slate-800">
                            {
                              review.visitor_name
                            }
                          </span>

                          <span className="text-amber-500 font-bold">
                            {'⭐'.repeat(
                              Math.max(
                                0,
                                Math.min(
                                  5,
                                  Number(
                                    review.rating
                                  ) ||
                                    0
                                )
                              )
                            )}
                          </span>

                        </div>

                        <p className="text-slate-600">
                          {
                            review.comment
                          }
                        </p>

                        <p className="text-[10px] text-slate-400">
                          {formatDate(
                            review.created_at
                          )}
                        </p>

                      </div>
                    )
                  )
                )}

              </div>

            </div>

            {/* FOOTER */}

            <p className="text-[11px] text-slate-400 pt-2 border-t border-slate-100">

              {selectedBook.bookType ===
              'personal' ? (
                <>
                  This is a community-owned
                  book. Borrowing requires
                  owner approval.
                </>
              ) : (
                <>
                  Borrowed items are due{' '}
                  {
                    BORROW_PERIOD_DAYS
                  }{' '}
                  days after pickup.
                  Holds must be picked up
                  within{' '}
                  {
                    PICKUP_WINDOW_HOURS
                  }{' '}
                  hours or they're released
                  automatically. Overdue
                  books are charged ₱10 per
                  overdue day.
                </>
              )}

            </p>

          </div>

        </div>
      )}

    </div>
  );
}
