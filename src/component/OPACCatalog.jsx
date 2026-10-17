import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';
import {
  BookOpen,
  Bookmark,
  ClipboardList,
  HandHeart,
  Eye,
  EyeOff,
  MapPinned,
  Search,
  X,
  Plus,
  UserRound,
  Users,
  Clock3,
  MapPin,
  Star,
  Lock,
} from 'lucide-react';
import {
  useLibrary,
  useLibraryData,
} from '../context/useLibrary.js';
import LibraryMap from './LibraryMap.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { recordVisitorSearch } from '../lib/recommendationEngine.js';
import { fetchReadingList, toggleReadingList } from '../services/shelf.js';

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
  queued: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200',
  ready_for_pickup: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
  borrowed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200',
  returned: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
  expired: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
};
const STATUS_LABELS = {
  queued: 'In Queue',
  ready_for_pickup: 'Ready for Pickup',
  borrowed: 'Borrowed',
  returned: 'Returned',
  cancelled: 'Cancelled',
  expired: 'Expired (Not Picked Up)',
};
const OWNER_COMMUNITY_REQUEST_FILTERS = [
  { key: 'all', label: 'All requests' },
  { key: 'pending', label: 'Pending approval', status: 'pending' },
  { key: 'to-confirm', label: 'To confirm', status: 'approved' },
  { key: 'borrowed', label: 'Borrowed', status: 'borrowed' },
  { key: 'rejected', label: 'Rejected', status: 'rejected' },
  { key: 'returned', label: 'Returned', status: 'returned' },
  { key: 'cancelled', label: 'Cancelled', status: 'cancelled' },
];
function getOwnerCommunityRequestStatus(request) {
  return String(request?.status ?? '')
    .trim()
    .toLowerCase();
}
function getPersonalBookCopyAvailability(book) {
  const totalCopiesValue = Number(book?.totalCopies);
  const totalCopies =
    Number.isInteger(totalCopiesValue) && totalCopiesValue > 0
      ? totalCopiesValue
      : 1;
  const availableCopiesValue =
    book?.availableCopies == null
      ? totalCopies
      : Number(book.availableCopies);
  const availableCopies = Number.isFinite(availableCopiesValue)
    ? Math.min(
        totalCopies,
        Math.max(0, Math.trunc(availableCopiesValue))
      )
    : totalCopies;
  return {
    totalCopies,
    availableCopies,
    borrowedCopies: totalCopies - availableCopies,
  };
}
function getPersonalBookAvailabilityLabel(book) {
  const {
    totalCopies,
    availableCopies,
    borrowedCopies,
  } = getPersonalBookCopyAvailability(book);
  if (availableCopies === 0) {
    return 'Unavailable';
  }
  if (borrowedCopies > 0) {
    return `${availableCopies} of ${totalCopies} available · ${borrowedCopies} borrowed`;
  }
  return `${totalCopies} ${totalCopies === 1 ? 'copy' : 'copies'} available`;
}

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
// OPAC CATALOG COMPONENT
// =========================================================
export default function OPACCatalog({
  libraryFilter = null,
  activeView = 'catalog',
  onViewChange = () => {},
  catalogResetKey = 0,
  focusRequestId = null,
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const {
    books = [],
    externalCatalogBooks = [],
    borrowRequests = [],
    libraries = [],
    personalBooks = [],
    communityBooks = [],
    myCommunityBookRequests = [],
    ownerCommunityBookRequests = [],
    ownerCommunityRequestLoadError = '',
  } = useLibraryData();
  const {
    requestBorrow,
    cancelBorrowRequest,
    addPersonalBook,
    setPersonalBookVisibility,
    updatePersonalBook,
    deletePersonalBook,
    requestCommunityBook,
    fetchOwnerCommunityBookRequests,
    approveCommunityBookRequest,
    rejectCommunityBookRequest,
    confirmCommunityBookPickup,
    confirmCommunityBookReturn,
    loading: libraryLoading,
    PICKUP_WINDOW_HOURS,
    BORROW_PERIOD_DAYS,
  } = useLibrary();

  // =========================================================
  // AUTH MODAL POP-UP STATE (FOR GUEST USERS)
  // =========================================================
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingActionText, setPendingActionText] = useState('');
  const requireAuth = (actionDescription, callback) => {
    if (!user?.id) {
      setPendingActionText(actionDescription);
      setShowAuthModal(true);
      return false;
    }
    if (typeof callback === 'function') {
      callback();
    }
    return true;
  };

  // =========================================================
  // SEARCH / FILTER STATES
  // =========================================================
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('title-asc');
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
  const [selectedLibrary, setSelectedLibrary] = useState('All');
  const [selectedAvailability, setSelectedAvailability] = useState('All');

  // =========================================================
  // UI STATES
  // =========================================================
  const [selectedBook, setSelectedBook] = useState(null);
  const [readingListBookIds, setReadingListBookIds] = useState([]);
  const [readingListBooks, setReadingListBooks] = useState([]);
  const [readingListLoading, setReadingListLoading] = useState(false);
  const [savingReadingListBookId, setSavingReadingListBookId] = useState(null);
  const [notice, setNotice] = useState('');
  const [cancellingRequestId, setCancellingRequestId] = useState(null);
  const [submittingBorrow, setSubmittingBorrow] = useState(false);
  const [submittingCommunityRequest, setSubmittingCommunityRequest] = useState(false);
  const [updatingVisibilityBookId, setUpdatingVisibilityBookId] = useState(null);

  // =========================================================
  // PERSONAL / COMMUNITY BOOK STATES
  // =========================================================
  const [loadingPersonalBooks] = useState(false);
  const [loadingCommunityBooks] = useState(false);
  const [personalBookError] = useState('');
  const [communityBookError] = useState('');

  // =========================================================
  // COMMUNITY BOOK OWNER REQUEST STATES
  // =========================================================
  const ownerCommunityRequests = ownerCommunityBookRequests;
  const [ownerCommunityRequestFilter, setOwnerCommunityRequestFilter] = useState('all');
  const [ownerCommunityRequestError, setOwnerCommunityRequestError] = useState('');
  const [processingCommunityRequestId, setProcessingCommunityRequestId] = useState(null);
  const [showRejectCommunityRequest, setShowRejectCommunityRequest] = useState(null);
  const [communityRequestResponse, setCommunityRequestResponse] = useState('');
  const [communityRequestNotice, setCommunityRequestNotice] = useState('');
  const ownerCommunityRequestCounts = useMemo(
    () =>
      ownerCommunityRequests.reduce((counts, request) => {
        const status = getOwnerCommunityRequestStatus(request);
        counts[status] = (counts[status] || 0) + 1;
        return counts;
      }, {}),
    [ownerCommunityRequests]
  );
  const loadingOwnerCommunityRequests =
    libraryLoading && ownerCommunityRequests.length === 0;
  const filteredOwnerCommunityRequests = useMemo(() => {
    if (ownerCommunityRequestFilter === 'all') {
      return ownerCommunityRequests;
    }
    const selectedFilter = OWNER_COMMUNITY_REQUEST_FILTERS.find(
      (filter) => filter.key === ownerCommunityRequestFilter
    );
    return selectedFilter?.status
      ? ownerCommunityRequests.filter(
          (request) =>
            getOwnerCommunityRequestStatus(request) === selectedFilter.status
        )
      : ownerCommunityRequests;
  }, [ownerCommunityRequestFilter, ownerCommunityRequests]);
  const [showAddPersonalBook, setShowAddPersonalBook] = useState(false);
  const [editingPersonalBook, setEditingPersonalBook] = useState(null);
  const [savingPersonalBook, setSavingPersonalBook] = useState(false);
  const [personalBookToRemove, setPersonalBookToRemove] = useState(null);
  const [personalBookRemovalError, setPersonalBookRemovalError] = useState('');
  const [removingPersonalBookId, setRemovingPersonalBookId] = useState(null);

  const refreshReadingList = useCallback(async () => {
    if (!user?.id) {
      setReadingListBookIds([]);
      setReadingListBooks([]);
      return;
    }
    setReadingListLoading(true);
    try {
      const list = await fetchReadingList(user.id);
      const ids = (list || []).map((book) => String(book.id));
      setReadingListBooks(list || []);
      setReadingListBookIds(ids);
    } catch (error) {
      console.error('Unable to load reading list:', error);
      setReadingListBooks([]);
      setReadingListBookIds([]);
    } finally {
      setReadingListLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const refreshTimer = setTimeout(() => {
      void refreshReadingList();
    }, 0);
    return () => clearTimeout(refreshTimer);
  }, [refreshReadingList, user?.id]);

  const isBookInReadingList = (bookId) =>
    readingListBookIds.includes(String(bookId));

  const handleToggleReadingList = async (book) => {
    if (!book?.id) {
      setNotice('Unable to identify the selected book.');
      return;
    }
    if (!requireAuth('save books to your reading list')) {
      return;
    }
    if (savingReadingListBookId === book.id) return;
    setSavingReadingListBookId(book.id);
    setNotice('');
    try {
      const nextSavedState = await toggleReadingList(user.id, book.id);
      const normalizedId = String(book.id);
      setReadingListBookIds((previousIds) => {
        if (nextSavedState) {
          return previousIds.includes(normalizedId)
            ? previousIds
            : [...previousIds, normalizedId];
        }
        return previousIds.filter((id) => id !== normalizedId);
      });
      setReadingListBooks((previousBooks) => {
        if (nextSavedState) {
          if (previousBooks.some((item) => String(item.id) === normalizedId)) {
            return previousBooks;
          }
          return [book, ...previousBooks];
        }
        return previousBooks.filter((item) => String(item.id) !== normalizedId);
      });
      if (activeView === 'readingList') {
        await refreshReadingList();
      }
      setNotice(
        nextSavedState
          ? `Saved "${book.title || 'this book'}" to your reading list.`
          : `Removed "${book.title || 'this book'}" from your reading list.`
      );
    } catch (error) {
      console.error('Reading list toggle error:', error);
      setNotice(error?.message || 'Unable to update your reading list right now.');
    } finally {
      setSavingReadingListBookId(null);
    }
  };

  // =========================================================
  // PERSONAL BOOK FORM STATES
  // =========================================================
  const [personalBookForm, setPersonalBookForm] = useState({
    title: '',
    author: '',
    category: '',
    customCategory: '',
    isbn: '',
    summary: '',
    condition: 'Good',
    totalCopies: 1,
    lendingPeriodDays: 7,
    handoverMethod: 'arrange_with_owner',
    handoverDetails: '',
    lendingEnabled: true,
    isPublic: false,
  });

  // =========================================================
  // MAP STATES
  // =========================================================
  const [mapLibrary, setMapLibrary] = useState(null);
  const [mapReturnBook, setMapReturnBook] = useState(null);
  const [mapBookContext, setMapBookContext] = useState(null);

  // =========================================================
  // REVIEW STATES
  // =========================================================
  const [reviews, setReviews] = useState([]);
  const [userRating, setUserRating] = useState(5);
  const [userComment, setUserComment] = useState('');
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // =========================================================
  // LIVE FINE REFRESH
  // =========================================================
  const [, setFineRefresh] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setFineRefresh((value) => value + 1);
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const updatePersonalBookForm = (field, value) => {
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
      customCategory: '',
      isbn: '',
      summary: '',
      condition: 'Good',
      lendingPeriodDays: 7,
      handoverMethod: 'arrange_with_owner',
      handoverDetails: '',
      lendingEnabled: true,
      isPublic: false,
      totalCopies: 1,
    });
  };
  const openEditPersonalBook = (book) => {
    if (!requireAuth('edit personal books')) return;
    const isCustomCategory =
      book.category && !personalBookCategories.includes(book.category);
    setEditingPersonalBook(book);
    setPersonalBookForm({
      title: book.title || '',
      author: book.author || '',
      category: isCustomCategory ? 'Others' : book.category || '',
      customCategory: isCustomCategory ? book.category : '',
      isbn: book.isbn || '',
      summary: book.summary || '',
      condition: book.condition || 'Good',
      lendingPeriodDays: book.lendingPeriodDays || 7,
      handoverMethod: book.handoverMethod || 'arrange_with_owner',
      handoverDetails: book.handoverDetails || '',
      lendingEnabled: Boolean(book.lendingEnabled),
      isPublic: Boolean(book.isPublic),
      totalCopies: getPersonalBookCopyAvailability(book).totalCopies,
    });
    setNotice('');
    setShowAddPersonalBook(true);
  };
  const openRemovePersonalBook = (book) => {
    if (!requireAuth('remove personal books')) return;
    setPersonalBookRemovalError('');
    setPersonalBookToRemove(book);
  };
  const handleSavePersonalBook = async (event) => {
    event.preventDefault();
    if (!requireAuth('save personal books')) return;
    const title = personalBookForm.title.trim();
    const author = personalBookForm.author.trim();
    const category =
      personalBookForm.category === 'Others'
        ? personalBookForm.customCategory.trim()
        : personalBookForm.category.trim();
    const isbn = personalBookForm.isbn.trim();
    const summary = personalBookForm.summary.trim();
    const handoverMethod = String(personalBookForm.handoverMethod || '').trim();
    const handoverDetails = personalBookForm.handoverDetails.trim();
    const lendingPeriodDays = Number(personalBookForm.lendingPeriodDays);
    const totalCopies = Number(personalBookForm.totalCopies);
    if (!title || !author) {
      setNotice('Book title and author are required.');
      return;
    }
    const normalizedTitle = normalizeCatalogValue(title);
    const normalizedAuthor = normalizeCatalogValue(author);
    const normalizedIsbn = normalizeCatalogIsbn(isbn);
    const duplicateBook = personalBooks.find((book) => {
      if (
        editingPersonalBook &&
        String(book.id) === String(editingPersonalBook.id)
      ) {
        return false;
      }
      const existingTitle = normalizeCatalogValue(book.title);
      const existingAuthor = normalizeCatalogValue(book.author);
      const existingIsbn = normalizeCatalogIsbn(book.isbn);
      return (
        (normalizedIsbn && existingIsbn === normalizedIsbn) ||
        (existingTitle === normalizedTitle &&
          existingAuthor === normalizedAuthor &&
          (!normalizedIsbn || !existingIsbn || existingIsbn === normalizedIsbn))
      );
    });
    if (duplicateBook) {
      setNotice(`"${duplicateBook.title}" by ${duplicateBook.author} is already in your personal books.`);
      return;
    }
    if (personalBookForm.category === 'Others' && !category) {
      setNotice('Enter a category when selecting Others.');
      return;
    }
    if (!Number.isInteger(totalCopies) || totalCopies < 1) {
      setNotice('Copy count must be a whole number of at least 1.');
      return;
    }
    if (
      !Number.isInteger(lendingPeriodDays) ||
      lendingPeriodDays < PERSONAL_BOOK_MIN_LENDING_DAYS ||
      lendingPeriodDays > PERSONAL_BOOK_MAX_LENDING_DAYS
    ) {
      setNotice(`Lending period must be between ${PERSONAL_BOOK_MIN_LENDING_DAYS} and ${PERSONAL_BOOK_MAX_LENDING_DAYS} days.`);
      return;
    }
    if (personalBookForm.lendingEnabled && !handoverMethod) {
      setNotice('Please select a handover method when lending is enabled.');
      return;
    }
    if (handoverDetails.length > 500) {
      setNotice('Handover details must not exceed 500 characters.');
      return;
    }
    if (savingPersonalBook) return;
    setSavingPersonalBook(true);
    setNotice('');
    try {
      const bookDetails = {
        visitorId: user.id,
        title,
        author,
        category: category || null,
        isbn: isbn || null,
        summary: summary || null,
        condition: personalBookForm.condition,
        totalCopies,
        lendingPeriodDays,
        handoverMethod: handoverMethod || 'arrange_with_owner',
        handoverDetails: handoverDetails || null,
        lendingEnabled: Boolean(personalBookForm.lendingEnabled),
        isPublic: Boolean(personalBookForm.isPublic),
      };
      const savedBook = editingPersonalBook
        ? await updatePersonalBook({
            ...bookDetails,
            bookId: editingPersonalBook.id,
          })
        : await addPersonalBook(bookDetails);
      if (!savedBook) {
        throw new Error(`The personal book was not ${editingPersonalBook ? 'updated' : 'created'}. Please try again.`);
      }
      setShowAddPersonalBook(false);
      setEditingPersonalBook(null);
      resetPersonalBookForm();
      setNotice(
        editingPersonalBook
          ? `"${title}" was updated successfully.`
          : `"${title}" was added to your personal books successfully.`
      );
    } catch (error) {
      console.error('Save personal book error:', error);
      setNotice(error?.message || `Unable to ${editingPersonalBook ? 'update' : 'add'} the personal book. Please try again.`);
    } finally {
      setSavingPersonalBook(false);
    }
  };
  const handleRemovePersonalBook = async () => {
    if (!personalBookToRemove?.id || !user?.id) {
      setPersonalBookRemovalError('Unable to identify the personal book to remove.');
      return;
    }
    if (removingPersonalBookId) return;
    setRemovingPersonalBookId(personalBookToRemove.id);
    setPersonalBookRemovalError('');
    try {
      await deletePersonalBook(user.id, personalBookToRemove.id);
      setNotice(`"${personalBookToRemove.title || 'Personal book'}" was removed from your collection.`);
      setPersonalBookToRemove(null);
    } catch (error) {
      console.error('Remove personal book error:', error);
      setPersonalBookRemovalError(error?.message || 'Unable to remove this personal book. Please try again.');
    } finally {
      setRemovingPersonalBookId(null);
    }
  };

  // =========================================================
  // DYNAMIC FILTER OPTIONS
  // =========================================================
  const uniqueBooksByCategory = new Map();
  books.forEach((book) => {
    const category = book.category?.trim() || 'Uncategorized';
    const categoryKey = category.toLocaleLowerCase();
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
    uniqueBooksByCategory.get(categoryKey).books.add(bookKey);
  });
  const categorySummaries = [...uniqueBooksByCategory.values()]
    .map(({ label, books: uniqueBooks }) => ({
      label,
      count: uniqueBooks.size,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const personalBookCategories = [
    ...new Map(
      categorySummaries
        .filter(({ label }) => label !== 'Uncategorized')
        .map(({ label }) => [label.toLocaleLowerCase(), label])
    ).values(),
  ]
    .filter((label) => !['other', 'others'].includes(label.toLocaleLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  const libraryOptions = [
    'All',
    ...new Set(books.map((book) => book.libraryId).filter(Boolean)),
  ];
  const libraryName = (id) =>
    libraries.find((library) => library.id === id)?.name || id;

  // =========================================================
  // SEARCH HANDLERS
  // =========================================================
  const handleSearch = (event) => {
    if (event) event.preventDefault();
    const query = searchInput.trim();
    setSearchTerm(query);
    if (activeView === 'catalog' && query) {
      recordVisitorSearch(user?.id, query);
    }
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
  // REVIEWS
  // =========================================================
  useEffect(() => {
    if (!selectedBook) return;
    const fetchReviews = async () => {
      setLoadingReviews(true);
      const { data, error } = await supabase
        .from('book_reviews')
        .select('*')
        .eq('book_id', String(selectedBook.id))
        .order('created_at', { ascending: false });
      if (error) {
        console.error('Error fetching reviews:', error.message);
        setReviews([]);
      } else {
        setReviews(data || []);
      }
      setLoadingReviews(false);
    };
    fetchReviews();
  }, [selectedBook]);
  const handleSubmitReview = async (event) => {
    event.preventDefault();
    if (!userComment.trim() || !selectedBook) return;
    if (!requireAuth('submit ratings and reviews')) {
      return;
    }
    setIsSubmitting(true);
    const newReview = {
      book_id: String(selectedBook.id),
      visitor_id: String(user.id),
      visitor_name: user?.full_name || user?.name || user?.email || 'Anonymous Visitor',
      rating: Number(userRating),
      comment: userComment.trim(),
    };
    const { data, error } = await supabase
      .from('book_reviews')
      .insert([newReview])
      .select();
    setIsSubmitting(false);
    if (error) {
      setNotice('Failed to save review: ' + error.message);
      return;
    }
    if (data && data.length > 0) {
      setReviews((currentReviews) => [data[0], ...currentReviews]);
      setUserComment('');
      setUserRating(5);
      setNotice('Thank you for your rating and review!');
    }
  };

  // =========================================================
  // FILTER BOOKS
  // =========================================================
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const normalizeMatchText = (value) =>
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  const physicalIsbns = new Set(
    books
      .map((book) => String(book.isbn || '').replace(/\D/g, ''))
      .filter(Boolean)
  );
  const physicalTitleAuthor = new Set(
    books.map(
      (book) => `${normalizeMatchText(book.title)}|${normalizeMatchText(book.author)}`
    )
  );
  const physicalTitles = new Set(
    books.map((book) => normalizeMatchText(book.title)).filter(Boolean)
  );
  const externalDiscoveryBooks =
    activeView === 'catalog'
      ? externalCatalogBooks.filter((book) => {
          const isbn = String(book.isbn || '').replace(/\D/g, '');
          const title = normalizeMatchText(book.title);
          const author = normalizeMatchText(book.author);
          const titleAuthor = `${title}|${author}`;
          const matchesPhysicalIsbn = isbn && physicalIsbns.has(isbn);
          const matchesPhysicalTitleAuthor =
            title && author && physicalTitleAuthor.has(titleAuthor);
          const matchesPhysicalTitleWithoutAuthor =
            title && !author && physicalTitles.has(title);
          return !(
            matchesPhysicalIsbn ||
            matchesPhysicalTitleAuthor ||
            matchesPhysicalTitleWithoutAuthor
          );
        })
      : [];
  const normalizeCatalogValue = (value) =>
    String(value ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  const normalizeCatalogIsbn = (value) =>
    String(value ?? '').replace(/[^0-9]/g, '');
  const physicalBookGroups = new Map();
  for (const book of books) {
    const title = normalizeCatalogValue(book.title);
    const author = normalizeCatalogValue(book.author);
    const isbn = normalizeCatalogIsbn(book.isbn);
    const libraryId = normalizeCatalogValue(book.libraryId);
    if (!title || !author || !libraryId) {
      physicalBookGroups.set(`unique:${String(book.id)}`, book);
      continue;
    }
    const key = [
      libraryId,
      title,
      author,
      isbn ? `isbn:${isbn}` : 'no-isbn',
    ].join('::');
    const existing = physicalBookGroups.get(key);
    if (!existing) {
      physicalBookGroups.set(key, book);
      continue;
    }
    const existingAvailable = Number(
      existing.availableCopies ?? existing.available_copies ?? 0
    );
    const currentAvailable = Number(
      book.availableCopies ?? book.available_copies ?? 0
    );
    if (currentAvailable > existingAvailable) {
      physicalBookGroups.set(key, book);
    }
  }
  const deduplicatedPhysicalBooks = [...physicalBookGroups.values()];
  const catalogSourceBooks = [
    ...deduplicatedPhysicalBooks,
    ...externalDiscoveryBooks,
  ];
  const filteredBooks = catalogSourceBooks
    .filter((book) => {
      const isExternal = book.isExternalCatalog === true;
      const title = String(book.title || '').toLowerCase();
      const author = String(book.author || '').toLowerCase();
      const isbn = String(book.isbn || '').toLowerCase();
      const category = String(book.category || '').toLowerCase();
      const matchesSearch =
        normalizedSearch === '' ||
        title.includes(normalizedSearch) ||
        author.includes(normalizedSearch) ||
        isbn.includes(normalizedSearch) ||
        category.includes(normalizedSearch);
      const matchesCategory =
        selectedCategory === 'All' ||
        String(book.category || 'Uncategorized')
          .trim()
          .toLowerCase() === selectedCategory.toLowerCase();
      const matchesLibrary = isExternal
        ? true
        : libraryFilter
          ? book.libraryId === libraryFilter
          : selectedLibrary === 'All' || book.libraryId === selectedLibrary;
      const isAvailable =
        !isExternal && Number(book.availableCopies || 0) > 0;
      const matchesAvailability =
        selectedAvailability === 'All' ||
        (selectedAvailability === 'Available' && isAvailable) ||
        (selectedAvailability === 'Unavailable' && !isAvailable);
      return (
        matchesSearch &&
        matchesCategory &&
        matchesLibrary &&
        matchesAvailability
      );
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'title-asc':
          return String(a.title || '').localeCompare(
            String(b.title || ''),
            undefined,
            { sensitivity: 'base' }
          );
        case 'title-desc':
          return String(b.title || '').localeCompare(
            String(a.title || ''),
            undefined,
            { sensitivity: 'base' }
          );
        case 'author-asc':
          return String(a.author || '').localeCompare(
            String(b.author || ''),
            undefined,
            { sensitivity: 'base' }
          );
        case 'author-desc':
          return String(b.author || '').localeCompare(
            String(b.author || ''),
            undefined,
            { sensitivity: 'base' }
          );
        case 'newest':
          return (
            new Date(b.createdAt || b.created_at || 0).getTime() -
            new Date(a.createdAt || a.created_at || 0).getTime()
          );
        case 'oldest':
          return (
            new Date(a.createdAt || a.created_at || 0).getTime() -
            new Date(b.createdAt || b.created_at || 0).getTime()
          );
        case 'available':
          return (
            Number(b.availableCopies || 0) - Number(a.availableCopies || 0)
          );
        case 'unavailable':
          return (
            Number(a.availableCopies || 0) - Number(b.availableCopies || 0)
          );
        default:
          return 0;
      }
    });

  // =========================================================
  // MY REQUESTS
  // =========================================================
  const myRequests = useMemo(() => {
    const normalRequests = Array.isArray(borrowRequests)
      ? borrowRequests.filter((request) => {
          if (!request) return false;
          const isCommunityRequest =
            request.isCommunityBook === true ||
            request.requestType === 'community';
          if (isCommunityRequest) return false;
          const requestVisitorId =
            request?.visitorId ?? request?.visitor_id ?? null;
          const currentVisitorId =
            user?.id ?? user?.visitorId ?? user?.visitor_id ?? null;
          if (!requestVisitorId || !currentVisitorId) return false;
          return (
            String(requestVisitorId).trim() === String(currentVisitorId).trim()
          );
        })
      : [];
    const communityRequests = Array.isArray(myCommunityBookRequests)
      ? myCommunityBookRequests
          .filter((request) => request && request.id)
          .map((request) => ({
            ...request,
            id: request.id,
            bookId: request.book_id ?? request.bookId ?? null,
            bookTitle: request.book_title ?? request.bookTitle ?? 'Untitled Book',
            visitorId:
              request.requester_visitor_id ??
              request.requesterVisitorId ??
              user?.id ??
              null,
            visitorName:
              request.requester_name ??
              request.requesterName ??
              user?.fullName ??
              user?.full_name ??
              'SHELF Visitor',
            status: String(request.status ?? 'pending')
              .trim()
              .toLowerCase(),
            requestDate: request.request_date ?? request.requestDate ?? null,
            queuePosition:
              request.queue_position ?? request.queuePosition ?? null,
            ownerContactEmail:
              request.owner_contact_email ?? request.ownerContactEmail ?? null,
            ownerContactNumber:
              request.owner_contact_number ?? request.ownerContactNumber ?? null,
            ownerContactDetails:
              request.owner_contact_details ?? request.ownerContactDetails ?? null,
            ownerVisitorId:
              request.owner_visitor_id ?? request.ownerVisitorId ?? null,
            ownerName: request.owner_name ?? request.ownerName ?? null,
            ownerResponse:
              request.owner_response ?? request.ownerResponse ?? null,
            borrowDate: request.borrow_date ?? request.borrowDate ?? null,
            dueDate: request.due_date ?? request.dueDate ?? null,
            returnDate: request.return_date ?? request.returnDate ?? null,
            fineAmount:
              Number(request.fine_amount ?? request.fineAmount ?? 0) || 0,
            approvedAt: request.approved_at ?? request.approvedAt ?? null,
            rejectedAt: request.rejected_at ?? request.rejectedAt ?? null,
            requestType: 'community',
            isCommunityBook: true,
          }))
      : [];
    const combinedRequests = [...normalRequests, ...communityRequests];
    const uniqueRequests = Array.from(
      new Map(
        combinedRequests
          .filter((request) => request && request.id)
          .map((request) => [String(request.id), request])
      ).values()
    );
    uniqueRequests.sort(
      (a, b) =>
        new Date(b?.requestDate || b?.request_date || 0).getTime() -
        new Date(a?.requestDate || a?.request_date || 0).getTime()
    );
    return uniqueRequests;
  }, [
    borrowRequests,
    myCommunityBookRequests,
    user?.id,
    user?.visitorId,
    user?.visitor_id,
    user?.fullName,
    user?.full_name,
  ]);
  useEffect(() => {
    if (
      !focusRequestId ||
      !['myBorrows', 'personalBooks'].includes(activeView)
    )
      return;
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(
          activeView === 'personalBooks'
            ? `community-owner-request-${focusRequestId}`
            : `borrow-request-${focusRequestId}`
        )
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeView, focusRequestId, myRequests, ownerCommunityRequests]);

  // =========================================================
  // SEARCH FILTERS FOR PERSONAL & COMMUNITY
  // =========================================================
  const filteredPersonalBooks = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return personalBooks;
    return personalBooks.filter(
      (book) =>
        String(book.title || '').toLowerCase().includes(term) ||
        String(book.author || '').toLowerCase().includes(term) ||
        String(book.category || '').toLowerCase().includes(term) ||
        String(book.isbn || '').toLowerCase().includes(term)
    );
  }, [personalBooks, searchTerm]);
  const filteredCommunityBooks = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return communityBooks;
    return communityBooks.filter(
      (book) =>
        String(book.title || '').toLowerCase().includes(term) ||
        String(book.author || '').toLowerCase().includes(term) ||
        String(book.category || '').toLowerCase().includes(term) ||
        String(book.isbn || '').toLowerCase().includes(term)
    );
  }, [communityBooks, searchTerm]);

  // =========================================================
  // BORROW / RESERVE HANDLER (WITH GUEST MODAL CHECK)
  // =========================================================
  const handleBorrowOrReserve = async (bookEntry) => {
    if (!requireAuth(`borrow or reserve "${bookEntry?.title || 'this book'}"`)) {
      return;
    }
    if (!bookEntry?.id) {
      setNotice('Unable to identify the selected book.');
      return;
    }
    if (bookEntry.isExternalCatalog) {
      setNotice(
        'This book is listed in the external catalog and is not available for borrowing through SHELF.'
      );
      return;
    }
    if (bookEntry.bookType === 'personal') {
      setNotice(
        'This is a community book. Use the "Request Community Book" button below to send it to the owner for approval.'
      );
      return;
    }
    if (submittingBorrow) return;
    setSubmittingBorrow(true);
    setNotice('');
    try {
      const request = await requestBorrow(user.id, bookEntry.id);
      if (!request) {
        throw new Error('The borrow request was not created. Please try again.');
      }
      const status = request.status || request.requestStatus;
      const rawQueuePosition =
        request.queuePosition ?? request.queue_position ?? request.position;
      const queuePosition =
        rawQueuePosition !== null &&
        rawQueuePosition !== undefined &&
        rawQueuePosition !== ''
          ? Number(rawQueuePosition)
          : null;
      if (status === 'ready_for_pickup') {
        setNotice(
          `"${bookEntry.title}" is ready for pickup at ${libraryName(
            bookEntry.libraryId
          )}. Please visit within ${PICKUP_WINDOW_HOURS} hours to scan your QR pass.`
        );
      } else if (status === 'queued') {
        if (Number.isFinite(queuePosition)) {
          setNotice(
            `"${bookEntry.title}" is currently unavailable at this branch — you are #${queuePosition} in the reservation queue.`
          );
        } else {
          setNotice(
            `"${bookEntry.title}" is currently unavailable at this branch. Your reservation has been added to the queue.`
          );
        }
      } else {
        setNotice(`"${bookEntry.title}" borrow request was created successfully.`);
      }
      setSelectedBook(null);
      onViewChange('myBorrows');
    } catch (error) {
      console.error('Borrow request error:', error);
      setNotice(
        error?.message || 'Unable to process the borrow request. Please try again.'
      );
    } finally {
      setSubmittingBorrow(false);
    }
  };

  // =========================================================
  // REQUEST COMMUNITY BOOK (WITH GUEST MODAL CHECK)
  // =========================================================
  const handleRequestCommunityBook = async (book) => {
    if (!book?.id) {
      setNotice('Unable to identify this community book.');
      return;
    }
    if (!requireAuth(`request community book "${book.title || ''}"`)) {
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
    if (submittingCommunityRequest) return;
    if (typeof requestCommunityBook !== 'function') {
      setNotice('Community book request service is not available. Please refresh the page and try again.');
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
        Number.isFinite(Number(request.queuePosition))
          ? `"${book.title}" request submitted. You are #${request.queuePosition} in the queue, and the owner must approve it before handover.`
          : `"${book.title}" request was submitted successfully. The owner must approve your request before borrowing can proceed.`
      );
      setSelectedBook(null);
    } catch (error) {
      console.error('Community book request error:', error);
      setNotice(
        error?.message || 'Unable to request this community book. Please try again.'
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
      return Array.isArray(requests) ? requests : [];
    } catch (error) {
      console.error('Reload owner community requests error:', error);
      throw error;
    }
  };
  const handleApproveCommunityRequest = async (request) => {
    if (!request?.id || !user?.id) {
      setNotice('Unable to identify this community book request.');
      return;
    }
    if (processingCommunityRequestId) return;
    setProcessingCommunityRequestId(request.id);
    setOwnerCommunityRequestError('');
    setCommunityRequestNotice('');
    try {
      const result = await approveCommunityBookRequest(request.id, user.id, null);
      if (!result?.id) {
        throw new Error('The community book request could not be approved.');
      }
      setCommunityRequestNotice(`Request for "${request.bookTitle}" was approved successfully.`);
      await reloadOwnerCommunityRequests();
    } catch (error) {
      console.error('Approve community request error:', error);
      setOwnerCommunityRequestError(
        error?.message || 'Unable to approve the community book request. Please try again.'
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
      setOwnerCommunityRequestError('Unable to identify this community book request.');
      return;
    }
    if (processingCommunityRequestId) return;
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
      setCommunityRequestNotice(`Request for "${request.bookTitle}" was rejected.`);
      await reloadOwnerCommunityRequests();
    } catch (error) {
      console.error('Reject community request error:', error);
      setOwnerCommunityRequestError(
        error?.message || 'Unable to reject the community book request. Please try again.'
      );
    } finally {
      setProcessingCommunityRequestId(null);
    }
  };
  const handleConfirmCommunityBookPickup = async (request) => {
    if (!request?.id || !user?.id) {
      setNotice('Unable to identify this community book request.');
      return;
    }
    if (processingCommunityRequestId) return;
    setProcessingCommunityRequestId(request.id);
    setOwnerCommunityRequestError('');
    setCommunityRequestNotice('');
    try {
      const result = await confirmCommunityBookPickup(request.id, user.id);
      const refreshedRequests = await reloadOwnerCommunityRequests();
      const refreshedRequest = refreshedRequests?.find(
        (ownerRequest) => ownerRequest.id === request.id
      );
      const confirmedStatus = String(
        refreshedRequest?.status ?? result?.status ?? ''
      )
        .trim()
        .toLowerCase();
      if (confirmedStatus !== 'borrowed') {
        throw new Error('The handover was not confirmed. The request is still awaiting handover.');
      }
      setCommunityRequestNotice(`"${request.bookTitle}" has been marked as borrowed.`);
    } catch (error) {
      console.error('Confirm community book pickup error:', error);
      setOwnerCommunityRequestError(
        error?.message || 'Unable to confirm the community book handover. Please try again.'
      );
    } finally {
      setProcessingCommunityRequestId(null);
    }
  };
  const handleConfirmCommunityBookReturn = async (request) => {
    if (!request?.id || !user?.id) {
      setNotice('Unable to identify this community book request.');
      return;
    }
    if (processingCommunityRequestId) return;
    setProcessingCommunityRequestId(request.id);
    setOwnerCommunityRequestError('');
    setCommunityRequestNotice('');
    try {
      const result = await confirmCommunityBookReturn(request.id, user.id);
      if (!result?.success) {
        throw new Error('The community book return could not be confirmed.');
      }
      setCommunityRequestNotice(`"${request.bookTitle}" has been marked as returned.`);
      await reloadOwnerCommunityRequests();
    } catch (error) {
      console.error('Confirm community book return error:', error);
      setOwnerCommunityRequestError(
        error?.message || 'Unable to confirm the community book return. Please try again.'
      );
    } finally {
      setProcessingCommunityRequestId(null);
    }
  };

  // =========================================================
  // CANCEL REQUEST
  // =========================================================
  const handleCancel = async (requestId) => {
    if (!requestId) {
      setNotice('Unable to identify the borrow request.');
      return;
    }
    if (cancellingRequestId) return;
    setCancellingRequestId(requestId);
    setNotice('');
    try {
      await cancelBorrowRequest(requestId, 'cancelled');
      setNotice('Request cancelled successfully.');
    } catch (error) {
      console.error('Cancel request error:', error);
      setNotice(error?.message || 'Unable to cancel request. Please try again.');
    } finally {
      setCancellingRequestId(null);
    }
  };

  // =========================================================
  // MAP HANDLERS
  // =========================================================
  const handleViewMap = (libraryId, inventoryEntry = null) => {
    setMapBookContext(null);
    const library = libraries.find((item) => item.id === libraryId);
    if (!library) {
      setNotice('Library location could not be found.');
      return;
    }
    if (library.lat == null || library.lng == null) {
      setNotice('GPS coordinates are not available for this library yet.');
      return;
    }
    if (selectedBook) {
      setMapReturnBook(selectedBook);
      setMapBookContext({
        title: selectedBook.title || 'Untitled Book',
        totalCopies: Number(inventoryEntry?.totalCopies || 0),
        availableCopies: Number(inventoryEntry?.availableCopies || 0),
      });
    }
    setMapLibrary(library);
    setSelectedBook(null);
    globalThis.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const handleCloseMap = () => {
    setMapLibrary(null);
    setMapBookContext(null);
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
    const normalize = (value) =>
      String(value ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
    const normalizeIsbn = (value) =>
      String(value ?? '')
        .replace(/[^a-z0-9]/gi, '')
        .toLowerCase();
    const selectedIsbn = normalizeIsbn(book.isbn);
    const selectedTitle = normalize(book.title);
    const selectedAuthor = normalize(book.author);
    const matchingEntries = books.filter((entry) => {
      if (!entry?.id || !entry?.libraryId) return false;
      if (Number(entry.totalCopies ?? 0) <= 0) return false;
      const entryIsbn = normalizeIsbn(entry.isbn);
      const sameBook =
        selectedIsbn && entryIsbn
          ? selectedIsbn === entryIsbn
          : selectedTitle === normalize(entry.title) &&
            selectedAuthor === normalize(entry.author);
      return sameBook;
    });
    const entriesByLibrary = new Map();
    for (const entry of matchingEntries) {
      const libraryKey = String(entry.libraryId);
      const existing = entriesByLibrary.get(libraryKey);
      if (!existing) {
        entriesByLibrary.set(libraryKey, entry);
        continue;
      }
      const existingAvailable = Number(existing.availableCopies ?? 0);
      const currentAvailable = Number(entry.availableCopies ?? 0);
      if (
        currentAvailable > existingAvailable ||
        (currentAvailable === existingAvailable &&
          Number(entry.totalCopies ?? 0) > Number(existing.totalCopies ?? 0))
      ) {
        entriesByLibrary.set(libraryKey, entry);
      }
    }
    return [...entriesByLibrary.values()];
  };
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
  // CARD RENDERERS
  // =========================================================
  const renderPersonalBookCard = (book) => {
    const bookRequests = ownerCommunityRequests.filter(
      (request) =>
        String(request.bookId ?? request.book_id ?? '') === String(book.id)
    );
    const hasActiveRequest = bookRequests.some((request) =>
      ['pending', 'approved', 'borrowed'].includes(
        getOwnerCommunityRequestStatus(request)
      )
    );
    const canRemove =
      bookRequests.length === 0 &&
      getPersonalBookCopyAvailability(book).borrowedCopies === 0;
    return (
      <div
        key={book.id}
        className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden"
      >
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200 px-2 py-1 rounded">
                  Personal Book
                </span>
                <span className="text-[10px] font-bold tracking-wider bg-slate-100 text-slate-700 dark:bg-slate-600 dark:text-slate-100 px-2 py-1 rounded">
                  {book.isPublic ? 'Public' : 'Only Me'}
                </span>
                {book.lendingEnabled ? (
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${
                      getPersonalBookCopyAvailability(book).availableCopies > 0
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {getPersonalBookAvailabilityLabel(book)}
                  </span>
                ) : (
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-2 py-1 rounded">
                    Not for Lending
                  </span>
                )}
              </div>
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                {book.title || 'Untitled Book'}
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                By {book.author || 'Unknown Author'}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              {String(book.ownerVisitorId ?? '') === String(user?.id ?? '') && (
                <button
                  type="button"
                  onClick={async () => {
                    if (updatingVisibilityBookId) return;
                    const nextVisibility = !book.isPublic;
                    setUpdatingVisibilityBookId(book.id);
                    setNotice('');
                    try {
                      await setPersonalBookVisibility(
                        user.id,
                        book.id,
                        nextVisibility
                      );
                      setNotice(
                        `"${book.title}" is now ${
                          nextVisibility ? 'public' : 'visible only to you'
                        }.`
                      );
                    } catch (error) {
                      console.error('UPDATE PERSONAL BOOK VISIBILITY ERROR:', error);
                      setNotice(error?.message || 'Unable to update book visibility.');
                    } finally {
                      setUpdatingVisibilityBookId(null);
                    }
                  }}
                  disabled={updatingVisibilityBookId === book.id}
                  aria-label={`Make ${book.title} ${book.isPublic ? 'private' : 'public'}`}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  {book.isPublic ? (
                    <EyeOff size={13} aria-hidden="true" />
                  ) : (
                    <Eye size={13} aria-hidden="true" />
                  )}
                  {updatingVisibilityBookId === book.id
                    ? 'Saving...'
                    : book.isPublic
                      ? 'Make Private'
                      : 'Make Public'}
                </button>
              )}
              {String(book.ownerVisitorId ?? '') === String(user?.id ?? '') && (
                <>
                  <button
                    type="button"
                    onClick={() => openEditPersonalBook(book)}
                    disabled={hasActiveRequest || savingPersonalBook}
                    title={
                      hasActiveRequest
                        ? 'Resolve active community requests before editing this book.'
                        : 'Edit personal book'
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => openRemovePersonalBook(book)}
                    disabled={!canRemove || removingPersonalBookId === book.id}
                    title={
                      canRemove
                        ? 'Remove personal book'
                        : 'Books with community request history or on-loan copies cannot be removed.'
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1.5 text-[11px] font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Remove
                  </button>
                </>
              )}
              <BookOpen size={22} className="text-slate-400" aria-hidden="true" />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-50 dark:bg-slate-700/60 rounded-lg p-3">
              <p className="text-slate-400">Category</p>
              <p className="font-semibold text-slate-700 dark:text-slate-100">
                {book.category || 'Uncategorized'}
              </p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-slate-400">Condition</p>
              <p className="font-semibold text-slate-700">
                {book.condition || 'Not specified'}
              </p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-slate-400">Lending Period</p>
              <p className="font-semibold text-slate-700">
                {book.lendingEnabled ? `${book.lendingPeriodDays || 7} days` : 'Not applicable'}
              </p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-slate-400">ISBN</p>
              <p className="font-semibold text-slate-700 font-mono">
                {book.isbn || 'N/A'}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
              <p className="text-slate-400">Copies</p>
              <p className="font-semibold text-slate-700 dark:text-slate-200">
                {getPersonalBookAvailabilityLabel(book)}
              </p>
            </div>
          </div>
          {book.lendingEnabled && (
            <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
              <div className="flex items-start gap-2">
                <MapPin size={15} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                    Handover Arrangement
                  </p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {getHandoverMethodLabel(book.handoverMethod)}
                  </p>
                  {book.handoverDetails && (
                    <p className="mt-1 text-xs text-slate-600">{book.handoverDetails}</p>
                  )}
                </div>
              </div>
            </div>
          )}
          {book.summary && (
            <div className="mt-3">
              <p className="text-xs text-slate-500 line-clamp-3">{book.summary}</p>
            </div>
          )}
        </div>
      </div>
    );
  };
  const renderCommunityBookCard = (book) => (
    <button
      key={book.id}
      type="button"
      onClick={() => setSelectedBook(book)}
      className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden text-left transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-violet-100 text-violet-700 px-2 py-1 rounded">
                Community Book
              </span>
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${
                  getPersonalBookCopyAvailability(book).availableCopies > 0
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-700'
                }`}
              >
                {getPersonalBookAvailabilityLabel(book)}
              </span>
            </div>
            <h3 className="font-bold text-slate-800 text-sm line-clamp-2">
              {book.title || 'Untitled Book'}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              By {book.author || 'Unknown Author'}
            </p>
          </div>
          <Users size={22} className="shrink-0 text-violet-500" aria-hidden="true" />
        </div>
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Category</span>
            <span className="font-semibold text-slate-700">{book.category || 'Uncategorized'}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Condition</span>
            <span className="font-semibold text-slate-700">{book.condition || 'Good'}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1">
              <Clock3 size={12} aria-hidden="true" />
              Lending period
            </span>
            <span className="font-semibold text-slate-700">
              {book.lendingPeriodDays || 7} days
            </span>
          </div>
        </div>
        {book.handoverMethod && (
          <div className="mt-4 rounded-lg bg-slate-50 p-3">
            <div className="flex items-start gap-2">
              <MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
              <div>
                <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                  Handover Arrangement
                </p>
                <p className="text-xs font-semibold text-slate-700 mt-0.5">
                  {getHandoverMethodLabel(book.handoverMethod)}
                </p>
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
  // RENDER MAIN OPAC LAYOUT
  // =========================================================
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans">
      
      {/* 1. TOP NAVBAR FOR BRANDING AND VISUAL BREATHING ROOM */}
      <header className="bg-slate-900 text-white shadow-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
            <div className="flex items-center gap-1.5">
              <span className="text-2xl font-black tracking-wider text-blue-400">SHELF</span>
              <span className="text-xs bg-blue-600 px-2 py-0.5 rounded font-semibold text-white">OPAC</span>
            </div>
            <span className="text-xs text-slate-400 border-l border-slate-700 pl-3 hidden sm:inline">
              Public Catalog Search
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button 
              type="button"
              onClick={() => navigate('/')} 
              className="text-xs font-semibold text-slate-300 hover:text-white transition px-3 py-1.5 rounded-lg hover:bg-slate-800"
            >
              &larr; Back to Home
            </button>
            {!user?.id ? (
              <button 
                type="button"
                onClick={() => navigate('/visitor-register')} 
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition shadow"
              >
                Sign In
              </button>
            ) : (
              <span className="text-xs font-semibold text-blue-400 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">
                {user.email || 'Visitor'}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* 2. MAIN CONTAINER WITH TOP PADDING & MARGIN */}
      <main className="max-w-7xl mx-auto px-6 pt-6 pb-12 space-y-6">
        
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

        {(activeView === 'communityBooks' || activeView === 'personalBooks') && (
          <div className="flex flex-col sm:flex-row gap-3">
            <form onSubmit={handleSearch} className="flex flex-1 gap-2">
              <input
                type="text"
                placeholder={
                  activeView === 'communityBooks'
                    ? 'Search community books...'
                    : 'Search your personal books...'
                }
                value={searchInput}
                onChange={handleSearchInputChange}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
              />
              <button
                type="submit"
                className="px-5 py-2.5 bg-shelf-primary text-white rounded-lg text-sm font-bold hover:opacity-90"
              >
                Search
              </button>
            </form>
            {searchTerm && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-lg text-sm font-bold hover:bg-slate-200"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {activeView === 'catalog' ? (
          <div className="space-y-6">
            {mapLibrary && (
              <div
                className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm relative"
                id="library-map-section"
              >
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-800 dark:text-white">
                      {mapLibrary.name}
                    </h2>
                    <p className="text-xs text-slate-500">
                      {mapLibrary.address || 'Location Map'}
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
                  focusBranchId={mapLibrary.id}
                  bookContext={mapBookContext}
                />
              </div>
            )}
            
            {/* SEARCH AND FILTER CONTAINER */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row gap-3 flex-wrap">
              <form onSubmit={handleSearch} className="flex flex-1 min-w-70 gap-2">
                <input
                  type="text"
                  placeholder="Search by Title, Author, ISBN, or Category..."
                  value={searchInput}
                  onChange={handleSearchInputChange}
                  className="flex-1 min-w-0 px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                  aria-label="Search catalog"
                />
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-shelf-primary text-white rounded-lg text-sm font-bold hover:opacity-90 transition shrink-0"
                >
                  Search
                </button>
              </form>
              {searchTerm && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-lg text-sm font-bold hover:bg-slate-200 transition shrink-0"
                >
                  Clear
                </button>
              )}
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
                aria-label="Sort catalog books"
                className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none cursor-pointer"
              >
                <option value="title-asc">Title (A–Z)</option>
                <option value="title-desc">Title (Z–A)</option>
                <option value="author-asc">Author (A–Z)</option>
                <option value="author-desc">Author (Z–A)</option>
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="available">Most Available</option>
                <option value="unavailable">Least Available</option>
              </select>
              {!libraryFilter && (
                <select
                  value={selectedLibrary}
                  onChange={(event) => setSelectedLibrary(event.target.value)}
                  className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none cursor-pointer"
                >
                  <option value="All">All Libraries</option>
                  {libraryOptions
                    .filter((libraryId) => libraryId !== 'All')
                    .map((libraryId) => (
                      <option key={libraryId} value={libraryId}>
                        {libraryName(libraryId)}
                      </option>
                    ))}
                </select>
              )}
              <select
                value={selectedAvailability}
                onChange={(event) => setSelectedAvailability(event.target.value)}
                className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none cursor-pointer"
              >
                <option value="All">All Statuses</option>
                <option value="Available">Available Only</option>
                <option value="Unavailable">Unavailable Only</option>
              </select>
            </div>

            {searchTerm && (
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>
                  Search results for: <strong className="text-slate-800">"{searchTerm}"</strong>
                </span>
                <span>
                  {filteredBooks.length} {filteredBooks.length === 1 ? 'book' : 'books'} found
                </span>
              </div>
            )}
            {selectedCategory !== 'All' && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                <div>
                  <h2 className="text-base font-bold text-slate-800">
                    Books in {selectedCategory}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {filteredBooks.length} catalog {filteredBooks.length === 1 ? 'entry' : 'entries'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCategory('All')}
                  className="text-xs font-semibold text-shelf-primary hover:underline"
                >
                  Clear category
                </button>
              </div>
            )}
            {books.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center">
                <span className="mx-auto grid size-14 place-items-center rounded-full bg-amber-50 text-amber-700">
                  <BookOpen size={26} aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-lg font-bold text-slate-800">
                  The shelves are waiting for their first readers.
                </h3>
                <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                  This catalog is being prepared. Explore nearby branches while new titles are added.
                </p>
                <button
                  type="button"
                  onClick={() => onViewChange?.('map')}
                  className="mt-5 inline-flex items-center gap-2 rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90"
                >
                  <MapPinned size={16} aria-hidden="true" />
                  Explore library locations
                </button>
              </div>
            ) : filteredBooks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center">
                <Search size={28} className="mx-auto text-slate-400" aria-hidden="true" />
                <h3 className="mt-3 text-base font-bold text-slate-800">
                  Nothing on the shelf matched that search.
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Try another title or clear your filters to see more books.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    handleClearSearch();
                    setSelectedCategory('All');
                    setSelectedLibrary('All');
                    setSelectedAvailability('All');
                  }}
                  className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  Clear All Filters
                </button>
              </div>
            ) : (
              <div className="book-card-grid grid gap-6">
                {filteredBooks.map((book) => (
                  <button
                    type="button"
                    key={book.id}
                    onClick={() => setSelectedBook(book)}
                    aria-label={`View details for ${book.title || 'Untitled Book'}`}
                    className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md flex flex-col justify-between text-left"
                  >
                    <div className="p-4 flex gap-4">
                      <img
                        src={book.coverUrl || 'https://placehold.co/96x128?text=No+Cover'}
                        alt={book.title || 'Book cover'}
                        className="w-20 h-28 object-cover rounded-md border border-slate-200 bg-slate-50"
                        onError={(event) => {
                          event.currentTarget.src = 'https://placehold.co/96x128?text=No+Cover';
                        }}
                      />
                      <div className="space-y-1 min-w-0">
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                          {book.category || 'Uncategorized'}
                        </span>
                        <h3 className="font-bold text-slate-800 text-sm line-clamp-2">
                          {book.title || 'Untitled Book'}
                        </h3>
                        <p className="text-xs text-slate-500">
                          {book.author || 'Unknown Author'}
                        </p>
                        <p className="text-xs text-slate-400 font-mono">
                          ISBN: {book.isbn || 'N/A'}
                        </p>
                        <div className="pt-2">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                              Number(book.availableCopies || 0) > 0
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {Number(book.availableCopies || 0) > 0
                              ? `${book.availableCopies} Copies Available`
                              : 'Unavailable'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : activeView === 'categories' ? (
          <section aria-labelledby="opac-category-heading" className="space-y-5">
            <div>
              <h2 id="opac-category-heading" className="text-lg font-bold text-slate-800">
                Book Categories
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Unique titles across participating libraries
              </p>
            </div>
            {categorySummaries.length ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {categorySummaries.map(({ label, count }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      setSelectedCategory(label);
                      setSearchInput('');
                      setSearchTerm('');
                      setSelectedLibrary('All');
                      setSelectedAvailability('All');
                      onViewChange('catalog');
                    }}
                    className="flex min-h-16 items-center justify-between gap-3 border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-shelf-primary hover:bg-blue-50"
                  >
                    <span className="min-w-0 text-sm font-semibold text-slate-700">
                      {label}
                    </span>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                      {count} {count === 1 ? 'book' : 'books'}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="border border-dashed border-slate-300 px-4 py-5 text-center text-sm text-slate-500">
                No book categories are available yet.
              </p>
            )}
          </section>
        ) : activeView === 'readingList' ? (
          <section className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <ClipboardList size={20} className="text-amber-600" aria-hidden="true" />
                  <h2 className="text-lg font-bold text-slate-800">
                    My Reading List
                  </h2>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Books you want to revisit later.
                </p>
              </div>
            </div>
            {readingListLoading ? (
              <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
                <p className="text-sm text-slate-500">
                  Loading your reading list...
                </p>
              </div>
            ) : readingListBooks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
                <Bookmark size={32} className="mx-auto text-slate-300" aria-hidden="true" />
                <h3 className="mt-3 text-base font-bold text-slate-700">
                  Your reading list is empty. Go explore the catalog!
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Save books you want to revisit later from the catalog or book details.
                </p>
              </div>
            ) : (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {readingListBooks.map((book) => (
                  <div
                    key={book.id}
                    className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                            {book.category || 'Uncategorized'}
                          </span>
                          <h3 className="mt-2 text-base font-bold text-slate-800 line-clamp-2">
                            {book.title || 'Untitled Book'}
                          </h3>
                          <p className="mt-1 text-xs text-slate-500">
                            By {book.author || 'Unknown Author'}
                          </p>
                        </div>
                        <BookOpen size={22} className="shrink-0 text-slate-400" aria-hidden="true" />
                      </div>
                      <div className="mt-4 space-y-2 text-xs text-slate-600">
                        <div className="flex items-center justify-between gap-2">
                          <span>Availability</span>
                          <span className={`rounded-full px-2 py-0.5 font-bold ${
                            Number(book.availableCopies || 0) > 0
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}>
                            {Number(book.availableCopies || 0) > 0
                              ? `${book.availableCopies} available`
                              : 'Unavailable'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span>ISBN</span>
                          <span className="font-mono text-slate-500">
                            {book.isbn || 'N/A'}
                          </span>
                        </div>
                      </div>
                      <div className="mt-4 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedBook(book)}
                          className="flex-1 rounded-lg bg-shelf-primary px-3 py-2 text-xs font-bold text-white hover:opacity-90"
                        >
                          View Details
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleReadingList(book)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={savingReadingListBookId === book.id}
                        >
                          {savingReadingListBookId === book.id ? 'Saving...' : 'Remove'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : activeView === 'communityBooks' ? (
          <section className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Users size={20} className="text-violet-600" aria-hidden="true" />
                  <h2 className="text-lg font-bold text-slate-800">
                    Community Books
                  </h2>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Books shared by SHELF visitors for community lending.
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
                  Loading community books...
                </p>
              </div>
            ) : filteredCommunityBooks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
                <Users size={32} className="mx-auto text-slate-300" aria-hidden="true" />
                <h3 className="mt-3 text-base font-bold text-slate-700">
                  No community books available yet.
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  When visitors share books for lending, they will appear here.
                </p>
              </div>
            ) : (
              <div className="book-card-grid grid gap-5">
                {filteredCommunityBooks.map(renderCommunityBookCard)}
              </div>
            )}
          </section>
        ) : activeView === 'personalBooks' ? (
          <section className="flex flex-col gap-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <UserRound size={20} className="text-blue-600" aria-hidden="true" />
                  <h2 className="text-lg font-bold text-slate-800">
                    My Personal Books
                  </h2>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Manage books that you personally own and optionally share with the SHELF community.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!requireAuth('add personal books')) return;
                  setEditingPersonalBook(null);
                  resetPersonalBookForm();
                  setShowAddPersonalBook(true);
                }}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-bold text-white hover:opacity-90"
              >
                <Plus size={16} aria-hidden="true" />
                Add Personal Book
              </button>
            </div>
            <div className="order-3 rounded-xl border border-violet-200 bg-white shadow-sm overflow-hidden dark:border-slate-700 dark:bg-slate-800">
              <div className="px-5 py-4 border-b border-violet-100 bg-violet-50 dark:border-slate-700 dark:bg-slate-800">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-violet-900 dark:text-violet-200">
                      Community Book Requests
                    </h3>
                    <p className="mt-1 text-xs text-violet-300">
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
              {(ownerCommunityRequestError || ownerCommunityRequestLoadError) && (
                <div className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  {ownerCommunityRequestError || ownerCommunityRequestLoadError}
                </div>
              )}
              {communityRequestNotice && (
                <div className="mx-5 mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                  {communityRequestNotice}
                </div>
              )}
              {!loadingOwnerCommunityRequests && ownerCommunityRequests.length > 0 && (
                <div className="flex gap-2 overflow-x-auto border-b border-slate-100 px-5 py-3 dark:border-slate-700">
                  {OWNER_COMMUNITY_REQUEST_FILTERS.map((filter) => {
                    const count =
                      filter.key === 'all'
                        ? ownerCommunityRequests.length
                        : ownerCommunityRequestCounts[filter.status] || 0;
                    const isSelected = ownerCommunityRequestFilter === filter.key;
                    return (
                      <button
                        key={filter.key}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setOwnerCommunityRequestFilter(filter.key)}
                        className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                          isSelected
                            ? 'border-shelf-primary bg-shelf-primary text-white'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:text-shelf-primary dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:border-slate-400 dark:hover:text-white'
                        }`}
                      >
                        {filter.label}
                        <span className={`ml-1.5 ${isSelected ? 'text-violet-100' : 'text-slate-400'}`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
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
                  <p className="mt-2 text-sm font-semibold text-slate-600 dark:text-slate-200">
                    No community book requests yet.
                  </p>
                  <p className="mt-1 text-xs text-slate-400 dark:text-slate-400">
                    Requests from other visitors will appear here when they ask to borrow one of your books.
                  </p>
                </div>
              ) : filteredOwnerCommunityRequests.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No requests in this category.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-700">
                  {filteredOwnerCommunityRequests.map((request) => {
                    const status = getOwnerCommunityRequestStatus(request);
                    const isProcessing = processingCommunityRequestId === request.id;
                    return (
                      <div
                        key={request.id}
                        id={`community-owner-request-${request.id}`}
                        className="p-5"
                      >
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-violet-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-700">
                              Community Request
                            </span>
                            <span
                              className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                                status === 'approved'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : status === 'borrowed'
                                    ? 'bg-blue-100 text-blue-700'
                                    : status === 'returned'
                                      ? 'bg-slate-100 text-slate-700'
                                      : status === 'rejected'
                                        ? 'bg-red-100 text-red-700'
                                        : 'bg-amber-100 text-amber-700'
                              }`}
                            >
                              {status === 'approved'
                                ? 'Approved'
                                : status === 'borrowed'
                                  ? 'Borrowed'
                                  : status === 'returned'
                                    ? 'Returned'
                                    : status === 'rejected'
                                      ? 'Rejected'
                                      : 'Pending'}
                            </span>
                          </div>
                          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                            {request.bookTitle || 'Untitled Book'}
                          </h4>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Requested by{' '}
                            <span className="font-semibold text-slate-700 dark:text-slate-200">
                              {request.requesterName || 'SHELF Visitor'}
                            </span>
                          </p>
                          <p className="text-[11px] text-slate-400 dark:text-slate-400">
                            Requested: {formatDateTime(request.requestDate)}
                          </p>
                          {request.ownerResponse && (
                            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Owner response
                              </p>
                              <p className="mt-1 text-xs text-slate-600">
                                {request.ownerResponse}
                              </p>
                            </div>
                          )}
                        </div>
                        {status === 'pending' && (
                          <div className="mt-4 flex flex-col sm:flex-row gap-2">
                            <button
                              type="button"
                              disabled={Boolean(processingCommunityRequestId)}
                              onClick={() => handleApproveCommunityRequest(request)}
                              className="rounded-lg bg-shelf-primary px-4 py-2.5 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isProcessing ? 'Processing...' : 'Confirm'}
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
                        {status === 'approved' && (
                          <div className="mt-4 w-full rounded-xl border-2 border-blue-300 bg-blue-50 p-4">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-blue-600" />
                              <p className="text-xs font-black uppercase tracking-wider text-blue-800">
                                Approved — Awaiting Handover
                              </p>
                            </div>
                            <p className="mt-2 text-xs text-blue-700">
                              This request has been approved. After you physically hand the book to the requester, click the button below.
                            </p>
                            <button
                              type="button"
                              disabled={Boolean(processingCommunityRequestId)}
                              onClick={() => handleConfirmCommunityBookPickup(request)}
                              className="mt-4 w-full rounded-lg bg-shelf-primary px-5 py-3 text-sm font-black text-white transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isProcessing ? 'Processing...' : 'Confirm'}
                            </button>
                          </div>
                        )}
                        {status === 'borrowed' && (
                          <div className="mt-4 w-full rounded-xl border-2 border-violet-300 bg-violet-50 p-4">
                            <p className="text-xs font-black uppercase tracking-wider text-violet-800">
                              Book Currently Borrowed
                            </p>
                            <p className="mt-2 text-xs text-violet-700">
                              Confirm the return after the requester gives the book back to you.
                            </p>
                            <button
                              type="button"
                              disabled={Boolean(processingCommunityRequestId)}
                              onClick={() => handleConfirmCommunityBookReturn(request)}
                              className="mt-4 w-full rounded-lg bg-shelf-primary px-5 py-3 text-sm font-black text-white transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isProcessing ? 'Processing...' : 'Confirm'}
                            </button>
                          </div>
                        )}
                        {status === 'returned' && (
                          <div className="mt-4 w-full rounded-lg border border-slate-200 bg-slate-100 px-4 py-3">
                            <p className="text-xs font-bold text-slate-700">
                              Book Returned
                            </p>
                            <p className="mt-1 text-[11px] text-slate-500">
                              This community book transaction is complete.
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {personalBookError && (
              <div className="order-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                {personalBookError}
              </div>
            )}
            {loadingPersonalBooks ? (
              <div className="order-2 rounded-xl border border-slate-200 bg-white p-10 text-center">
                <p className="text-sm text-slate-500">
                  Loading your personal books...
                </p>
              </div>
            ) : filteredPersonalBooks.length === 0 ? (
              <div className="order-2 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
                <UserRound size={32} className="mx-auto text-slate-300" aria-hidden="true" />
                <h3 className="mt-3 text-base font-bold text-slate-700">
                  You have no personal books yet.
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Add a book that you personally own to keep it in your SHELF collection.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (!requireAuth('add personal books')) return;
                    setEditingPersonalBook(null);
                    resetPersonalBookForm();
                    setShowAddPersonalBook(true);
                  }}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-shelf-primary px-4 py-2.5 text-xs font-bold text-white transition hover:opacity-90"
                >
                  <Plus size={15} aria-hidden="true" />
                  Add Your First Book
                </button>
              </div>
            ) : (
              <div className="book-card-grid order-2 grid gap-5">
                {filteredPersonalBooks.map(renderPersonalBookCard)}
              </div>
            )}
          </section>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
            {myRequests.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">
                You have no borrow requests yet. Browse the catalog to get started.
              </p>
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
                  {myRequests.map((request) => {
                    const currentFine = calculateCurrentFine(request);
                    const isCommunityRequest =
                      request?.isCommunityBook === true ||
                      request?.requestType === 'community';
                    const isOverdue =
                      !isCommunityRequest &&
                      request.status === 'borrowed' &&
                      currentFine > 0;
                    const overdueDays =
                      request.dueDate && isOverdue
                        ? calculateOverdueDays(request.dueDate)
                        : 0;
                    const canCancel =
                      !isCommunityRequest &&
                      ['queued', 'ready_for_pickup'].includes(request.status);
                    const isCancelling = cancellingRequestId === request.id;
                    const queuePosition =
                      request.queuePosition ??
                      request.queue_position ??
                      request.position;
                    return (
                      <tr
                        key={request.id}
                        id={`borrow-request-${request.id}`}
                        className={`hover:bg-slate-50 ${
                          String(focusRequestId) === String(request.id)
                            ? 'bg-amber-50 ring-2 ring-inset ring-amber-400'
                            : ''
                        }`}
                      >
                        <td className="p-4 font-bold text-slate-800">
                          <div className="flex flex-col gap-1">
                            <span>{request.bookTitle || 'Untitled Book'}</span>
                            {isCommunityRequest && (
                              <span className="w-fit text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-bold uppercase tracking-wide">
                                Community Book
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-4">
                          <span
                            className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                              isOverdue
                                ? 'bg-red-100 text-red-700'
                                : STATUS_STYLES[request.status] ||
                                  (isCommunityRequest && request.status === 'pending')
                                  ? 'bg-amber-100 text-amber-700'
                                  : (isCommunityRequest && request.status === 'approved')
                                    ? 'bg-green-100 text-green-700'
                                    : (isCommunityRequest && request.status === 'rejected')
                                      ? 'bg-red-100 text-red-700'
                                      : (isCommunityRequest && request.status === 'cancelled')
                                        ? 'bg-slate-100 text-slate-600'
                                        : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {isOverdue
                              ? 'Overdue'
                              : isCommunityRequest
                                ? request.status === 'pending'
                                  ? 'Pending Approval'
                                  : request.status === 'approved'
                                    ? 'Approved'
                                    : request.status === 'rejected'
                                      ? 'Rejected'
                                      : request.status === 'cancelled'
                                        ? 'Cancelled'
                                        : STATUS_LABELS[request.status] ||
                                          request.status ||
                                          'Pending'
                                : STATUS_LABELS[request.status] || request.status}
                          </span>
                        </td>
                        <td className="p-4 text-xs text-slate-500 space-y-1">
                          {isCommunityRequest && (
                            <>
                              <p className="font-semibold text-violet-700">
                                Community Book Request
                              </p>
                              <p>
                                Requested:{' '}
                                {request.requestDate
                                  ? formatDateTime(request.requestDate)
                                  : '—'}
                              </p>
                              {request.ownerName && (
                                <p>Owner: {request.ownerName}</p>
                              )}
                              {request.status === 'pending' && (
                                <div className="space-y-1">
                                  <p className="font-semibold text-amber-600">
                                    Waiting for the book owner to approve your request.
                                  </p>
                                  {request.queuePosition != null && (
                                    <p className="font-semibold text-violet-700">
                                      Queue position: #{request.queuePosition}
                                    </p>
                                  )}
                                </div>
                              )}
                              {request.status === 'approved' && (
                                <div className="space-y-1">
                                  <p className="font-semibold text-green-600">
                                    Your request was approved by the book owner.
                                  </p>
                                  <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                                    <p className="font-bold">Arrange the handover with the owner</p>
                                    {request.ownerContactEmail && (
                                      <p className="mt-1">Email: {request.ownerContactEmail}</p>
                                    )}
                                    {request.ownerContactNumber && (
                                      <p className="mt-1">Phone: {request.ownerContactNumber}</p>
                                    )}
                                    {request.ownerContactDetails && (
                                      <p className="mt-1 whitespace-pre-wrap">
                                        Additional details: {request.ownerContactDetails}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )}
                              {request.status === 'borrowed' && (
                                <div className="space-y-1 font-semibold text-blue-700">
                                  <p>
                                    This book is borrowed from{' '}
                                    {request.ownerName || 'the owner'}.
                                  </p>
                                  {request.dueDate && (
                                    <p>
                                      Please return it by {formatDate(request.dueDate)}.
                                    </p>
                                  )}
                                  {(request.ownerContactEmail ||
                                    request.ownerContactNumber ||
                                    request.ownerContactDetails) && (
                                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs font-normal text-blue-900">
                                      {request.ownerContactEmail && (
                                        <p>Email: {request.ownerContactEmail}</p>
                                      )}
                                      {request.ownerContactNumber && (
                                        <p className="mt-1">Phone: {request.ownerContactNumber}</p>
                                      )}
                                      {request.ownerContactDetails && (
                                        <p className="mt-1 whitespace-pre-wrap">
                                          Additional details: {request.ownerContactDetails}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                              {request.status === 'rejected' && (
                                <p className="font-semibold text-red-600">
                                  Your request was rejected by the book owner.
                                </p>
                              )}
                              {request.status === 'returned' && (
                                <p className="font-semibold text-slate-600">
                                  {request.returnDate
                                    ? `Returned on ${formatDate(request.returnDate)}.`
                                    : 'This community book has been returned to the owner.'}
                                </p>
                              )}
                              {request.status === 'cancelled' && (
                                <p className="font-semibold text-slate-500">
                                  This community book request was cancelled.
                                </p>
                              )}
                              {request.ownerResponse && (
                                <p>Owner response: {request.ownerResponse}</p>
                              )}
                            </>
                          )}
                          {!isCommunityRequest && request.status === 'queued' && (
                            <p>
                              Queue position:{' '}
                              {queuePosition !== undefined && queuePosition !== null
                                ? `#${queuePosition}`
                                : 'Pending'}
                            </p>
                          )}
                          {!isCommunityRequest && request.status === 'ready_for_pickup' && (
                            <>
                              <p className="font-semibold text-amber-700">
                                Ready for pickup.
                              </p>
                              <p>Pick up by: {formatDateTime(request.pickupDeadline)}</p>
                              <p>Please scan your QR pass at the library.</p>
                            </>
                          )}
                          {!isCommunityRequest && request.status === 'borrowed' && (
                            <>
                              <p>Due: {formatDate(request.dueDate)}</p>
                              {isOverdue && (
                                <p className="font-bold text-red-600">
                                  Overdue by {overdueDays} day{overdueDays !== 1 ? 's' : ''}
                                </p>
                              )}
                            </>
                          )}
                          {!isCommunityRequest && request.status === 'returned' && (
                            <p>Returned: {formatDate(request.returnDate)}</p>
                          )}
                        </td>
                        <td
                          className={`p-4 font-mono font-bold text-xs ${
                            currentFine > 0 ? 'text-red-600' : 'text-slate-500'
                          }`}
                        >
                          {"\u20B1"}{currentFine.toFixed(2)}
                        </td>
                        <td className="p-4 text-right">
                          {canCancel && (
                            <button
                              type="button"
                              disabled={Boolean(cancellingRequestId)}
                              onClick={() => handleCancel(request.id)}
                              className="bg-red-50 text-red-600 text-xs px-3 py-1.5 rounded-lg font-bold hover:bg-red-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isCancelling ? 'Cancelling...' : 'Cancel'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </main>

      {/* =====================================================
          AUTHENTICATION REQUIRED POP-UP MODAL (FOR GUEST USERS)
      ====================================================== */}
      {showAuthModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 dark:border-slate-700 text-center animate-in fade-in zoom-in duration-150">
            <div className="w-12 h-12 bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock size={24} />
            </div>
            <h3 className="text-xl font-extrabold text-slate-900 dark:text-white">Sign In Required</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">
              You need an active visitor account to {pendingActionText || 'perform this action'}.
            </p>
            <div className="flex flex-col gap-2 mt-6">
              <button
                type="button"
                onClick={() => {
                  setShowAuthModal(false);
                  navigate('/visitor-register');
                }}
                className="w-full py-2.5 bg-shelf-primary hover:opacity-90 text-white font-bold rounded-lg transition shadow-md text-sm"
              >
                Sign In / Register Now
              </button>
              <button
                type="button"
                onClick={() => setShowAuthModal(false)}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold rounded-lg transition text-xs dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
              >
                Continue Browsing as Guest
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================
          REJECT COMMUNITY REQUEST MODAL
      ====================================================== */}
      {showRejectCommunityRequest && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-70 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 dark:border-slate-700">
            <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-700 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">
                  Reject Community Book Request
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
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
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <div className="p-6 space-y-4 text-slate-700 dark:text-slate-200">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                  Reason / Response (Optional)
                </label>
                <textarea
                  value={communityRequestResponse}
                  onChange={(event) => setCommunityRequestResponse(event.target.value)}
                  maxLength={500}
                  rows={4}
                  placeholder="Add a short message for the requester."
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 resize-none"
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
                  className="px-4 py-2.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 disabled:opacity-50"
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
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl border border-slate-200">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="text-lg font-bold text-slate-800">
                  {editingPersonalBook ? 'Edit Personal Book' : 'Add Personal Book'}
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  {editingPersonalBook
                    ? 'Update the details of your personal book.'
                    : 'Add a book that you personally own.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (savingPersonalBook) return;
                  setShowAddPersonalBook(false);
                  setEditingPersonalBook(null);
                  resetPersonalBookForm();
                }}
                disabled={savingPersonalBook}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={handleSavePersonalBook} className="p-6 space-y-5 text-slate-700 dark:text-slate-200">
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  Book Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                      Book Title *
                    </label>
                    <input
                      type="text"
                      value={personalBookForm.title}
                      onChange={(event) => updatePersonalBookForm('title', event.target.value)}
                      placeholder="Enter book title"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                      Author *
                    </label>
                    <input
                      type="text"
                      value={personalBookForm.author}
                      onChange={(event) => updatePersonalBookForm('author', event.target.value)}
                      placeholder="Author name"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-200">
                      Category
                    </label>
                    <select
                      value={personalBookForm.category || ''}
                      onChange={(event) => updatePersonalBookForm('category', event.target.value)}
                      className="w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <option value="">Select a category</option>
                      {personalBookCategories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                      <option value="Others">Others</option>
                    </select>
                    {personalBookForm.category === 'Others' && (
                      <input
                        type="text"
                        value={personalBookForm.customCategory}
                        onChange={(event) => updatePersonalBookForm('customCategory', event.target.value)}
                        placeholder="Enter a custom category"
                        className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                        maxLength={80}
                        required
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                      ISBN
                    </label>
                    <input
                      type="text"
                      value={personalBookForm.isbn}
                      onChange={(event) => updatePersonalBookForm('isbn', event.target.value)}
                      placeholder="Optional ISBN"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                      Condition *
                    </label>
                    <select
                      value={personalBookForm.condition}
                      onChange={(event) => updatePersonalBookForm('condition', event.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                      required
                    >
                      {PERSONAL_BOOK_CONDITIONS.map((condition) => (
                        <option key={condition} value={condition}>
                          {condition}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                      Number of Copies *
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={personalBookForm.totalCopies}
                      onChange={(event) => updatePersonalBookForm('totalCopies', event.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
                      required
                    />
                    <p className="mt-1 text-[10px] text-slate-400">
                      Enter how many copies you own. Borrowed copies will be marked unavailable.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                      Summary
                    </label>
                    <textarea
                      value={personalBookForm.summary}
                      onChange={(event) => updatePersonalBookForm('summary', event.target.value)}
                      placeholder="Brief description of the book"
                      rows={3}
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 resize-none"
                    />
                  </div>
                </div>
              </div>
              <div className="border-t border-slate-200 pt-5 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Community Book Visibility
                </h3>
                <div className="flex flex-col gap-2 sm:flex-row">
                  {[
                    { value: true, label: 'Public' },
                    { value: false, label: 'Only Me' },
                  ].map(({ value, label }) => (
                    <label
                      key={label}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${
                        personalBookForm.isPublic === value
                          ? 'border-shelf-primary bg-blue-50 text-shelf-primary'
                          : 'border-slate-200 text-slate-600'
                      }`}
                    >
                      <input
                        type="radio"
                        name="opac-personal-book-visibility"
                        checked={personalBookForm.isPublic === value}
                        onChange={() => updatePersonalBookForm('isPublic', value)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500">
                  Public books appear in Community Books. Only Me books are visible only in your personal collection.
                </p>
              </div>
              <div className="border-t border-slate-200 pt-5 space-y-4">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Community Lending
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Choose whether other SHELF visitors may request this book.
                  </p>
                </div>
                <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={personalBookForm.lendingEnabled}
                    onChange={(event) => updatePersonalBookForm('lendingEnabled', event.target.checked)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-bold text-slate-700">
                      Make this book available for community lending
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Visitors can request this book only when it is Public. Requests still require your approval.
                    </p>
                  </div>
                </label>
                {personalBookForm.lendingEnabled && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                        Lending Period *
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          min={PERSONAL_BOOK_MIN_LENDING_DAYS}
                          max={PERSONAL_BOOK_MAX_LENDING_DAYS}
                          value={personalBookForm.lendingPeriodDays}
                          onChange={(event) => updatePersonalBookForm('lendingPeriodDays', event.target.value)}
                          className="w-full px-3 py-2.5 pr-16 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
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
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                        Handover Method *
                      </label>
                      <select
                        value={personalBookForm.handoverMethod}
                        onChange={(event) => updatePersonalBookForm('handoverMethod', event.target.value)}
                        className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                        required={personalBookForm.lendingEnabled}
                      >
                        <option value="arrange_with_owner">Arrange with Owner</option>
                        <option value="meet_in_person">Meet in Person</option>
                        <option value="public_place">Public Place</option>
                        <option value="courier">Courier / Delivery</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                        Additional Contact Details
                      </label>
                      <textarea
                        value={personalBookForm.handoverDetails}
                        onChange={(event) => updatePersonalBookForm('handoverDetails', event.target.value)}
                        placeholder="Add any extra contact details or instructions for arranging the handover."
                        maxLength={500}
                        rows={3}
                        className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 resize-none"
                      />
                      <p className="text-[10px] text-slate-400 mt-1">
                        Optional, maximum 500 characters. Handover is arranged directly between users, not through a library.
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3">
                <p className="text-xs font-bold text-violet-800">
                  Community lending note
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-violet-700">
                  Your personal book will remain owned by you. If you enable lending, other visitors can see the book in Community Books. Every request requires owner approval.
                </p>
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={savingPersonalBook}
                  onClick={() => {
                    setShowAddPersonalBook(false);
                    setEditingPersonalBook(null);
                    resetPersonalBookForm();
                  }}
                  className="px-4 py-2.5 rounded-lg bg-slate-100 text-slate-600 text-sm font-bold hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPersonalBook}
                  className="px-5 py-2.5 rounded-lg bg-shelf-primary text-white text-sm font-bold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingPersonalBook
                    ? editingPersonalBook
                      ? 'Saving Changes...'
                      : 'Adding Book...'
                    : editingPersonalBook
                      ? 'Save Changes'
                      : 'Add Personal Book'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {personalBookToRemove && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-personal-book-title"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
          >
            <h2 id="remove-personal-book-title" className="text-lg font-bold text-slate-900">
              Remove personal book?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              This will permanently remove “{personalBookToRemove.title || 'Personal book'}” from your collection. Books with community request history cannot be removed.
            </p>
            {personalBookRemovalError && (
              <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {personalBookRemovalError}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={removingPersonalBookId === personalBookToRemove.id}
                onClick={() => {
                  setPersonalBookToRemove(null);
                  setPersonalBookRemovalError('');
                }}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={removingPersonalBookId === personalBookToRemove.id}
                onClick={handleRemovePersonalBook}
                className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {removingPersonalBookId === personalBookToRemove.id
                  ? 'Removing...'
                  : 'Remove Book'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================
          VIEW DETAILS & BORROW MODAL
      ====================================================== */}
      {selectedBook && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-5 border border-slate-200 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setSelectedBook(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 font-bold"
              aria-label="Close book information"
            >
              <X size={18} aria-hidden="true" />
            </button>
            <div className="flex gap-4 pr-8">
              <img
                src={selectedBook.coverUrl || 'https://placehold.co/96x128?text=No+Cover'}
                alt={selectedBook.title || 'Book cover'}
                className="w-24 h-32 object-cover rounded-lg border border-slate-200 bg-slate-50"
                onError={(event) => {
                  event.currentTarget.src = 'https://placehold.co/96x128?text=No+Cover';
                }}
              />
              <div className="space-y-1">
                <div className="flex flex-wrap gap-2">
                  {selectedBook.bookType === 'personal' ? (
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
                  {selectedBook.title || 'Untitled Book'}
                </h3>
                <p className="text-xs text-slate-500">
                  By {selectedBook.author || 'Unknown Author'}
                </p>
                <p className="text-xs text-slate-400 font-mono">
                  ISBN: {selectedBook.isbn || 'N/A'}
                </p>
              </div>
            </div>
            {selectedBook.bookType === 'personal' && (
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
                      {selectedBook.condition || 'Good'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-violet-500 uppercase font-bold">
                      Lending Period
                    </p>
                    <p className="text-xs font-semibold text-slate-700">
                      {selectedBook.lendingPeriodDays || 7} days
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-violet-500 uppercase font-bold">
                      Copies
                    </p>
                    <p className="text-xs font-semibold text-slate-700">
                      {getPersonalBookAvailabilityLabel(selectedBook)}
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-[10px] text-violet-500 uppercase font-bold">
                      Handover Arrangement
                    </p>
                    <p className="text-xs font-semibold text-slate-700">
                      {getHandoverMethodLabel(selectedBook.handoverMethod)}
                    </p>
                  </div>
                </div>
                <div className="rounded-lg bg-white border border-violet-100 px-3 py-2">
                  <p className="text-[11px] font-semibold text-violet-700">
                    Owner approval is required before borrowing. Contact details are shared with the requester after approval.
                  </p>
                </div>
              </div>
            )}
            <div className="space-y-1 bg-slate-50 p-3 rounded-lg border border-slate-100">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Book Summary
              </h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                {selectedBook.summary || 'No summary provided yet.'}
              </p>
            </div>
            {selectedBook.isExternalCatalog && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2">
                <p className="text-sm font-bold text-amber-900">
                  External Catalog — Not Available for Borrowing
                </p>
                <p className="text-xs text-amber-800">
                  This book was discovered through an external catalog. SHELF does not have a confirmed physical copy for this entry.
                </p>
                {selectedBook.sourceUrl && (
                  <a
                    href={selectedBook.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-sm font-bold text-blue-700 underline hover:text-blue-900"
                  >
                    View book on Open Library
                  </a>
                )}
              </div>
            )}
            {selectedBook.bookType !== 'personal' && !selectedBook.isExternalCatalog && (
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Available Library Locations:
                </h4>
                <div className="space-y-2">
                  {getPartnerLibraryEntries(selectedBook).length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No libraries currently have this book in inventory.
                    </p>
                  ) : (
                    getPartnerLibraryEntries(selectedBook).map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs gap-3"
                      >
                        <div>
                          <p className="font-bold text-slate-800 text-sm">
                            {libraryName(entry.libraryId)}
                          </p>
                          <p className="text-slate-500">
                            {Number(entry.availableCopies || 0) > 0
                              ? `${entry.availableCopies} available`
                              : 'Out of stock (Queue available)'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleViewMap(entry.libraryId, entry)}
                            className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded-lg font-bold hover:bg-slate-300 transition"
                          >
                            View Map
                          </button>
                          <button
                            type="button"
                            disabled={savingReadingListBookId === entry.id}
                            onClick={() => handleToggleReadingList(entry)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <ClipboardList size={14} aria-hidden="true" />
                            {savingReadingListBookId === entry.id
                              ? 'Saving...'
                              : isBookInReadingList(entry.id)
                                ? 'Saved'
                                : 'Read Later'}
                          </button>
                          <button
                            type="button"
                            disabled={submittingBorrow}
                            onClick={() => handleBorrowOrReserve(entry)}
                            className="px-3 py-1.5 bg-shelf-primary text-white rounded-lg font-bold hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {submittingBorrow
                              ? 'Processing...'
                              : Number(entry.availableCopies || 0) > 0
                                ? 'Borrow'
                                : 'Reserve'}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
            {selectedBook?.bookType === 'personal' && (
              <div className="border-t border-slate-200 pt-4 space-y-3">
                <button
                  type="button"
                  onClick={() => handleRequestCommunityBook(selectedBook)}
                  disabled={submittingCommunityRequest}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-shelf-primary py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <HandHeart size={16} strokeWidth={2} aria-hidden="true" />
                  {submittingCommunityRequest
                    ? 'Submitting Request...'
                    : getPersonalBookCopyAvailability(selectedBook).availableCopies === 0
                      ? 'Join Community Book Queue'
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
                    Requests are handled in order and always require owner approval.
                  </p>
                )}
              </div>
            )}
            <div className="pt-4 border-t border-slate-200 space-y-4">
              <h4 className="flex items-center justify-between text-sm font-bold uppercase tracking-wide text-slate-800">
                <span>Ratings &amp; Reviews</span>
                <span className="text-xs font-normal normal-case tracking-normal text-slate-500">
                  ({reviews.length} {reviews.length === 1 ? 'review' : 'reviews'})
                </span>
              </h4>
              <form onSubmit={handleSubmitReview} className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-bold text-slate-700">
                    Leave a Review:
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 mr-1">Rating:</span>
                    <select
                      value={userRating}
                      onChange={(event) => setUserRating(Number(event.target.value))}
                      className="text-xs bg-white border border-slate-300 rounded px-2 py-1 font-bold text-amber-600 focus:outline-none"
                    >
                      <option value="5">5/5</option>
                      <option value="4">4/5</option>
                      <option value="3">3/5</option>
                      <option value="2">2/5</option>
                      <option value="1">1/5</option>
                    </select>
                    <span role="img" aria-label={`${userRating} out of 5 stars`} className="inline-flex items-center gap-0.5">
                      {Array.from({ length: 5 }, (_, index) => (
                        <Star
                          key={index}
                          size={14}
                          className={index < userRating ? 'fill-amber-400 text-amber-500' : 'text-slate-300'}
                          aria-hidden="true"
                        />
                      ))}
                    </span>
                  </div>
                </div>
                <textarea
                  value={userComment}
                  onChange={(event) => setUserComment(event.target.value)}
                  placeholder="Write your review or thoughts about this book..."
                  rows={2}
                  className="w-full text-xs p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 bg-white"
                  required
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="bg-shelf-primary text-white text-xs px-4 py-2 rounded-lg font-bold hover:opacity-90 transition disabled:opacity-50"
                  >
                    {isSubmitting ? 'Submitting...' : 'Submit Review'}
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
                    No reviews yet for this book. Be the first to leave a review!
                  </p>
                ) : (
                  reviews.map((review) => (
                    <div key={review.id} className="p-3 bg-white rounded-lg border border-slate-100 shadow-sm text-xs space-y-1">
                      <div className="flex justify-between items-center gap-3">
                        <span className="font-bold text-slate-800">
                          {review.visitor_name}
                        </span>
                        <span className="inline-flex items-center gap-0.5 text-amber-500" aria-label={`${Math.max(0, Math.min(5, Number(review.rating) || 0))} out of 5 stars`}>
                          {Array.from({ length: 5 }, (_, index) => (
                            <Star
                              key={index}
                              size={13}
                              strokeWidth={1.8}
                              fill={index < Number(review.rating) ? 'currentColor' : 'none'}
                              aria-hidden="true"
                            />
                          ))}
                        </span>
                      </div>
                      <p className="text-slate-600">{review.comment}</p>
                      <p className="text-[10px] text-slate-400">{formatDate(review.created_at)}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
            <p className="text-[11px] text-slate-400 pt-2 border-t border-slate-100">
              {selectedBook.bookType === 'personal' ? (
                <>This is a community-owned book. Borrowing requires owner approval.</>
              ) : (
                <>
                  Borrowed items are due {BORROW_PERIOD_DAYS} days after pickup.
                  Holds must be picked up within {PICKUP_WINDOW_HOURS} hours or they're released automatically. Overdue books are charged ₱10 per overdue day.
                </>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}