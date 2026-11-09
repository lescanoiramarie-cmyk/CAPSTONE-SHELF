import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';

import { supabase } from '../lib/supabaseClient';
import * as store from '../data/store';
import { LibraryContext } from './libraryContext.js';
import { useAuth } from './useAuth.js';
import ShelfLoader from '../component/ShelfLoader.jsx';

// ============================================================================
// SHELF ILMS — Library Context Provider
// ----------------------------------------------------------------------------
// Central application state and business-logic bridge.
//
// Components should use this context instead of importing Supabase/store
// functions directly.
//
// Authentication:
//   Visitors      → Supabase Auth session plus SHELF route/UI session
//   Staff/Admin   → Supabase Auth + staff profile
//
// Community books:
//   OPACCatalog
//       ↓
//   LibraryContext
//       ↓
//   store.js
//       ↓
//   PostgreSQL RPC functions
// ============================================================================

const emptyData = {
  books: [],
  externalCatalogBooks: [],
  libraries: [],
  visitors: [],
  visitorCount: 0,
  borrowRequests: [],
  attendanceLogs: [],
  personalBooks: [],
  communityBooks: [],
  myCommunityBookRequests: [],
  ownerCommunityBookRequests: [],
  ownerCommunityRequestLoadError: '',
};

const DATA_LOAD_TIMEOUT_MS = 15000;
const BORROW_REQUESTS_LOAD_TIMEOUT_MS = 60000;

