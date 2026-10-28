import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  CheckCircle2,
  CircleAlert,
  MapPin,
  Star,
  Lock,
  Upload,
  Link2,
  ImagePlus,
  Pencil,
} from 'lucide-react';
import BookCover from './BookCover.jsx';
import OPACBookCard from './OPACBookCard.jsx';
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

const MAX_PERSONAL_COVER_SIZE = 2 * 1024 * 1024;
const PERSONAL_COVER_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

function getPersonalCoverStoragePath(url, visitorId) {
  const marker = '/storage/v1/object/public/book-covers/';
  const pathStart = String(url || '').indexOf(marker);
  if (pathStart < 0) return null;

  const encodedPath = String(url).slice(pathStart + marker.length);
  let path;
  try {
    path = decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
  return path.split('/')[0] === String(visitorId) ? path : null;
}

function createPersonalCoverPath(visitorId, filename) {
  return `${visitorId}/${Date.now()}-${filename}`;
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
  queued: 'visitor-status visitor-status-neutral',
  ready_for_pickup: 'visitor-status visitor-status-navy',
  borrowed: 'visitor-status visitor-status-navy',
  returned: 'visitor-status visitor-status-success',
  cancelled: 'visitor-status visitor-status-neutral',
  expired: 'visitor-status visitor-status-neutral',
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

function getCatalogPaginationItems(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const pages = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
  const ordered = [...pages]
    .filter((page) => page > 0 && page <= totalPages)
    .sort((a, b) => a - b);
  return ordered.reduce((items, page, index) => {
    if (index > 0 && page - ordered[index - 1] > 1) {
      items.push(`ellipsis-${page}`);
    }
    items.push(page);
    return items;
  }, []);
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
  embedded = false,
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
  const [catalogPage, setCatalogPage] = useState(1);
  const catalogPageSize = 20;
  const [categorySelection, setCategorySelection] = useState({
    resetKey: catalogResetKey,
    value: 'All',
  });
  const selectedCategory =
    categorySelection.resetKey === catalogResetKey
      ? categorySelection.value
      : 'All';
  const setSelectedCategory = (value) => {
    setCatalogPage(1);
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
  const [submittingBorrowBookId, setSubmittingBorrowBookId] = useState(null);
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
  const [dismissedOwnerRequestError, setDismissedOwnerRequestError] = useState('');
  const [processingCommunityRequestId, setProcessingCommunityRequestId] = useState(null);
  const [showRejectCommunityRequest, setShowRejectCommunityRequest] = useState(null);
  const [communityRequestResponse, setCommunityRequestResponse] = useState('');
  const [communityRequestNotice, setCommunityRequestNotice] = useState('');

  const setOwnerRequestError = (message) => {
    setOwnerCommunityRequestError(message);
    setDismissedOwnerRequestError('');
  };
  const ownerRequestErrorMessage =
    ownerCommunityRequestError || ownerCommunityRequestLoadError;

  useEffect(() => {
    if (!communityRequestNotice) return undefined;
    const timeoutId = setTimeout(() => setCommunityRequestNotice(''), 5000);
    return () => clearTimeout(timeoutId);
  }, [communityRequestNotice]);
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
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverMode, setCoverMode] = useState('upload');
  const [coverFile, setCoverFile] = useState(null);
  const [coverFileValid, setCoverFileValid] = useState(false);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [coverUrlInput, setCoverUrlInput] = useState('');
  const [coverUrlLoaded, setCoverUrlLoaded] = useState(false);
  const [coverUrlError, setCoverUrlError] = useState(false);
  const [coverError, setCoverError] = useState('');
  const [coverDragActive, setCoverDragActive] = useState(false);
  const coverFileInputRef = useRef(null);
  const [personalBookToRemove, setPersonalBookToRemove] = useState(null);
  const [personalBookRemovalError, setPersonalBookRemovalError] = useState('');
  const [removingPersonalBookId, setRemovingPersonalBookId] = useState(null);
  const readingListUserId = user?.id;
  const personalCoverPreviewUrl =
    coverMode === 'upload' && coverFile
      ? coverPreviewUrl
      : coverMode === 'url'
        ? coverUrlInput
        : coverUrl;
  const isPersonalCoverUrlValid = /^https?:\/\//i.test(coverUrlInput);

  const refreshReadingList = useCallback(async () => {
    if (!readingListUserId) {
      setReadingListBookIds([]);
      setReadingListBooks([]);
      return;
    }
    setReadingListLoading(true);
    try {
      const list = await fetchReadingList(readingListUserId);
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
  }, [readingListUserId]);

  useEffect(() => {
    if (!readingListUserId) return;
    const refreshTimer = setTimeout(() => {
      void refreshReadingList();
    }, 0);
    return () => clearTimeout(refreshTimer);
  }, [refreshReadingList, readingListUserId]);

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
  const [hoverRating, setHoverRating] = useState(0);
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
    if (coverPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(coverPreviewUrl);
    }
    setCoverMode('upload');
    setCoverFile(null);
    setCoverFileValid(false);
    setCoverPreviewUrl('');
    setCoverUrl('');
    setCoverUrlInput('');
    setCoverUrlLoaded(false);
    setCoverUrlError(false);
    setCoverError('');
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
    setCoverMode('upload');
    setCoverFile(null);
    setCoverFileValid(false);
    setCoverPreviewUrl('');
    setCoverUrl(book.coverUrl || '');
    setCoverUrlInput(book.coverUrl || '');
    setCoverUrlLoaded(Boolean(book.coverUrl));
    setCoverUrlError(false);
    setCoverError('');
    setNotice('');
    setShowAddPersonalBook(true);
  };
  const selectPersonalCover = (file) => {
    if (!file) return;
    setCoverError('');
    if (coverPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(coverPreviewUrl);
    }
    setCoverPreviewUrl('');
    if (!PERSONAL_COVER_TYPES.has(file.type)) {
      setCoverFile(null);
      setCoverFileValid(false);
      setCoverError('Unsupported image type. Choose a PNG, JPG, or WEBP image.');
      return;
    }
    if (file.size > MAX_PERSONAL_COVER_SIZE) {
      setCoverFile(null);
      setCoverFileValid(false);
      setCoverError('This image is too large. Choose an image up to 2 MB.');
      return;
    }
    setCoverPreviewUrl(URL.createObjectURL(file));
    setCoverFile(file);
    setCoverFileValid(false);
    setCoverMode('upload');
  };
  const removePersonalCover = () => {
    if (coverPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(coverPreviewUrl);
    }
    setCoverFile(null);
    setCoverFileValid(false);
    setCoverPreviewUrl('');
    setCoverUrl('');
    setCoverUrlInput('');
    setCoverUrlLoaded(false);
    setCoverUrlError(false);
    setCoverError('');
  };
  useEffect(() => () => {
    if (coverPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(coverPreviewUrl);
    }
  }, [coverPreviewUrl]);

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
    const selectedCoverUrl =
      coverMode === 'url'
        ? coverUrlInput.trim()
        : coverUrl;
    if (
      coverMode === 'url' &&
      selectedCoverUrl &&
      (!isPersonalCoverUrlValid || !coverUrlLoaded)
    ) {
      setCoverError(
        !isPersonalCoverUrlValid
          ? 'Enter a valid image URL beginning with http:// or https://.'
          : coverUrlError
          ? 'This image URL could not be loaded. Check the URL or remove the cover.'
          : 'Wait for the image preview to load, or remove the cover before saving.'
      );
      return;
    }
    if (coverMode === 'upload' && coverFile && !coverFileValid) {
      setCoverError(
        'This image could not be read. Choose another PNG, JPG, or WEBP image.'
      );
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
      let savedCoverUrl = selectedCoverUrl || null;
      let uploadedCoverPath = null;
      if (coverMode === 'upload' && coverFile) {
        if (!supabase) {
          throw new Error(
            'Cover upload is unavailable right now. Try again later, or remove the cover and save.'
          );
        }
        const safeFileName = coverFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        uploadedCoverPath = createPersonalCoverPath(user.id, safeFileName);
        setCoverUploading(true);
        let uploadError;
        try {
          ({ error: uploadError } = await supabase.storage
            .from('book-covers')
            .upload(uploadedCoverPath, coverFile, {
              contentType: coverFile.type,
              upsert: false,
            }));
        } catch (error) {
          console.error('Personal book cover upload error:', error);
          setCoverError(
            'The cover could not be uploaded. Please retry, or remove the cover and save without it.'
          );
          throw new Error(
            'The cover could not be uploaded. Please retry, or remove the cover and save without it.',
            { cause: error }
          );
        }
        if (uploadError) {
          console.error('Personal book cover upload error:', uploadError);
          setCoverError(
            'The cover could not be uploaded. Please retry, or remove the cover and save without it.'
          );
          throw new Error(
            'The cover could not be uploaded. Please retry, or remove the cover and save without it.'
          );
        }
        setCoverUploading(false);
        const { data: publicUrlData } = supabase.storage
          .from('book-covers')
          .getPublicUrl(uploadedCoverPath);
        savedCoverUrl = publicUrlData?.publicUrl || null;
        if (!savedCoverUrl) {
          const { error: cleanupError } = await supabase.storage
            .from('book-covers')
            .remove([uploadedCoverPath]);
          if (cleanupError) {
            console.error('Unable to clean up an unaddressable personal book cover:', cleanupError);
          }
          setCoverError(
            'The uploaded cover URL could not be created. Please retry, or remove the cover and save without it.'
          );
          throw new Error(
            'The uploaded cover URL could not be created. Please retry, or remove the cover and save without it.'
          );
        }
      }
      let savedBook;
      try {
        savedBook = editingPersonalBook
          ? await updatePersonalBook({
              ...bookDetails,
              bookId: editingPersonalBook.id,
              coverUrl: savedCoverUrl,
            })
          : await addPersonalBook({
              ...bookDetails,
              coverUrl: savedCoverUrl,
            });
      } catch (error) {
        if (uploadedCoverPath && supabase) {
          const { error: cleanupError } = await supabase.storage
            .from('book-covers')
            .remove([uploadedCoverPath]);
          if (cleanupError) {
            console.error('Unable to clean up an unsaved personal book cover:', cleanupError);
          }
        }
        throw error;
      }
      if (!savedBook) {
        throw new Error(`The personal book was not ${editingPersonalBook ? 'updated' : 'created'}. Please try again.`);
      }
      const previousCoverPath = getPersonalCoverStoragePath(
        editingPersonalBook?.coverUrl,
        user.id
      );
      if (
        previousCoverPath &&
        previousCoverPath !== uploadedCoverPath &&
        previousCoverPath !== getPersonalCoverStoragePath(savedCoverUrl, user.id)
      ) {
        const { error: removeError } = await supabase.storage
          .from('book-covers')
          .remove([previousCoverPath]);
        if (removeError) {
          console.error('Unable to remove the replaced personal book cover:', removeError);
        }
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
      if (
        (coverFile || (coverMode === 'url' && selectedCoverUrl)) &&
        !coverError
      ) {
        setCoverError(
          (error?.message?.startsWith('The cover ') && error.message) ||
            'The cover or book details could not be saved. Please retry, or remove the cover and save without it.'
        );
      }
      setNotice(error?.message || `Unable to ${editingPersonalBook ? 'update' : 'add'} the personal book. Please try again.`);
    } finally {
      setCoverUploading(false);
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
    setCatalogPage(1);
    setSearchTerm(query);
    if (activeView === 'catalog' && query) {
      recordVisitorSearch(user?.id, query);
    }
  };
  const handleSearchInputChange = (event) => {
    const value = event.target.value;
    setSearchInput(value);
    if (value.trim() === '') {
      setCatalogPage(1);
      setSearchTerm('');
    }
  };
  const handleClearSearch = () => {
    setCatalogPage(1);
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

  const catalogTotalPages = Math.max(1, Math.ceil(filteredBooks.length / catalogPageSize));
  const visibleCatalogPage = Math.min(catalogPage, catalogTotalPages);
  const visibleCatalogBooks = filteredBooks.slice(
    (visibleCatalogPage - 1) * catalogPageSize,
    visibleCatalogPage * catalogPageSize
  );
  const catalogPaginationItems = getCatalogPaginationItems(
    visibleCatalogPage,
    catalogTotalPages
  );

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
    setSubmittingBorrowBookId(String(bookEntry.id));
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
      setSubmittingBorrowBookId(null);
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
    setOwnerRequestError('');
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
      setOwnerRequestError(
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
    setOwnerRequestError('');
  };
  const handleRejectCommunityRequest = async () => {
    const request = showRejectCommunityRequest;
    if (!request?.id || !user?.id) {
      setOwnerRequestError('Unable to identify this community book request.');
      return;
    }
    if (processingCommunityRequestId) return;
    setProcessingCommunityRequestId(request.id);
    setOwnerRequestError('');
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
      setOwnerRequestError(
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
    setOwnerRequestError('');
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
      setOwnerRequestError(
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
    setOwnerRequestError('');
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
      setOwnerRequestError(
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
      <div key={book.id} className="visitor-book-card visitor-personal-book-card">
        <div className="visitor-book-card-inner">
          <div className="visitor-book-card-badge-row">
            <span className="visitor-book-card-badge visitor-book-card-badge-primary">Personal Book</span>
            <span className="visitor-book-card-badge visitor-book-card-badge-neutral">
              {book.isPublic ? 'Public' : 'Private'}
            </span>
            {!book.lendingEnabled && (
              <span className="visitor-book-card-badge visitor-book-card-badge-neutral">Not for Lending</span>
            )}
          </div>

          <div className="visitor-book-card-header">
            <BookCover
              key={`${book.id}-${book.coverUrl || book.title}`}
              src={book.coverUrl}
              title={book.title}
              className="visitor-book-cover"
            />
            <div className="visitor-book-card-text">
              <h3 title={book.title || 'Untitled Book'}>{book.title || 'Untitled Book'}</h3>
              <p title={book.author || 'Unknown Author'}>By {book.author || 'Unknown Author'}</p>
            </div>
          </div>

          <div className="visitor-book-card-meta">
            <div className="visitor-book-card-meta-item">
              <span className="visitor-book-card-meta-label">Category</span>
              <span className="visitor-book-card-meta-value" title={book.category || '—'}>{book.category || '—'}</span>
            </div>
            <div className="visitor-book-card-meta-item">
              <span className="visitor-book-card-meta-label">Condition</span>
              <span className="visitor-book-card-meta-value" title={book.condition || '—'}>{book.condition || '—'}</span>
            </div>
            <div className="visitor-book-card-meta-item">
              <span className="visitor-book-card-meta-label">Lending period</span>
              <span className="visitor-book-card-meta-value">
                {book.lendingEnabled ? `${book.lendingPeriodDays || 7} days` : 'Not applicable'}
              </span>
            </div>
            <div className="visitor-book-card-meta-item">
              <span className="visitor-book-card-meta-label">Copies</span>
              <span className="visitor-book-card-meta-value">{getPersonalBookAvailabilityLabel(book)}</span>
            </div>
            <div className="visitor-book-card-meta-item visitor-book-card-meta-item-full">
              <span className="visitor-book-card-meta-label">ISBN</span>
              <span className="visitor-book-card-meta-value" title={book.isbn || '—'}>{book.isbn || '—'}</span>
            </div>
          </div>

          <div className="visitor-book-card-footer">
            <div className="visitor-book-card-handover">
              <MapPin size={14} aria-hidden="true" />
              <span>Handover: Arrange with Owner</span>
            </div>
            {String(book.ownerVisitorId ?? '') === String(user?.id ?? '') && (
              <div className="visitor-book-card-action-row">
                <button
                  type="button"
                  onClick={async () => {
                    if (updatingVisibilityBookId) return;
                    const nextVisibility = !book.isPublic;
                    setUpdatingVisibilityBookId(book.id);
                    setNotice('');
                    try {
                      await setPersonalBookVisibility(user.id, book.id, nextVisibility);
                      setNotice(`"${book.title}" is now ${nextVisibility ? 'public' : 'visible only to you'}.`);
                    } catch (error) {
                      console.error('UPDATE PERSONAL BOOK VISIBILITY ERROR:', error);
                      setNotice(error?.message || 'Unable to update book visibility.');
                    } finally {
                      setUpdatingVisibilityBookId(null);
                    }
                  }}
                  disabled={updatingVisibilityBookId === book.id}
                  aria-label={`Make ${book.title} ${book.isPublic ? 'private' : 'public'}`}
                  title={book.isPublic ? 'Make Private' : 'Make Public'}
                  className="visitor-book-card-action-button"
                >
                  {book.isPublic ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                  <span className="visitor-book-card-action-label">
                    {updatingVisibilityBookId === book.id ? 'Saving...' : book.isPublic ? 'Make Private' : 'Make Public'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => openEditPersonalBook(book)}
                  disabled={hasActiveRequest || savingPersonalBook}
                  title={
                    hasActiveRequest
                      ? 'Resolve active community requests before editing this book.'
                      : 'Edit personal book'
                  }
                  aria-label={`Edit ${book.title || 'personal book'}`}
                  className="visitor-book-card-action-button visitor-book-card-action-button-outline"
                >
                  <Pencil size={14} aria-hidden="true" />
                  <span className="visitor-book-card-action-label visitor-book-card-action-label-secondary">Edit</span>
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
                  aria-label={`Remove ${book.title || 'personal book'}`}
                  className="visitor-book-card-action-button visitor-book-card-action-button-danger"
                >
                  <X size={14} aria-hidden="true" />
                  <span className="visitor-book-card-action-label visitor-book-card-action-label-secondary">Remove</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };
  const renderCommunityBookCard = (book) => (
    <button
      key={book.id}
      type="button"
      onClick={() => setSelectedBook(book)}
      className="visitor-book-card visitor-community-book-card"
    >
      <div className="visitor-book-card-inner">
        <div className="visitor-book-card-badge-row">
          <span className="visitor-book-card-badge visitor-book-card-badge-primary">Community Book</span>
          <span
            className={`visitor-book-card-badge ${
              getPersonalBookCopyAvailability(book).availableCopies > 0
                ? 'visitor-book-card-badge-success'
                : 'visitor-book-card-badge-warning'
            }`}
          >
            {getPersonalBookAvailabilityLabel(book)}
          </span>
        </div>

        <div className="visitor-book-card-header">
          <BookCover
            key={`${book.id}-${book.coverUrl || book.title}`}
            src={book.coverUrl}
            title={book.title}
            className="visitor-book-cover"
          />
          <div className="visitor-book-card-text">
            <h3 title={book.title || 'Untitled Book'}>{book.title || 'Untitled Book'}</h3>
            <p title={book.author || 'Unknown Author'}>By {book.author || 'Unknown Author'}</p>
          </div>
        </div>

        <div className="visitor-book-card-meta">
          <div className="visitor-book-card-meta-item">
            <span className="visitor-book-card-meta-label">Category</span>
            <span className="visitor-book-card-meta-value" title={book.category || '—'}>{book.category || '—'}</span>
          </div>
          <div className="visitor-book-card-meta-item">
            <span className="visitor-book-card-meta-label">Condition</span>
            <span className="visitor-book-card-meta-value" title={book.condition || '—'}>{book.condition || '—'}</span>
          </div>
          <div className="visitor-book-card-meta-item">
            <span className="visitor-book-card-meta-label">Lending period</span>
            <span className="visitor-book-card-meta-value">{book.lendingPeriodDays || 7} days</span>
          </div>
          <div className="visitor-book-card-meta-item">
            <span className="visitor-book-card-meta-label">ISBN</span>
            <span className="visitor-book-card-meta-value" title={book.isbn || '—'}>{book.isbn || '—'}</span>
          </div>
          <div className="visitor-book-card-meta-item">
            <span className="visitor-book-card-meta-label">Copies</span>
            <span className="visitor-book-card-meta-value">{getPersonalBookAvailabilityLabel(book)}</span>
          </div>
        </div>

        <div className="visitor-book-card-footer">
          <div className="visitor-book-card-handover">
            <MapPin size={14} aria-hidden="true" />
            <span>Handover: Arrange with Owner</span>
          </div>
          <div className="visitor-book-card-approval-note">
            <span>Borrowing requires owner approval.</span>
          </div>
        </div>
      </div>
    </button>
  );

  // =========================================================
  // RENDER MAIN OPAC LAYOUT
  // =========================================================
  return (
    <div className={`font-sans ${embedded ? 'text-inherit' : 'min-h-screen bg-slate-50 text-slate-800'}`}>
      
      {/* 1. TOP NAVBAR FOR BRANDING AND VISUAL BREATHING ROOM */}
      {!embedded && <header className="bg-slate-900 text-white shadow-md sticky top-0 z-40">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-3 py-4 sm:px-4 md:px-6">
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
            <button
              type="button"
              onClick={() => navigate('/visitor-login')}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition shadow"
            >
              Sign In
            </button>
          </div>
        </div>
      </header>}

      {/* 2. MAIN CONTAINER WITH TOP PADDING & MARGIN */}
      <main className={`${embedded ? 'mx-auto max-w-7xl space-y-6 px-0 py-0' : 'mx-auto max-w-7xl space-y-6 px-3 pt-6 pb-12 sm:px-4 md:px-6'}`}>
        
        {notice && (
          <div role="status" aria-live="polite" className="visitor-feedback visitor-feedback-info flex items-start justify-between gap-3 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            <span className="visitor-feedback-icon" aria-hidden="true">
              <CircleAlert size={16} />
            </span>
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
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row">
            <form onSubmit={handleSearch} className="flex min-w-0 flex-1 gap-2">
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
                className="rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
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
            <div className="public-opac-filter-bar visitor-catalog-filter-bar min-w-0 bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row gap-3 flex-wrap">
              <form onSubmit={handleSearch} className="flex w-full min-w-0 flex-1 gap-2 md:w-auto md:min-w-[18rem]">
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
                onChange={(event) => {
                  setCatalogPage(1);
                  setSortBy(event.target.value);
                }}
                aria-label="Sort catalog books"
                className="w-full min-w-0 px-4 py-2.5 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none cursor-pointer md:w-auto md:min-w-40"
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
                  onChange={(event) => {
                    setCatalogPage(1);
                    setSelectedLibrary(event.target.value);
                  }}
                  aria-label="Filter by library"
                  className="w-full min-w-0 px-4 py-2.5 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none cursor-pointer md:w-auto md:min-w-40"
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
                onChange={(event) => {
                  setCatalogPage(1);
                  setSelectedAvailability(event.target.value);
                }}
                aria-label="Filter by availability status"
                className="w-full min-w-0 px-4 py-2.5 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none cursor-pointer md:w-auto md:min-w-40"
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
                <span className="mx-auto grid size-14 place-items-center rounded-full bg-slate-100 text-slate-700">
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
              <div className="opac-book-grid book-card-grid grid min-w-0 gap-6">
                {visibleCatalogBooks.map((book) => (
                  <OPACBookCard key={book.id} book={book} onSelect={setSelectedBook} />
                ))}
              </div>
            )}
            <nav className="visitor-catalog-pagination flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-800" aria-label="Catalog pagination">
              <p className="text-xs text-slate-500 dark:text-slate-300">
                Showing {filteredBooks.length === 0 ? 0 : (visibleCatalogPage - 1) * catalogPageSize + 1}–{Math.min(visibleCatalogPage * catalogPageSize, filteredBooks.length)} of {filteredBooks.length} books
              </p>
              <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={() => setCatalogPage((page) => Math.max(1, page - 1))}
                  disabled={visibleCatalogPage === 1}
                  className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Previous
                </button>
                {catalogPaginationItems.map((item) => item.toString().startsWith('ellipsis-') ? (
                  <span key={item} className="px-1 text-xs text-slate-400" aria-hidden="true">…</span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setCatalogPage(item)}
                    aria-current={visibleCatalogPage === item ? 'page' : undefined}
                    className={`min-h-9 min-w-9 rounded-lg px-2 text-xs font-bold transition ${visibleCatalogPage === item ? 'bg-shelf-primary text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700'}`}
                  >
                    {item}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCatalogPage((page) => Math.min(catalogTotalPages, page + 1))}
                  disabled={visibleCatalogPage === catalogTotalPages}
                  className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Next
                </button>
              </div>
            </nav>
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
                    className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-shelf-primary hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                      <Bookmark size={16} aria-hidden="true" />
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
                  <ClipboardList size={20} className="text-shelf-primary" aria-hidden="true" />
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
              <div className="grid auto-rows-fr gap-5 md:grid-cols-2 xl:grid-cols-3">
                {readingListBooks.map((book) => (
                  <div
                    key={book.id}
                    className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800"
                  >
                    <div className="flex flex-1 flex-col p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                            {book.category || 'Uncategorized'}
                          </span>
                          <h3 title={book.title || 'Untitled Book'} className="mt-2 min-h-12 line-clamp-2 text-base font-bold text-slate-900 dark:text-white">
                            {book.title || 'Untitled Book'}
                          </h3>
                          <p title={book.author || 'Unknown Author'} className="mt-1 truncate text-xs text-slate-700 dark:text-slate-200">
                            By {book.author || 'Unknown Author'}
                          </p>
                        </div>
                        <BookOpen size={22} className="shrink-0 text-slate-400" aria-hidden="true" />
                      </div>
                      <div className="mt-4 space-y-2 text-xs text-slate-600">
                        <div className="flex items-center justify-between gap-2">
                          <span>Availability</span>
                          <span className={`visitor-status ${
                            Number(book.availableCopies || 0) > 0
                              ? 'visitor-status-success'
                              : 'visitor-status-neutral'
                          }`}>
                            {Number(book.availableCopies || 0) > 0
                              ? `${book.availableCopies} available`
                              : 'Unavailable'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span>ISBN</span>
                          <span className="truncate text-right tabular-nums text-slate-700 dark:text-slate-200">
                            {book.isbn || '—'}
                          </span>
                        </div>
                      </div>
                      <div className="mt-auto flex gap-2 pt-4">
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
                  <Users size={20} className="text-slate-700 dark:text-slate-200" aria-hidden="true" />
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
              <div role="alert" className="visitor-feedback visitor-feedback-error rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
                <span className="visitor-feedback-icon" aria-hidden="true">
                  <CircleAlert size={16} />
                </span>
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
              <div className="opac-book-grid book-card-grid grid min-w-0 gap-5">
                {filteredCommunityBooks.map(renderCommunityBookCard)}
              </div>
            )}
          </section>
        ) : activeView === 'personalBooks' ? (
          <section className="flex w-full min-w-0 flex-col gap-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <UserRound size={20} className="text-shelf-primary dark:text-slate-200" aria-hidden="true" />
                  <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                    My Personal Books
                  </h2>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
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
            <div className="order-3 w-full min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <div className="border-b border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-900/60">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-shelf-primary dark:text-white">
                      Community Book Requests
                    </h3>
                    <p className="mt-1 text-xs text-slate-700 dark:text-slate-200">
                      Review requests from visitors who want to borrow your personal books.
                    </p>
                  </div>
                  {ownerCommunityRequests.length > 0 && (
                    <span className="shrink-0 rounded-full bg-shelf-primary px-2.5 py-1 text-xs font-bold text-white">
                      {ownerCommunityRequests.length}
                    </span>
                  )}
                </div>
              </div>
              {ownerRequestErrorMessage &&
                dismissedOwnerRequestError !== ownerRequestErrorMessage && (
                <div role="alert" className="visitor-feedback visitor-feedback-error mx-5 mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                  <span className="visitor-feedback-icon" aria-hidden="true">
                    <CircleAlert size={16} />
                  </span>
                  {ownerRequestErrorMessage}
                  <button
                    type="button"
                    onClick={() => setDismissedOwnerRequestError(ownerRequestErrorMessage)}
                    className="rounded-lg p-1 text-red-900 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 dark:text-red-200 dark:hover:bg-red-900/50"
                    aria-label="Dismiss community request error"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              )}
              {communityRequestNotice && (
                <div role="status" aria-live="polite" className="visitor-feedback visitor-feedback-success mx-5 mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                  <span className="visitor-feedback-icon" aria-hidden="true">
                    <CheckCircle2 size={16} />
                  </span>
                  {communityRequestNotice}
                  <button
                    type="button"
                    onClick={() => setCommunityRequestNotice('')}
                    className="rounded-lg p-1 text-emerald-900 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
                    aria-label="Dismiss community request update"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
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
                    const filterStatusClass =
                      filter.key === 'pending'
                        ? 'visitor-status-warning'
                        : filter.key === 'to-confirm'
                          ? 'visitor-status-warning'
                          : filter.key === 'borrowed'
                            ? 'visitor-status-navy'
                            : filter.key === 'rejected'
                              ? 'visitor-status-danger'
                              : filter.key === 'returned'
                                ? 'visitor-status-success'
                                : 'visitor-status-neutral';
                    const FilterIcon =
                      filter.key === 'pending' || filter.key === 'to-confirm'
                        ? Clock3
                        : filter.key === 'returned'
                          ? CheckCircle2
                          : filter.key === 'rejected'
                            ? X
                            : Users;
                    return (
                      <button
                        key={filter.key}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setOwnerCommunityRequestFilter(filter.key)}
                        className={`visitor-request-filter shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                          isSelected
                            ? `border-shelf-primary ${filterStatusClass}`
                            : `border-slate-200 bg-white text-slate-800 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 ${count === 0 ? 'is-empty' : ''}`
                        }`}
                      >
                        <FilterIcon size={13} aria-hidden="true" />
                        {filter.label}
                        <span className={`ml-1.5 ${count === 0 ? 'text-slate-600 dark:text-slate-300' : ''}`}>
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
                <div className="grid gap-3 p-4 sm:p-5">
                  {filteredOwnerCommunityRequests.map((request) => {
                    const status = getOwnerCommunityRequestStatus(request);
                    const isProcessing = processingCommunityRequestId === request.id;
                    return (
                      <div
                        key={request.id}
                        id={`community-owner-request-${request.id}`}
                        className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/70 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/40 sm:p-5"
                      >
                        <div className="space-y-3">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                <Users size={13} aria-hidden="true" />
                                Community book request
                              </span>
                              <h4 className="mt-1 break-words text-base font-bold text-slate-900 dark:text-slate-100">
                                {request.bookTitle || 'Untitled Book'}
                              </h4>
                            </div>
                            <span className={`visitor-status shrink-0 ${
                              status === 'approved'
                                ? 'visitor-status-warning'
                                : status === 'borrowed'
                                  ? 'visitor-status-navy'
                                  : status === 'returned'
                                    ? 'visitor-status-success'
                                    : status === 'rejected'
                                      ? 'visitor-status-danger'
                                      : status === 'cancelled'
                                        ? 'visitor-status-neutral'
                                        : 'visitor-status-warning'
                            }`}>
                              {status === 'returned'
                                ? <CheckCircle2 size={12} aria-hidden="true" />
                                : status === 'rejected' || status === 'cancelled'
                                  ? <X size={12} aria-hidden="true" />
                                  : <Clock3 size={12} aria-hidden="true" />}
                              {status === 'approved'
                                ? 'Approved'
                                : status === 'borrowed'
                                  ? 'Borrowed'
                                  : status === 'returned'
                                    ? 'Returned'
                                    : status === 'rejected'
                                      ? 'Rejected'
                                      : status === 'cancelled'
                                        ? 'Cancelled'
                                        : 'Pending'}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-200 pt-3 text-xs dark:border-slate-700">
                            <p className="text-slate-500 dark:text-slate-400">
                              Requested by <span className="font-semibold text-slate-800 dark:text-slate-200">{request.requesterName || 'SHELF Visitor'}</span>
                            </p>
                            <p className="text-slate-500 dark:text-slate-400">
                              {formatDateTime(request.requestDate)}
                            </p>
                          </div>
                          {request.ownerResponse && (
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                Owner response
                              </p>
                              <p className="mt-1 break-words text-xs leading-5 text-slate-600 dark:text-slate-300">
                                {request.ownerResponse}
                              </p>
                            </div>
                          )}
                        </div>
                        {status === 'pending' && (
                          <div className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end dark:border-slate-700">
                            <button
                              type="button"
                              disabled={Boolean(processingCommunityRequestId)}
                              onClick={() => handleApproveCommunityRequest(request)}
                              className="min-h-10 rounded-lg bg-shelf-primary px-5 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isProcessing ? 'Processing...' : 'Approve request'}
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(processingCommunityRequestId)}
                              onClick={() => openRejectCommunityRequest(request)}
                              className="min-h-10 rounded-lg border border-red-200 bg-white px-5 py-2.5 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-red-900 dark:bg-slate-800 dark:text-red-300 dark:hover:bg-red-950/40"
                            >
                              Reject Request
                            </button>
                          </div>
                        )}
                        {status === 'approved' && (
                          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900 dark:bg-amber-950/20">
                            <div className="flex items-center gap-2">
                              <Clock3 size={15} className="text-amber-700 dark:text-amber-300" aria-hidden="true" />
                              <p className="text-xs font-bold uppercase tracking-wider text-amber-950 dark:text-amber-100">
                                Approved — Awaiting Handover
                              </p>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-amber-950 dark:text-amber-100">
                              This request has been approved. After you physically hand the book to the requester, click the button below.
                            </p>
                            <button
                              type="button"
                              disabled={Boolean(processingCommunityRequestId)}
                              onClick={() => handleConfirmCommunityBookPickup(request)}
                              className="mt-4 min-h-11 w-full rounded-lg bg-shelf-primary px-5 py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isProcessing ? 'Processing...' : 'Confirm'}
                            </button>
                          </div>
                        )}
                        {status === 'borrowed' && (
                          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900 dark:bg-blue-950/20">
                            <p className="text-xs font-bold uppercase tracking-wider text-blue-950 dark:text-blue-100">
                              Book Currently Borrowed
                            </p>
                            <p className="mt-2 text-sm leading-6 text-blue-950 dark:text-blue-100">
                              Confirm the return after the requester gives the book back to you.
                            </p>
                            <button
                              type="button"
                              disabled={Boolean(processingCommunityRequestId)}
                              onClick={() => handleConfirmCommunityBookReturn(request)}
                              className="mt-4 min-h-11 w-full rounded-lg bg-shelf-primary px-5 py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isProcessing ? 'Processing...' : 'Confirm'}
                            </button>
                          </div>
                        )}
                        {status === 'returned' && (
                          <div className="mt-4 w-full rounded-lg border border-slate-200 bg-slate-100 px-4 py-3 dark:border-slate-700 dark:bg-slate-700/60">
                            <p className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
                              <CheckCircle2 size={15} className="text-green-700 dark:text-green-300" aria-hidden="true" />
                              Book Returned
                            </p>
                            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
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
              <div className="order-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                {personalBookError}
              </div>
            )}
            {loadingPersonalBooks ? (
              <div className="order-2 w-full min-w-0 rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-800">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Loading your personal books...
                </p>
              </div>
            ) : filteredPersonalBooks.length === 0 ? (
              <div className="order-2 w-full min-w-0 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-800">
                <UserRound size={32} className="mx-auto text-slate-300 dark:text-slate-500" aria-hidden="true" />
                <h3 className="mt-3 text-base font-bold text-slate-700 dark:text-slate-100">
                  You have no personal books yet.
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
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
              <div className="personal-book-card-grid order-2 grid w-full min-w-0 gap-5">
                {filteredPersonalBooks.map(renderPersonalBookCard)}
              </div>
            )}
          </section>
        ) : (
          <div className="visitor-requests-table rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            {myRequests.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">
                You have no borrow requests yet. Browse the catalog to get started.
              </p>
            ) : (
              <table className="visitor-requests-table-content w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="p-4">Book Title</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Details</th>
                    <th className="p-4 pr-6 text-center">Fine (PHP)</th>
                    <th className="p-4 pl-6 text-right">Action</th>
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
                    const statusClass = isOverdue
                      ? 'visitor-status visitor-status-danger'
                      : isCommunityRequest
                        ? request.status === 'pending' ||
                          request.status === 'approved'
                          ? 'visitor-status visitor-status-warning'
                          : request.status === 'borrowed'
                            ? 'visitor-status visitor-status-navy'
                            : request.status === 'returned'
                              ? 'visitor-status visitor-status-success'
                              : request.status === 'rejected'
                                ? 'visitor-status visitor-status-danger'
                                : 'visitor-status visitor-status-neutral'
                        : STATUS_STYLES[request.status] ||
                          'visitor-status visitor-status-neutral';
                    const StatusIcon =
                      isOverdue || request.status === 'rejected'
                        ? CircleAlert
                        : request.status === 'returned'
                          ? CheckCircle2
                          : request.status === 'pending' ||
                              request.status === 'ready_for_pickup' ||
                              request.status === 'queued' ||
                              request.status === 'approved'
                            ? Clock3
                            : BookOpen;
                    return (
                      <tr
                        key={request.id}
                        id={`borrow-request-${request.id}`}
                        className={`hover:bg-slate-50 ${
                          String(focusRequestId) === String(request.id)
                            ? 'bg-slate-100 ring-2 ring-inset ring-slate-500 dark:bg-slate-700'
                            : ''
                        }`}
                      >
                        <td data-label="Book Title" className="p-4 font-bold text-slate-900 dark:text-white">
                          <div className="flex flex-col gap-1">
                            <span className="break-words">{request.bookTitle || 'Untitled Book'}</span>
                            {isCommunityRequest && (
                              <span className="w-fit rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-800 dark:bg-slate-700 dark:text-slate-100">
                                Community Book
                              </span>
                            )}
                          </div>
                        </td>
                        <td data-label="Status" className="p-4">
                          <span
                            className={statusClass}
                          >
                            <StatusIcon size={12} aria-hidden="true" />
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
                        <td data-label="Details" className="p-4 space-y-1 text-xs text-slate-700 dark:text-slate-200">
                          {isCommunityRequest && (
                            <>
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
                                  <p className="flex items-start gap-1 font-medium text-slate-700 dark:text-slate-200">
                                    <Clock3 size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                                    Waiting for the book owner to approve your request.
                                  </p>
                                  {request.queuePosition != null && (
                                    <p className="visitor-status visitor-status-neutral w-fit">
                                      Queue #{request.queuePosition}
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
                                <p className="flex items-center gap-1 font-semibold text-red-800 dark:text-red-300">
                                  <CircleAlert size={13} aria-hidden="true" />
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
                            <p className="visitor-status visitor-status-neutral w-fit">
                              {queuePosition !== undefined && queuePosition !== null
                                ? `Queue #${queuePosition}`
                                : 'Queue pending'}
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
                          {request.status === 'expired' && <span>—</span>}
                        </td>
                        <td
                          data-label="Fine (PHP)"
                          className={`p-4 pr-6 text-center font-bold tabular-nums text-xs ${
                            currentFine > 0 ? 'text-red-600' : 'text-slate-500'
                          }`}
                        >
                          {"\u20B1"}{currentFine.toFixed(2)}
                        </td>
                        <td data-label="Action" className="p-4 pl-6 text-right">
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
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-100 flex items-center justify-center p-4">
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
                className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
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
        <div className="visitor-personal-book-dialog fixed inset-0 z-60 flex items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
          <div className="visitor-personal-book-dialog-card flex h-full max-h-full w-full max-w-2xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800 sm:max-h-[92vh] sm:rounded-2xl">
            <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-700 dark:bg-slate-800 sm:px-6">
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
            <form onSubmit={handleSavePersonalBook} className="flex min-h-0 flex-1 flex-col overflow-hidden text-slate-700 dark:text-slate-200">
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  Book Information
                </h3>
                <section className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50 sm:grid-cols-[96px_minmax(0,1fr)]">
                  <div className="flex flex-col items-center gap-2">
                    <BookCover
                      key={personalCoverPreviewUrl || 'personal-cover-placeholder'}
                      src={
                        coverMode === 'url' && !isPersonalCoverUrlValid
                          ? ''
                          : personalCoverPreviewUrl
                      }
                      title={personalBookForm.title || 'Book cover preview'}
                      className="h-32 w-24"
                      onLoad={() => {
                        if (coverMode === 'upload' && coverFile) {
                          setCoverFileValid(true);
                          setCoverError('');
                        }
                        if (coverMode === 'url' && coverUrlInput) {
                          setCoverUrlLoaded(true);
                          setCoverUrlError(false);
                          setCoverError('');
                        }
                      }}
                      onError={() => {
                        if (coverMode === 'upload' && coverFile) {
                          setCoverFileValid(false);
                          setCoverError(
                            'This image could not be read. Choose another PNG, JPG, or WEBP image.'
                          );
                        }
                        if (coverMode === 'url' && coverUrlInput) {
                          setCoverUrlLoaded(false);
                          setCoverUrlError(true);
                          setCoverError(
                            'This image URL could not be loaded. Check the URL or choose another image.'
                          );
                        }
                      }}
                    />
                    {(coverFile || coverUrl || coverUrlInput) && (
                      <div className="flex w-full flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => coverFileInputRef.current?.click()}
                          className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                        >
                          Replace
                        </button>
                        <button
                          type="button"
                          onClick={removePersonalCover}
                          className="min-h-11 rounded-lg px-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary dark:text-slate-200 dark:hover:bg-slate-700"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 space-y-3">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                        Book Cover <span className="font-normal text-slate-500 dark:text-slate-400">(optional)</span>
                      </h4>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                        Add a cover image to help identify your book.
                      </p>
                    </div>
                    <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-600 dark:bg-slate-800" role="tablist" aria-label="Book cover input method">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={coverMode === 'upload'}
                        onClick={() => {
                          setCoverMode('upload');
                          setCoverError('');
                        }}
                        className={`min-h-11 rounded-md px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary ${coverMode === 'upload' ? 'bg-shelf-primary text-white' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700'}`}
                      >
                        Upload image
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={coverMode === 'url'}
                        onClick={() => {
                          setCoverMode('url');
                          setCoverError('');
                        }}
                        className={`min-h-11 rounded-md px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary ${coverMode === 'url' ? 'bg-shelf-primary text-white' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700'}`}
                      >
                        Image URL
                      </button>
                    </div>
                    {coverMode === 'upload' ? (
                      <label
                        className={`flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-3 py-3 text-center transition ${coverDragActive ? 'border-shelf-primary bg-blue-50 dark:bg-slate-800' : 'border-slate-300 bg-white hover:border-shelf-primary dark:border-slate-600 dark:bg-slate-800'}`}
                        onDragOver={(event) => {
                          event.preventDefault();
                          setCoverDragActive(true);
                        }}
                        onDragLeave={() => setCoverDragActive(false)}
                        onDrop={(event) => {
                          event.preventDefault();
                          setCoverDragActive(false);
                          selectPersonalCover(event.dataTransfer.files?.[0]);
                        }}
                      >
                        <input
                          ref={coverFileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="sr-only"
                          onChange={(event) => {
                            selectPersonalCover(event.target.files?.[0]);
                            event.target.value = '';
                          }}
                        />
                        <span className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
                          {coverFile ? <ImagePlus size={16} aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
                          {coverFile ? coverFile.name : 'Click to upload or drag and drop'}
                        </span>
                        <span className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                          PNG, JPG or WEBP, up to 2 MB
                        </span>
                      </label>
                    ) : (
                      <div className="space-y-2">
                        <label htmlFor="personal-book-cover-url" className="sr-only">
                          Book cover image URL
                        </label>
                        <div className="relative">
                          <Link2 size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                          <input
                            id="personal-book-cover-url"
                            type="url"
                            value={coverUrlInput}
                            onChange={(event) => {
                              setCoverUrlInput(event.target.value);
                              setCoverUrlLoaded(false);
                              setCoverUrlError(false);
                              setCoverError('');
                            }}
                            placeholder="https://example.com/book-cover.jpg"
                            className="min-h-11 w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                          />
                        </div>
                        {coverUrlInput && isPersonalCoverUrlValid && (
                          <p className="text-xs text-slate-600 dark:text-slate-300" role="status">
                            {coverUrlLoaded ? 'Image preview loaded.' : coverUrlError ? 'This image could not be loaded. Check the URL.' : 'Loading image preview...'}
                          </p>
                        )}
                        {coverUrlInput && !isPersonalCoverUrlValid && (
                          <p className="text-xs text-red-700 dark:text-red-300">
                            Enter a valid image URL beginning with http:// or https://.
                          </p>
                        )}
                      </div>
                    )}
                    {coverError && (
                      <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-300">
                        {coverError}
                      </p>
                    )}
                  </div>
                </section>
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
              </div>
              <div className="visitor-personal-book-dialog-footer sticky bottom-0 flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800 sm:flex-row sm:justify-end sm:px-6">
                <button
                  type="button"
                  disabled={savingPersonalBook}
                  onClick={() => {
                    setShowAddPersonalBook(false);
                    setEditingPersonalBook(null);
                    resetPersonalBookForm();
                  }}
                  className="min-h-11 px-4 py-2.5 rounded-lg bg-slate-100 text-slate-600 text-sm font-bold hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPersonalBook}
                  className="min-h-11 px-5 py-2.5 rounded-lg bg-shelf-primary text-white text-sm font-bold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingPersonalBook
                    ? editingPersonalBook
                      ? coverUploading ? 'Uploading cover...' : 'Saving Changes...'
                      : coverUploading ? 'Uploading cover...' : 'Adding Book...'
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
          <div className="visitor-book-modal relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setSelectedBook(null)}
              className="absolute right-4 top-4 z-10 rounded-lg bg-white/90 p-2 text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary dark:bg-slate-800/90 dark:text-slate-100 dark:hover:bg-slate-700"
              aria-label="Close book information"
            >
              <X size={18} aria-hidden="true" />
            </button>
            <div className="visitor-book-modal-body min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
            <div className="visitor-book-modal-heading flex flex-col gap-4 pr-8 sm:flex-row">
              <BookCover key={`${selectedBook.id}-${selectedBook.coverUrl || selectedBook.title}`} src={selectedBook.coverUrl} title={selectedBook.title} className="h-32 w-24" />
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap gap-2">
                  {selectedBook.bookType === 'personal' ? (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-800 dark:bg-slate-700 dark:text-slate-100">
                      Community Book
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-800 dark:bg-slate-700 dark:text-slate-100">
                      Library Book
                    </span>
                  )}
                  {selectedBook.condition && (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-800 dark:bg-slate-700 dark:text-slate-100">
                      {selectedBook.condition}
                    </span>
                  )}
                </div>
                <h3 title={selectedBook.title || 'Untitled Book'} className="line-clamp-2 text-lg font-bold text-slate-900 dark:text-white">
                  {selectedBook.title || 'Untitled Book'}
                </h3>
                <p className="text-xs text-slate-700 dark:text-slate-200">
                  By {selectedBook.author || 'Unknown Author'}
                </p>
                <p className="text-xs tabular-nums text-slate-700 dark:text-slate-200">
                  ISBN: {selectedBook.isbn || '—'}
                </p>
              </div>
            </div>
            {selectedBook.bookType === 'personal' && (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                <h4 className="text-sm font-bold text-shelf-primary dark:text-white">
                  Community Lending
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-semibold text-shelf-primary dark:text-slate-200">
                      Condition
                    </p>
                    <p className="text-xs font-semibold text-slate-700">
                      {selectedBook.condition || 'Good'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-shelf-primary dark:text-slate-200">
                      Lending Period
                    </p>
                    <p className="text-xs font-semibold text-slate-700">
                      {selectedBook.lendingPeriodDays || 7} days
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-shelf-primary dark:text-slate-200">
                      Copies
                    </p>
                    <p className="text-xs font-semibold text-slate-700">
                      {getPersonalBookAvailabilityLabel(selectedBook)}
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs font-semibold text-shelf-primary dark:text-slate-200">
                      Handover Arrangement
                    </p>
                    <p className="text-xs font-semibold text-slate-700">
                      {getHandoverMethodLabel(selectedBook.handoverMethod)}
                    </p>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                    Owner approval is required before borrowing. Contact details are shared with the requester after approval.
                  </p>
                </div>
              </div>
            )}
            <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
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
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  Available Library Locations
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
                        className="visitor-library-entry flex flex-wrap items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs gap-3"
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
                        <div className="visitor-library-actions flex max-w-full flex-wrap items-center justify-end gap-2 shrink-0">
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
                            {submittingBorrowBookId === String(entry.id)
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
              <div className="visitor-modal-community-action space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
                <div>
                  <h4 className="text-sm font-bold text-emerald-950 dark:text-emerald-100">
                    Request to borrow
                  </h4>
                  <p className="mt-1 text-xs leading-5 text-emerald-900/80 dark:text-emerald-200/80">
                    {getPersonalBookCopyAvailability(selectedBook).availableCopies === 0
                      ? 'Join the queue. The owner must approve your request before arranging a handover.'
                      : 'Send a request to the owner. You can coordinate the handover after approval.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRequestCommunityBook(selectedBook)}
                  disabled={
                    submittingCommunityRequest ||
                    (selectedBook.ownerVisitorId &&
                      String(selectedBook.ownerVisitorId) === String(user?.id)) ||
                    selectedBook.lendingEnabled === false
                  }
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <HandHeart size={16} strokeWidth={2} aria-hidden="true" />
                  {submittingCommunityRequest
                    ? 'Submitting Request...'
                    : selectedBook.ownerVisitorId &&
                      String(selectedBook.ownerVisitorId) === String(user?.id)
                      ? 'This is your book'
                      : selectedBook.lendingEnabled === false
                        ? 'Lending unavailable'
                        : getPersonalBookCopyAvailability(selectedBook).availableCopies === 0
                      ? 'Join Community Book Queue'
                      : 'Request Community Book'}
                </button>
                {selectedBook.ownerVisitorId &&
                String(selectedBook.ownerVisitorId) === String(user?.id) ? (
                  <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                    You own this book. You cannot request your own personal book.
                  </p>
                ) : selectedBook.lendingEnabled === false ? (
                  <p role="status" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    This book is not currently available for community lending.
                  </p>
                ) : (
                  <p className="flex items-start gap-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
                    <MapPin size={14} className="mt-0.5 shrink-0 text-shelf-primary dark:text-slate-200" aria-hidden="true" />
                    <span>
                      Handover: {getHandoverMethodLabel(selectedBook.handoverMethod)}. Requests are handled in order and require owner approval.
                    </span>
                  </p>
                )}
              </div>
            )}
            <div className="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-700">
              <h4 className="flex items-center justify-between text-sm font-bold text-slate-900 dark:text-white">
                <span>Ratings &amp; Reviews</span>
                <span className="text-xs font-normal normal-case tracking-normal text-slate-500">
                  ({reviews.length} {reviews.length === 1 ? 'review' : 'reviews'})
                </span>
              </h4>
              <form onSubmit={handleSubmitReview} className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="text-xs font-bold text-slate-700">
                    Leave a Review:
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 mr-1">Rating:</span>
                    <div
                      className="inline-flex items-center gap-0.5"
                      role="group"
                      aria-label="Book rating"
                      onMouseLeave={() => setHoverRating(0)}
                    >
                      {Array.from({ length: 5 }, (_, index) => {
                        const rating = index + 1;
                        const displayedRating = hoverRating || userRating;
                        return (
                          <button
                            key={rating}
                            type="button"
                            onMouseEnter={() => setHoverRating(rating)}
                            onClick={() => setUserRating(rating)}
                            aria-label={`${rating} out of 5 stars`}
                            aria-pressed={userRating === rating}
                            className="rounded-sm p-0.5 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                          >
                            <Star
                              size={18}
                              className={rating <= displayedRating
                                ? 'fill-amber-400 text-amber-500'
                                : 'text-slate-500 dark:text-slate-300'}
                              aria-hidden="true"
                            />
                          </button>
                        );
                      })}
                    </div>
                    <span className="min-w-8 text-xs font-bold text-amber-800 dark:text-amber-300">
                      {hoverRating || userRating}/5
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
              <div className="visitor-modal-reviews max-h-48 space-y-3 overflow-y-auto pr-1">
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
        </div>
      )}
    </div>
  );
}