export function LibraryProvider({ children }) {
  const { user } = useAuth();
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [splashElapsed, setSplashElapsed] = useState(false);
  const [initialDataReady, setInitialDataReady] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [attendanceLoadError, setAttendanceLoadError] = useState('');
  const [optionalDataLoadErrors, setOptionalDataLoadErrors] = useState([]);
  const [realtimeVisitorId, setRealtimeVisitorId] = useState(null);
  const [borrowRequestsLoading, setBorrowRequestsLoading] = useState(false);
  const [borrowRequestsLoadError, setBorrowRequestsLoadError] = useState('');
  const refreshSequenceRef = useRef(0);
  const borrowRequestsAbortControllerRef = useRef(null);
  const allBorrowRequestsAbortControllerRef = useRef(null);
  const borrowRequestsLoadSequenceRef = useRef(0);
  const borrowRequestsScopeRef = useRef(null);
  const currentVisitorProfileRef = useRef(null);
  const currentAuthUserIdRef = useRef(null);
  const lastResolvedAuthUserIdRef = useRef(undefined);
  const sessionIdentityRef = useRef(
    JSON.stringify([user?.id ?? null, user?.role ?? null])
  );

  useEffect(() => {
    const timer = setTimeout(() => setSplashElapsed(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const nextIdentity = JSON.stringify([user?.id ?? null, user?.role ?? null]);
    if (nextIdentity === sessionIdentityRef.current) return;

    sessionIdentityRef.current = nextIdentity;
    setInitialDataReady(false);
    setLoading(true);
    setConnectionError('');
  }, [user?.id, user?.role]);

  // ==========================================================================
  // GET CURRENT VISITOR ID
  // ==========================================================================
  //
  // Resolve the visitor only from a real Supabase Auth session. A local
  // SHELF session controls protected-route UI state but is not proof of
  // identity for private RPCs or transaction history.
  // ==========================================================================

  const getCurrentVisitorId = useCallback(async (role) => {
    currentVisitorProfileRef.current = null;
    currentAuthUserIdRef.current = null;
    // Community-request RPCs are granted to authenticated visitors only.
    // Do not trust the local SHELF UI session as proof of identity: it can
    // exist without a Supabase access token and would make PostgREST execute
    // the RPC as anon, producing 401 / permission denied errors.
    try {
      const { data: authData, error: authError } =
        await supabase.auth.getUser();

      let authUserId = authData?.user?.id || null;

      if (authError || !authUserId) {
        if (authError?.name === 'AuthSessionMissingError') {
          lastResolvedAuthUserIdRef.current = null;
          return null;
        }

        const {
          data: refreshedAuth,
          error: refreshError,
        } = await supabase.auth.refreshSession();

        authUserId =
          refreshedAuth?.session?.user?.id || null;

        if (refreshError || !authUserId) {
          if (!authUserId) lastResolvedAuthUserIdRef.current = null;
          if (authError) {
            console.warn(
              'SHELF Supabase user verification failed:',
              authError
            );
          }
          if (refreshError) {
            console.warn(
              'SHELF Supabase session refresh failed:',
              refreshError
            );
          }
          return null;
        }
      }

      currentAuthUserIdRef.current = authUserId;
      lastResolvedAuthUserIdRef.current = authUserId;
      if (role !== 'visitor') return null;

      const visitor = await store.getVisitor(authUserId);
      currentVisitorProfileRef.current = visitor;
      return visitor?.id || null;
    } catch (error) {
      currentVisitorProfileRef.current = null;
      console.warn('SHELF could not resolve authenticated visitor:', error);
      return null;
    }
  }, []);

  const loadVisitorBorrowRequests = useCallback(async (visitorId) => {
    const scope = `visitor:${visitorId}`;
    if (
      borrowRequestsScopeRef.current === scope &&
      borrowRequestsAbortControllerRef.current &&
      !borrowRequestsAbortControllerRef.current.signal.aborted
    ) return;

    if (borrowRequestsScopeRef.current !== scope) {
      borrowRequestsAbortControllerRef.current?.abort();
      allBorrowRequestsAbortControllerRef.current?.abort();
      setData((currentData) => ({
        ...currentData,
        borrowRequests: [],
      }));
    }

    borrowRequestsScopeRef.current = scope;
    const loadSequence = ++borrowRequestsLoadSequenceRef.current;
    setBorrowRequestsLoading(true);
    setBorrowRequestsLoadError('');

    borrowRequestsAbortControllerRef.current?.abort();
    const controller = new AbortController();
    borrowRequestsAbortControllerRef.current = controller;
    try {
      const request = store.fetchBorrowRequests({
        includeCommunityRequests: false,
        visitorId,
        signal: controller.signal,
      });
      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const error = new Error(
            'Borrowing history is taking too long to load. You can retry without reloading the dashboard.'
          );
          error.name = 'DataLoadTimeoutError';
          reject(error);
          controller.abort();
        }, DATA_LOAD_TIMEOUT_MS);
      });
      const requests = await Promise.race([request, timeout]).finally(() => {
        clearTimeout(timeoutId);
      });

      if (loadSequence !== borrowRequestsLoadSequenceRef.current) return;

      const mappedLibraryRequests = Array.isArray(requests)
        ? requests.map((requestRow) => ({
            ...requestRow,
            requestType: 'library',
            isCommunityBook: false,
          }))
        : [];
      setData((currentData) => {
        const communityRequests = currentData.borrowRequests.filter(
          (requestRow) =>
            requestRow?.isCommunityBook === true ||
            requestRow?.requestType === 'community'
        );
        const uniqueBorrowRequests = Array.from(
          new Map(
            [...mappedLibraryRequests, ...communityRequests]
              .filter((requestRow) => requestRow?.id)
              .map((requestRow) => [String(requestRow.id), requestRow])
          ).values()
        ).sort(
          (first, second) =>
            new Date(second?.requestDate || 0).getTime() -
            new Date(first?.requestDate || 0).getTime()
        );

        return {
          ...currentData,
          borrowRequests: uniqueBorrowRequests,
        };
      });
    } catch (error) {
      if (loadSequence !== borrowRequestsLoadSequenceRef.current) return;
      if (error?.name === 'AbortError') return;
      console.error('SHELF borrowing history loading failed:', error);
      setBorrowRequestsLoadError(
        error?.message || 'Unable to load your borrowing history.'
      );
    } finally {
      controller.abort();
      if (borrowRequestsAbortControllerRef.current === controller) {
        borrowRequestsAbortControllerRef.current = null;
      }
      if (loadSequence === borrowRequestsLoadSequenceRef.current) {
        setBorrowRequestsLoading(false);
      }
    }
  }, []);

  const loadAllBorrowRequests = useCallback(async () => {
    const scope = `account:${currentAuthUserIdRef.current || 'anonymous'}`;
    if (
      borrowRequestsScopeRef.current === scope &&
      allBorrowRequestsAbortControllerRef.current &&
      !allBorrowRequestsAbortControllerRef.current.signal.aborted
    ) return;

    if (borrowRequestsScopeRef.current !== scope) {
      borrowRequestsAbortControllerRef.current?.abort();
      allBorrowRequestsAbortControllerRef.current?.abort();
      setData((currentData) => ({
        ...currentData,
        borrowRequests: [],
      }));
    }

    borrowRequestsScopeRef.current = scope;
    const loadSequence = ++borrowRequestsLoadSequenceRef.current;
    const controller = new AbortController();
    allBorrowRequestsAbortControllerRef.current?.abort();
    allBorrowRequestsAbortControllerRef.current = controller;
    setBorrowRequestsLoading(true);
    setBorrowRequestsLoadError('');

    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        const error = new Error(
          'Borrowing history is taking too long to load. You can retry without reloading the dashboard.'
        );
        error.name = 'DataLoadTimeoutError';
        reject(error);
        controller.abort();
      }, BORROW_REQUESTS_LOAD_TIMEOUT_MS);
    });

    try {
      const requests = await Promise.race([
        store.fetchBorrowRequests({
          includeCommunityRequests: false,
          skipVisitorResolution: true,
          signal: controller.signal,
        }),
        timeout,
      ]);

      if (loadSequence !== borrowRequestsLoadSequenceRef.current) return;

      const mappedRequests = Array.isArray(requests)
        ? requests.map((requestRow) => ({
            ...requestRow,
            requestType: requestRow?.requestType || 'library',
            isCommunityBook: requestRow?.isCommunityBook === true,
          }))
        : [];
      setData((currentData) => ({
        ...currentData,
        borrowRequests: mappedRequests,
      }));
    } catch (error) {
      if (loadSequence !== borrowRequestsLoadSequenceRef.current) return;
      if (error?.name === 'AbortError') return;
      console.error('SHELF borrowing history loading failed:', error);
      setBorrowRequestsLoadError(
        error?.message || 'Unable to load borrowing history.'
      );
      setConnectionError(
        error?.message || 'Unable to load borrowing history.'
      );
    } finally {
      clearTimeout(timeoutId);
      if (allBorrowRequestsAbortControllerRef.current === controller) {
        allBorrowRequestsAbortControllerRef.current = null;
      }
      if (loadSequence === borrowRequestsLoadSequenceRef.current) {
        setBorrowRequestsLoading(false);
      }
    }
  }, []);

  // ==========================================================================
  // LOAD ALL SHELF DATA
  // ==========================================================================

  const refreshAll = useCallback(async () => {
    const refreshSequence = ++refreshSequenceRef.current;
    const optionalDataErrors = [];
    const waitForData = (request, operation) => {
      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const error = new Error(
            `${operation} is taking too long to load. Check your connection and retry.`
          );
          error.name = 'DataLoadTimeoutError';
          reject(error);
        }, DATA_LOAD_TIMEOUT_MS);
      });

      return Promise.race([request, timeout]).finally(() => {
        clearTimeout(timeoutId);
      });
    };
    const loadOptionalData = async (operation, request, fallback = []) => {
      try {
        const result = await waitForData(request, operation);
        return {
          data: Array.isArray(result) ? result : fallback,
          error: '',
        };
      } catch (error) {
        optionalDataErrors.push(operation);
        console.error(`SHELF ${operation.toLowerCase()} loading failed:`, error);
        return {
          data: fallback,
          error:
            error?.message || `Unable to load ${operation.toLowerCase()}.`,
        };
      }
    };
    const loadOptionalVisitorCount = async () => {
      try {
        return await waitForData(store.fetchVisitorCount(), 'Visitor count');
      } catch (error) {
        optionalDataErrors.push('Visitor count');
        console.error('SHELF visitor count loading failed:', error);
        return null;
      }
    };
    setLoading(true);
    try {
      // ----------------------------------------------------------------------
      // Resolve current visitor first.
      // ----------------------------------------------------------------------

      const currentVisitorId = await waitForData(
        getCurrentVisitorId(user?.role),
        'Visitor account data'
      );
      setRealtimeVisitorId(currentVisitorId);

      console.log(
        'SHELF — CURRENT VISITOR ID:',
        currentVisitorId
      );

      // ----------------------------------------------------------------------
      // Load shared/global data.
      // ----------------------------------------------------------------------

      const [
        books,
        externalCatalogResult,
        libraries,
        visitors,
        visitorCount,
        normalBorrowRequests,
        attendanceResult,
        communityBooksResult,
      ] = await Promise.all([
        waitForData(store.fetchBooks(), 'Library books'),
        loadOptionalData(
          'External catalog books',
          store.fetchExternalCatalogBooks(),
          []
        ),
        waitForData(store.fetchLibraries(), 'Library list'),
        currentVisitorId
          ? waitForData(
              store.fetchVisitors(
                currentVisitorId,
                currentVisitorProfileRef.current
              ),
              'Visitor profile'
            )
          : Promise.resolve([]),
        user?.role === 'subadmin' || user?.role === 'superadmin'
          ? loadOptionalVisitorCount()
          : Promise.resolve(currentVisitorId ? 1 : 0),
        currentVisitorId
          ? Promise.resolve([])
          : Promise.resolve([]),
        currentVisitorId || String(user?.role || '').toLowerCase() === 'visitor'
          ? Promise.resolve({ data: [], error: '' })
          : loadOptionalData(
              'Attendance records',
              store.fetchAttendanceLogs(),
              []
            ),
        loadOptionalData(
          'Community books',
          store.fetchCommunityBooks(),
          []
        ),
      ]);
      const externalCatalogBooks = externalCatalogResult.data;
      const { data: attendanceLogs, error: attendanceError } = attendanceResult;
      const communityBooks = communityBooksResult.data;

      if (attendanceError) {
        console.error('SHELF attendance loading failed:', attendanceError);
      }

      // ----------------------------------------------------------------------
      // Load books owned by the current visitor.
      // ----------------------------------------------------------------------

      const loadVisitorData = (operation, request, fallback) => {
        if (!currentVisitorId || !request) {
          return Promise.resolve({ data: fallback, error: '' });
        }
        return loadOptionalData(operation, request, fallback);
      };

      const [personalBooksResult, myCommunityRequestsResult, ownerRequestsResult] =
        currentVisitorId
          ? await Promise.all([
              loadVisitorData(
                'Personal books',
                store.fetchPersonalBooks(currentVisitorId),
                []
              ),
              loadVisitorData(
                'Your community book requests',
                typeof store.fetchMyCommunityBookRequests === 'function'
                  ? store.fetchMyCommunityBookRequests(currentVisitorId)
                  : null,
                []
              ),
              loadVisitorData(
                'Community book owner requests',
                typeof store.fetchOwnerCommunityBookRequests === 'function'
                  ? store.fetchOwnerCommunityBookRequests(currentVisitorId)
                  : null,
                []
              ),
            ])
          : [
              { data: [], error: '' },
              { data: [], error: '' },
              { data: [], error: '' },
            ];
      const personalBooks = personalBooksResult.data;
      const myCommunityBookRequests = myCommunityRequestsResult.data;
      const ownerCommunityBookRequests = ownerRequestsResult.data;
      const ownerCommunityRequestLoadError = ownerRequestsResult.error;

      console.log('SHELF — MY COMMUNITY REQUESTS:', {
        count: myCommunityBookRequests.length,
      });

      // ----------------------------------------------------------------------
      // Map normal library borrow requests.
      // ----------------------------------------------------------------------

      const mappedNormalBorrowRequests =
        Array.isArray(normalBorrowRequests)
          ? normalBorrowRequests.map(
              (request) => ({
                ...request,

                requestType:
                  request?.requestType ||
                  'library',

                isCommunityBook:
                  request?.isCommunityBook === true,
              })
            )
          : [];

      // ----------------------------------------------------------------------
      // Map community requests into the same structure used by
      // My Requests & Borrows.
      // ----------------------------------------------------------------------

      const mappedMyCommunityRequests =
        myCommunityBookRequests
          .filter(
            (request) =>
              request &&
              request.id
          )
          .map(
            (request) => ({
              id:
                request.id,

              bookId:
                request.book_id ||
                null,

              bookTitle:
                request.book_title ||
                'Untitled Book',

              visitorId:
                request.requester_visitor_id ||
                currentVisitorId ||
                null,

              visitorName:
                request.requester_name ||
                'SHELF Visitor',

              status:
                String(
                  request.status ||
                    'pending'
                )
                  .trim()
                  .toLowerCase(),

              requestDate:
                request.request_date ||
                null,

              queuePosition:
                request.queue_position ??
                null,

              pickupDeadline:
                request.pickup_deadline ||
                null,

              borrowDate:
                request.borrow_date ||
                null,

              dueDate:
                request.due_date ||
                null,

              returnDate:
                request.return_date ||
                null,

              fineAmount:
  Number(request.fine_amount ?? 0),

fineRateSnapshot:
  request.fine_rate_snapshot == null
    ? null
    : Number(request.fine_rate_snapshot),

fineReviewRequired:
  store.isFineReviewRequired(request),

              confirmedBy:
                request.confirmed_by ||
                null,

              returnConfirmedBy:
                request.return_confirmed_by ||
                null,

              cancelReason:
                request.cancel_reason ||
                null,

              // --------------------------------------------------------------
              // Community-book information
              // --------------------------------------------------------------

              requestType:
                'community',

              isCommunityBook:
                true,

              ownerVisitorId:
                request.owner_visitor_id ||
                null,

              ownerName:
                request.owner_name ||
                null,

              ownerContactEmail:
                request.owner_contact_email ||
                null,

              ownerContactNumber:
                request.owner_contact_number ||
                null,

              ownerContactDetails:
                request.owner_contact_details ||
                null,

              ownerResponse:
                request.owner_response ||
                null,

              approvedAt:
                request.approved_at ||
                null,

              rejectedAt:
                request.rejected_at ||
                null,

              lendingPeriodDays:
                request.lending_period_days ??
                null,
            })
          );

      // ----------------------------------------------------------------------
      // Merge normal library requests + community requests.
      // ----------------------------------------------------------------------

      const mergedBorrowRequests = [
        ...mappedNormalBorrowRequests,
        ...mappedMyCommunityRequests,
      ];

      // ----------------------------------------------------------------------
      // Remove duplicate request IDs.
      // ----------------------------------------------------------------------

      const uniqueBorrowRequests =
        Array.from(
          new Map(
            mergedBorrowRequests
              .filter(
                (request) =>
                  request &&
                  request.id
              )
              .map(
                (request) => [
                  String(
                    request.id
                  ),
                  request,
                ]
              )
          ).values()
        );

      // ----------------------------------------------------------------------
      // Sort newest request first.
      // ----------------------------------------------------------------------

      uniqueBorrowRequests.sort(
        (a, b) =>
          new Date(
            b?.requestDate || 0
          ).getTime() -
          new Date(
            a?.requestDate || 0
          ).getTime()
      );

      // ----------------------------------------------------------------------
      // Debug information.
      // ----------------------------------------------------------------------

      console.log(
        'SHELF — FINAL BORROW REQUESTS:',
        {
          visitorId:
            currentVisitorId,

          normalCount:
            mappedNormalBorrowRequests.length,

          communityCount:
            mappedMyCommunityRequests.length,

          totalCount:
            uniqueBorrowRequests.length,

          communityRequests:
            mappedMyCommunityRequests,
        }
      );

      // ----------------------------------------------------------------------
      // Update centralized application state.
      // ----------------------------------------------------------------------

      if (refreshSequence !== refreshSequenceRef.current) {
        return;
      }

      setData((currentData) => ({
        externalCatalogBooks: Array.isArray(externalCatalogBooks)
          ? externalCatalogBooks
            : [],

        books:
          Array.isArray(books)
            ? books
            : [],

        libraries:
          Array.isArray(libraries)
            ? libraries
            : [],

        visitors:
          Array.isArray(visitors)
            ? visitors
            : [],

        visitorCount,

        borrowRequests: currentVisitorId
          ? [
              ...currentData.borrowRequests.filter(
                (requestRow) =>
                  requestRow?.isCommunityBook !== true &&
                  requestRow?.requestType !== 'community'
              ),
              ...uniqueBorrowRequests,
            ]
          : currentData.borrowRequests,

        attendanceLogs:
          Array.isArray(attendanceLogs)
            ? attendanceLogs
            : [],

        personalBooks:
          Array.isArray(personalBooks)
            ? personalBooks
            : [],

        communityBooks:
          Array.isArray(communityBooks)
            ? communityBooks
            : [],

        myCommunityBookRequests:
          myCommunityBookRequests,

        ownerCommunityBookRequests:
          ownerCommunityBookRequests,

        ownerCommunityRequestLoadError,
      }));

      setAttendanceLoadError(attendanceError);
      setOptionalDataLoadErrors([...new Set(optionalDataErrors)]);
      setConnectionError('');
      setInitialDataReady(true);
      if (currentVisitorId) {
        void loadVisitorBorrowRequests(currentVisitorId);
      } else if (user?.role === 'visitor') {
        borrowRequestsAbortControllerRef.current?.abort();
        allBorrowRequestsAbortControllerRef.current?.abort();
        borrowRequestsScopeRef.current = null;
        borrowRequestsLoadSequenceRef.current += 1;
        setData((currentData) => ({
          ...currentData,
          borrowRequests: [],
        }));
        setBorrowRequestsLoading(false);
        setBorrowRequestsLoadError(
          'Unable to verify your visitor account. Please sign in again and retry.'
        );
      } else {
        void loadAllBorrowRequests();
      }

      return {
        books,
        libraries,
        visitors,
        visitorCount,

        borrowRequests:
          uniqueBorrowRequests,

        attendanceLogs,

        personalBooks,

        communityBooks,

        myCommunityBookRequests,

        ownerCommunityBookRequests,

        ownerCommunityRequestLoadError,
      };
    } catch (err) {
      if (refreshSequence !== refreshSequenceRef.current) {
        return;
      }

      console.error(
        'SHELF refreshAll error:',
        err
      );

      setConnectionError(
        err?.message ||
          'Could not connect to the database.'
      );

      throw err;
    } finally {
      if (refreshSequence === refreshSequenceRef.current) {
        setLoading(false);
      }
    }
  }, [
    getCurrentVisitorId,
    loadAllBorrowRequests,
    loadVisitorBorrowRequests,
    user?.role,
  ]);

  const retryBorrowRequests = useCallback(async () => {
    const visitorId = await getCurrentVisitorId(user?.role);

    if (!visitorId) {
      setBorrowRequestsLoadError(
        'Unable to verify your visitor account. Please sign in again and retry.'
      );
      return;
    }

    await loadVisitorBorrowRequests(visitorId);
  }, [getCurrentVisitorId, loadVisitorBorrowRequests, user?.role]);

  // ==========================================================================
  // VISITOR LOCAL SESSION CHANGES
  // ==========================================================================
  //
  // IMPORTANT:
  // This useEffect is directly inside LibraryProvider.
  // It must NOT be inside refreshAll().
  // This prevents React invalid Hook call / error #321.
  // ==========================================================================

  useEffect(() => {
    const handleVisitorSessionChanged = () => {
      console.log(
        'SHELF — VISITOR SESSION CHANGED. REFRESHING DATA...'
      );

      void refreshAll().catch((error) => {
        console.error(
          'SHELF visitor session refresh failed:',
          error
        );
      });
    };

    window.addEventListener(
      'shelf:visitor-session-changed',
      handleVisitorSessionChanged
    );

    return () => {
      window.removeEventListener(
        'shelf:visitor-session-changed',
        handleVisitorSessionChanged
      );
    };
  }, [refreshAll]);

  // ==========================================================================
  // INITIAL LOAD + AUTH + REALTIME
  // ==========================================================================

  useEffect(() => {
    let mounted = true;
    let realtimeRefreshTimer = null;
    let pendingRealtimeRefresh = null;
    const role = String(user?.role || '').toLowerCase();
    const isVisitor = role === 'visitor';
    const isStaff = role === 'subadmin' || role === 'superadmin';

    const scheduleRealtimeRefresh = (refresh = refreshAll) => {
      pendingRealtimeRefresh = refresh;
      if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer);
      realtimeRefreshTimer = setTimeout(() => {
        realtimeRefreshTimer = null;
        const refreshPending = pendingRealtimeRefresh;
        pendingRealtimeRefresh = null;
        if (mounted && document.visibilityState === 'visible' && refreshPending) {
          void refreshPending().catch((error) => {
            console.error('SHELF realtime refresh failed:', error);
          });
        }
      }, 750);
    };

    const applyRealtimeBookChange = (payload) => {
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      if (!row?.id) return;
      const id = String(row.id);
      const book = payload.eventType === 'DELETE' ? null : store.mapBook(row);
      setData((currentData) => {
        const replaceBook = (collection, includeBook = true) => {
          const remaining = (collection || []).filter((item) => String(item.id) !== id);
          if (!book || !includeBook) return remaining;
          return [book, ...remaining].sort((a, b) =>
            new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
          );
        };
        const personalBooks = (currentData.personalBooks || []).filter((item) => String(item.id) !== id);
        if (book?.bookType === 'personal' && book.ownerVisitorId && String(book.ownerVisitorId) === String(realtimeVisitorId)) {
          personalBooks.unshift(book);
        }
        return {
          ...currentData,
          books: replaceBook(currentData.books),
          communityBooks: replaceBook(currentData.communityBooks, book?.bookType === 'personal' && book.isPublic),
          personalBooks,
        };
      });
    };

    const applyRealtimeBorrowRequestChange = (payload) => {
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      if (!row?.id) return;
      const id = String(row.id);
      const updated = payload.eventType === 'DELETE' ? null : store.mapBorrowRequest(row);
      setData((currentData) => {
        const remaining = (currentData.borrowRequests || []).filter((item) => String(item.id) !== id);
        const borrowRequests = updated
          ? [updated, ...remaining].sort((a, b) => new Date(b.requestDate || 0) - new Date(a.requestDate || 0))
          : remaining;
        return { ...currentData, borrowRequests };
      });
    };

    const applyRealtimeAttendanceChange = (payload) => {
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      if (!row?.id) return;
      const id = String(row.id);
      const updated = payload.eventType === 'DELETE' ? null : {
        id: row.id,
        visitorId: row.visitor_id,
        visitorName: row.visitor_name,
        isTestData: /^\[TEST\]\s*/i.test(String(row.visitor_name || '')),
        libraryId: row.library_id,
        timeIn: row.time_in,
        checkedOutAt: row.checked_out_at,
      };
      setData((currentData) => {
        const current = currentData.attendanceLogs || [];
        const remaining = current.filter((item) => String(item.id) !== id);
        const attendanceLogs = updated
          ? [updated, ...remaining].sort((a, b) => new Date(b.timeIn || 0) - new Date(a.timeIn || 0)).slice(0, 5000)
          : remaining;
        return { ...currentData, attendanceLogs };
      });
      setAttendanceLoadError('');
    };

    // ------------------------------------------------------------------------
    // Initial data load.
    // ------------------------------------------------------------------------

    const initialize = async () => {
      try {
        await refreshAll();
      } catch (error) {
        if (mounted) {
          console.error(
            'SHELF initial data loading failed:',
            error
          );
        }
      }
    };

    void initialize();

    // ------------------------------------------------------------------------
    // Supabase authentication changes.
    // ------------------------------------------------------------------------

    const authSubscription =
      supabase?.auth?.onAuthStateChange(
        (event, session) => {
          if (event === 'INITIAL_SESSION') {
            return;
          }

          const nextAuthUserId = session?.user?.id || null;
          if (
            lastResolvedAuthUserIdRef.current !== undefined &&
            lastResolvedAuthUserIdRef.current !== nextAuthUserId
          ) {
            setInitialDataReady(false);
            setLoading(true);
            setConnectionError('');
          }
          lastResolvedAuthUserIdRef.current = nextAuthUserId;

          // Avoid heavy operations directly inside the auth callback.
          setTimeout(() => {
            if (mounted) {
              void refreshAll().catch(
                (error) => {
                  console.error(
                    'SHELF auth refresh failed:',
                    error
                  );
                }
              );
            }
          }, 0);
        }
      );

    // ------------------------------------------------------------------------
    // Supabase Realtime.
    // ------------------------------------------------------------------------

    const channel = supabase
      ? (() => {
          let nextChannel = supabase.channel(`shelf-ilms-realtime-${role || 'anonymous'}`)

          // ==================================================================
          // BOOKS
          // ==================================================================

          nextChannel = nextChannel.on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'books',
            },
            (payload) => {
              applyRealtimeBookChange(payload);
            }
          );

          // ==================================================================
          // BORROW REQUESTS
          // ==================================================================

          if (isVisitor && realtimeVisitorId) {
            nextChannel = nextChannel.on(
              'postgres_changes',
              {
                event: '*', schema: 'public', table: 'borrow_requests',
                filter: `visitor_id=eq.${realtimeVisitorId}`,
              },
              applyRealtimeBorrowRequestChange
            );
          } else if (isStaff) {
            nextChannel = nextChannel.on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: 'borrow_requests',
              },
              applyRealtimeBorrowRequestChange
            );
          }

          // ==================================================================
          // COMMUNITY BOOK REQUESTS
          // ==================================================================

          if (isStaff) nextChannel = nextChannel.on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'community_book_requests',
            },
            () => {
              scheduleRealtimeRefresh();
            }
          );

          // ==================================================================
          // ATTENDANCE
          // ==================================================================

          if (isStaff) {
            nextChannel = nextChannel.on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: 'attendance_logs',
              },
              applyRealtimeAttendanceChange
            );
          }

          // ==================================================================
          // VISITORS
          // ==================================================================

          if (isStaff) nextChannel = nextChannel.on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'visitors',
            },
            () => {
              scheduleRealtimeRefresh();
            }
          );

          // ==================================================================
          // LIBRARIES
          // ==================================================================

          if (isStaff) nextChannel = nextChannel.on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'libraries',
            },
            () => {
              scheduleRealtimeRefresh();
            }
          );

          return nextChannel.subscribe((status) => {
            console.log(
              'SHELF realtime status:',
              status
            );
          });
        })()
      : null;

    // ------------------------------------------------------------------------
    // Cleanup.
    // ------------------------------------------------------------------------

    return () => {
      mounted = false;
      if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer);

      if (supabase && channel) {
        void supabase.removeChannel(
          channel
        );
      }

      authSubscription
        ?.data
        ?.subscription
        ?.unsubscribe();
    };
  }, [loadAllBorrowRequests, loadVisitorBorrowRequests, realtimeVisitorId, refreshAll, user?.role]);

  // ==========================================================================
  // GENERIC MUTATION + REFRESH
  // ==========================================================================

  const withRefresh = useCallback(
    (fn, operationName = 'operation') =>
      async (...args) => {
        try {
          if (typeof fn !== 'function') {
            throw new Error(
              `${operationName} service is not available.`
            );
          }

          const result =
            await fn(...args);

          await refreshAll();

          return result;
        } catch (error) {
          console.error(
            `SHELF ${operationName} failed:`,
            error
          );

          throw error;
        }
      },
    [refreshAll]
  );

  // ==========================================================================
  // LIBRARY MUTATIONS
  // ==========================================================================

  const addLibrary = useMemo(
    () =>
      withRefresh(
        store.addLibrary,
        'addLibrary'
      ),
    [withRefresh]
  );


  const updateLibrary = useMemo(
    () =>
      withRefresh(
        store.updateLibrary,
        'updateLibrary'
      ),
    [withRefresh]
  );

  const deleteLibrary = useMemo(
    () =>
      withRefresh(
        store.deleteLibrary,
        'deleteLibrary'
      ),
    [withRefresh]
  );

  const addBook = useMemo(
    () =>
      withRefresh(
        store.addBook,
        'addBook'
      ),
    [withRefresh]
  );

  const addBooksBulk = useMemo(
    () =>
      withRefresh(
        store.addBooksBulk,
        'addBooksBulk'
      ),
    [withRefresh]
  );

  const importBooksBulk = useMemo(
    () =>
      withRefresh(
        store.importBooksBulk,
        'importBooksBulk'
      ),
    [withRefresh]
  );

  const updateBook = useMemo(
    () =>
      withRefresh(
        store.updateBook,
        'updateBook'
      ),
    [withRefresh]
  );

  const deleteBook = useMemo(
    () =>
      withRefresh(
        store.deleteBook,
        'deleteBook'
      ),
    [withRefresh]
  );

  const loadExternalCatalog = useMemo(
  () =>
    withRefresh(
      store.loadExternalCatalog,
      'loadExternalCatalog'
    ),
  [withRefresh]
);

  // ==========================================================================
  // PERSONAL BOOK
  // ==========================================================================

  const addPersonalBook = useCallback(
    async (...args) => {
      const savedBook = await store.addPersonalBook(...args);
      const mergeSavedBook = (currentData) => ({
        ...currentData,
        personalBooks: [
          savedBook,
          ...(currentData.personalBooks || []).filter(
            (book) => String(book.id) !== String(savedBook.id)
          ),
        ],
      });

      // Update the visible collection immediately so the add dialog can close
      // as soon as the save succeeds. Refresh the rest of the dashboard after.
      setData(mergeSavedBook);
      void refreshAll()
        .catch((error) => {
          console.error('SHELF personal-book refresh failed:', error);
        })
        .finally(() => {
          setData(mergeSavedBook);
        });

      return savedBook;
    },
    [refreshAll]
  );

  const setPersonalBookVisibility = useMemo(
    () =>
      withRefresh(
        store.setPersonalBookVisibility,
        'setPersonalBookVisibility'
      ),
    [withRefresh]
  );

  const updatePersonalBook = useMemo(
    () =>
      withRefresh(
        store.updatePersonalBook,
        'updatePersonalBook'
      ),
    [withRefresh]
  );

  const deletePersonalBook = useMemo(
    () =>
      withRefresh(
        store.deletePersonalBook,
        'deletePersonalBook'
      ),
    [withRefresh]
  );

  // ==========================================================================
  // COMMUNITY BOOK REQUESTS
  // ==========================================================================

  const requestCommunityBook = useMemo(
    () =>
      withRefresh(
        store.requestCommunityBook,
        'requestCommunityBook'
      ),
    [withRefresh]
  );

  // --------------------------------------------------------------------------
  // Fetch requests for books owned by current visitor
  // --------------------------------------------------------------------------

  const fetchOwnerCommunityBookRequests =
    useMemo(
      () =>
        typeof store.fetchOwnerCommunityBookRequests ===
        'function'
          ? store.fetchOwnerCommunityBookRequests
          : async () => {
              throw new Error(
                'fetchOwnerCommunityBookRequests service is not available.'
              );
            },
      []
    );

  // --------------------------------------------------------------------------
  // Fetch requests made by current visitor
  // --------------------------------------------------------------------------

  const fetchMyCommunityBookRequests =
    useMemo(
      () =>
        typeof store.fetchMyCommunityBookRequests ===
        'function'
          ? store.fetchMyCommunityBookRequests
          : async () => {
              throw new Error(
                'fetchMyCommunityBookRequests service is not available.'
              );
            },
      []
    );

  // --------------------------------------------------------------------------
  // Approve community book request
  // --------------------------------------------------------------------------

  const approveCommunityBookRequest = useMemo(
    () =>
      withRefresh(
        store.approveCommunityBookRequest,
        'approveCommunityBookRequest'
      ),
    [withRefresh]
  );

  // --------------------------------------------------------------------------
  // Reject community book request
  // --------------------------------------------------------------------------

  const rejectCommunityBookRequest = useMemo(
    () =>
      withRefresh(
        store.rejectCommunityBookRequest,
        'rejectCommunityBookRequest'
      ),
    [withRefresh]
  );

  // --------------------------------------------------------------------------
  // Confirm community book handover
  // --------------------------------------------------------------------------

  const confirmCommunityBookPickup = useMemo(
    () =>
      withRefresh(
        store.confirmCommunityBookPickup,
        'confirmCommunityBookPickup'
      ),
    [withRefresh]
  );

  // --------------------------------------------------------------------------
  // Confirm community book return
  // --------------------------------------------------------------------------

  const confirmCommunityBookReturn = useMemo(
    () =>
      withRefresh(
        store.confirmCommunityBookReturn,
        'confirmCommunityBookReturn'
      ),
    [withRefresh]
  );

  // ==========================================================================
  // BORROW / RESERVATION
  // ==========================================================================

  const requestBorrow = useMemo(
    () =>
      withRefresh(
        store.requestBorrow,
        'requestBorrow'
      ),
    [withRefresh]
  );

  const cancelBorrowRequest = useMemo(
    () =>
      withRefresh(
        store.cancelBorrowRequest,
        'cancelBorrowRequest'
      ),
    [withRefresh]
  );

  const confirmPickup = useMemo(
    () =>
      withRefresh(
        store.confirmPickup,
        'confirmPickup'
      ),
    [withRefresh]
  );

  const confirmReturn = useMemo(
    () =>
      withRefresh(
        store.confirmReturn,
        'confirmReturn'
      ),
    [withRefresh]
  );

  // ==========================================================================
  // ATTENDANCE
  // ==========================================================================

  const scanAttendance = useMemo(
    () =>
      withRefresh(
        store.scanAttendance,
        'scanAttendance'
      ),
    [withRefresh]
  );

  // ==========================================================================
  // CONTEXT VALUE
  // ==========================================================================

  const value = useMemo(
    () => ({
      // ----------------------------------------------------------------------
      // Centralized data
      // ----------------------------------------------------------------------

      data,

      // ----------------------------------------------------------------------
      // Individual collections
      // ----------------------------------------------------------------------

      books:
        Array.isArray(data.books)
          ? data.books
          : [],

      externalCatalogBooks: Array.isArray(data.externalCatalogBooks)
        ? data.externalCatalogBooks
          : [],

      libraries:
        Array.isArray(data.libraries)
          ? data.libraries
          : [],

      visitors:
        Array.isArray(data.visitors)
          ? data.visitors
          : [],

      visitorCount: data.visitorCount == null ? null : Number(data.visitorCount) || 0,

      borrowRequests:
        Array.isArray(data.borrowRequests)
          ? data.borrowRequests
          : [],

      attendanceLogs:
        Array.isArray(data.attendanceLogs)
          ? data.attendanceLogs
          : [],

      personalBooks:
        Array.isArray(data.personalBooks)
          ? data.personalBooks
          : [],

      communityBooks:
        Array.isArray(data.communityBooks)
          ? data.communityBooks
          : [],

      myCommunityBookRequests:
        Array.isArray(
          data.myCommunityBookRequests
        )
          ? data.myCommunityBookRequests
          : [],

      ownerCommunityBookRequests:
        Array.isArray(
          data.ownerCommunityBookRequests
        )
          ? data.ownerCommunityBookRequests
          : [],

      ownerCommunityRequestLoadError:
        data.ownerCommunityRequestLoadError || '',

      loading,
      initialDataReady,

      connectionError,
      attendanceLoadError,
      optionalDataLoadErrors,
      borrowRequestsLoading,
      borrowRequestsLoadError,
      retryBorrowRequests,

      refreshAll,

            // ----------------------------------------------------------------------
      // Library management
      // ----------------------------------------------------------------------

      addLibrary,

      updateLibrary,

      deleteLibrary,

      addBook,

      addBooksBulk,

      importBooksBulk,

      updateBook,

      deleteBook,

      loadExternalCatalog,
      // ----------------------------------------------------------------------
      // Personal / Community books
      // ----------------------------------------------------------------------

      addPersonalBook,

      setPersonalBookVisibility,

      updatePersonalBook,

      deletePersonalBook,

      requestCommunityBook,

      fetchOwnerCommunityBookRequests,

      fetchMyCommunityBookRequests,

      approveCommunityBookRequest,

      rejectCommunityBookRequest,

      confirmCommunityBookPickup,

      confirmCommunityBookReturn,

      // ----------------------------------------------------------------------
      // Borrowing
      // ----------------------------------------------------------------------

      requestBorrow,

      cancelBorrowRequest,

      confirmPickup,

      confirmReturn,

      // ----------------------------------------------------------------------
      // Attendance
      // ----------------------------------------------------------------------

      scanAttendance,

      // ----------------------------------------------------------------------
      // Visitor helpers
      // ----------------------------------------------------------------------

      findVisitorByQr:
        store.findVisitorByQr,

      getVisitor:
        store.getVisitor,

      // ----------------------------------------------------------------------
      // Business rules
      // ----------------------------------------------------------------------

      PICKUP_WINDOW_HOURS:
        store.PICKUP_WINDOW_HOURS,

      BORROW_PERIOD_DAYS:
        store.BORROW_PERIOD_DAYS,

      FINE_PER_DAY:
        store.FINE_PER_DAY,
    }),
    [
      data,

      loading,
      initialDataReady,

      connectionError,
      attendanceLoadError,
      optionalDataLoadErrors,
      borrowRequestsLoading,
      borrowRequestsLoadError,
      retryBorrowRequests,

      refreshAll,

            addLibrary,

      updateLibrary,

      deleteLibrary,

      addBook,

      addBooksBulk,

      importBooksBulk,

      updateBook,

      deleteBook,

      loadExternalCatalog,

      addPersonalBook,

      setPersonalBookVisibility,

      updatePersonalBook,

      deletePersonalBook,

      requestCommunityBook,

      fetchOwnerCommunityBookRequests,

      fetchMyCommunityBookRequests,

      approveCommunityBookRequest,

      rejectCommunityBookRequest,

      confirmCommunityBookPickup,

      confirmCommunityBookReturn,

      requestBorrow,

      cancelBorrowRequest,

      confirmPickup,

      confirmReturn,

      scanAttendance,
    ]
  );

  // ==========================================================================
  // PROVIDER
  // ==========================================================================

  return (
    <LibraryContext.Provider
      value={value}
    >
      {connectionError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-center gap-2 bg-red-700 px-4 py-2 text-center text-xs font-semibold text-white"
        >
          <span>Unable to load library data: {connectionError}</span>
          <button
            type="button"
            onClick={() =>
              refreshAll().catch((error) => {
                console.error('SHELF manual data refresh failed:', error);
              })
            }
            className="rounded border border-white/70 px-2 py-1 font-bold hover:bg-white/10"
          >
            Retry
          </button>
        </div>
      )}
      {attendanceLoadError && (
        <div role="status" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs font-semibold text-amber-950">
          Attendance data is temporarily unavailable. Other library data may still load.
        </div>
      )}
      {optionalDataLoadErrors.some(
        (operation) =>
          operation !== 'Attendance records' &&
          operation !== 'Community book owner requests'
      ) && (
        <div role="status" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs font-semibold text-amber-950">
          Some feature data is temporarily unavailable:{' '}
          {optionalDataLoadErrors
            .filter(
              (operation) =>
                operation !== 'Attendance records' &&
                operation !== 'Community book owner requests'
            )
            .join(', ')}.
          {' '}Use Retry to refresh.
          <button
            type="button"
            onClick={() =>
              refreshAll().catch((error) => {
                console.error('SHELF optional data retry failed:', error);
              })
            }
            className="ml-2 rounded border border-amber-800/50 px-2 py-1 font-bold hover:bg-amber-100"
          >
            Retry
          </button>
        </div>
      )}
      {children}
      {!splashElapsed && <ShelfLoader screen label="Loading SHELF..." />}
      {loading && initialDataReady && (
        <div className="pointer-events-none fixed inset-0 z-190 grid place-items-center">
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 py-3 text-sm font-semibold text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-800/95 dark:text-slate-100">
            <ShelfLoader compact label="Refreshing dashboard data..." />
            <span>Refreshing…</span>
          </div>
        </div>
      )}
    </LibraryContext.Provider>
  );
}
