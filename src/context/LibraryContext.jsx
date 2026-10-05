import {
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';

import { supabase } from '../lib/supabaseClient';
import * as store from '../data/store';
import { LibraryContext } from './libraryContext.js';

// ============================================================================
// SHELF ILMS — Library Context Provider
// ----------------------------------------------------------------------------
// Central application state and business-logic bridge.
//
// Components should use this context instead of importing Supabase/store
// functions directly.
//
// Authentication:
//   Visitors      → Supabase Auth or SHELF local QR session
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
  libraries: [],
  visitors: [],
  borrowRequests: [],
  attendanceLogs: [],
  personalBooks: [],
  communityBooks: [],

  myCommunityBookRequests: [],
  ownerCommunityBookRequests: [],
};

export function LibraryProvider({ children }) {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState('');

  // ==========================================================================
  // GET CURRENT VISITOR ID
  // ==========================================================================
  //
  // SHELF supports:
  //
  // 1. Supabase Auth visitor sessions
  // 2. SHELF local QR visitor sessions
  //
  // QR login may not create a Supabase Auth session, so the local session
  // remains an important fallback.
  // ==========================================================================

  const getCurrentVisitorId = useCallback(async () => {
    // ------------------------------------------------------------------------
    // 1. Try the SHELF local visitor session first.
    // ------------------------------------------------------------------------

    try {
      const rawSession =
        localStorage.getItem('shelf_ilms_session_v1');

      if (rawSession) {
        const parsedSession =
          JSON.parse(rawSession);

        const localVisitorId =
          parsedSession?.role &&
          parsedSession.role !== 'visitor'
            ? null
            : parsedSession?.user?.id ||
              parsedSession?.user?.visitorId ||
              parsedSession?.user?.visitor_id ||
              parsedSession?.visitor?.id ||
              parsedSession?.visitor?.visitorId ||
              parsedSession?.visitor?.visitor_id ||
              parsedSession?.id ||
              parsedSession?.visitorId ||
              parsedSession?.visitor_id ||
              null;

        if (localVisitorId) {
          console.log(
            'SHELF — VISITOR ID FROM LOCAL SESSION:',
            localVisitorId
          );

          return localVisitorId;
        }
      }
    } catch (error) {
      console.warn(
        'SHELF local visitor session lookup failed:',
        error
      );
    }

    // ------------------------------------------------------------------------
    // 2. Fallback to Supabase Auth.
    // ------------------------------------------------------------------------

    try {
      const {
        data: authData,
      } = await supabase.auth.getSession();

      const authUserId =
        authData?.session?.user?.id || null;

      if (authUserId) {
        try {
          const visitor =
            await store.getVisitor(authUserId);

          if (visitor?.id) {
            console.log(
              'SHELF — VISITOR ID FROM SUPABASE AUTH:',
              visitor.id
            );

            return visitor.id;
          }
        } catch (error) {
          console.warn(
            'SHELF could not resolve visitor from Supabase Auth:',
            error
          );
        }
      }
    } catch (error) {
      console.warn(
        'SHELF Supabase session lookup failed:',
        error
      );
    }

    // ------------------------------------------------------------------------
    // 3. No visitor identity available.
    // ------------------------------------------------------------------------

    console.warn(
      'SHELF — NO CURRENT VISITOR ID FOUND.'
    );

    return null;
  }, []);

  // ==========================================================================
  // LOAD ALL SHELF DATA
  // ==========================================================================

  const refreshAll = useCallback(async () => {
    try {
      // ----------------------------------------------------------------------
      // Resolve current visitor first.
      // ----------------------------------------------------------------------

      const currentVisitorId =
        await getCurrentVisitorId();

      console.log(
        'SHELF — CURRENT VISITOR ID:',
        currentVisitorId
      );

      // ----------------------------------------------------------------------
      // Load shared/global data.
      // ----------------------------------------------------------------------

      const [
        books,
        libraries,
        visitors,
        normalBorrowRequests,
        attendanceLogs,
        communityBooks,
      ] = await Promise.all([
        store.fetchBooks(),

        store.fetchLibraries(),

        store.fetchVisitors(),

        store.fetchBorrowRequests(),

        store.fetchAttendanceLogs(),

        store.fetchCommunityBooks(),
      ]);

      // ----------------------------------------------------------------------
      // Load books owned by the current visitor.
      // ----------------------------------------------------------------------

      let personalBooks = [];

      if (currentVisitorId) {
        try {
          personalBooks =
            await store.fetchPersonalBooks(
              currentVisitorId
            );
        } catch (error) {
          console.error(
            'SHELF personal books loading failed:',
            error
          );

          personalBooks = [];
        }
      }

      // ----------------------------------------------------------------------
      // Load community-book requests made by current visitor.
      // ----------------------------------------------------------------------

      let myCommunityBookRequests = [];

      if (
        currentVisitorId &&
        typeof store.fetchMyCommunityBookRequests ===
          'function'
      ) {
        try {
          const result =
            await store.fetchMyCommunityBookRequests(
              currentVisitorId
            );

          myCommunityBookRequests =
            Array.isArray(result)
              ? result
              : [];

          console.log(
            'SHELF — MY COMMUNITY REQUESTS:',
            {
              visitorId:
                currentVisitorId,

              count:
                myCommunityBookRequests.length,

              requests:
                myCommunityBookRequests,
            }
          );
        } catch (error) {
          console.error(
            'SHELF my community book requests loading failed:',
            error
          );

          myCommunityBookRequests = [];
        }
      }

      // ----------------------------------------------------------------------
      // Load community-book requests for books owned by current visitor.
      // ----------------------------------------------------------------------

      let ownerCommunityBookRequests = [];

      if (
        currentVisitorId &&
        typeof store.fetchOwnerCommunityBookRequests ===
          'function'
      ) {
        try {
          const result =
            await store.fetchOwnerCommunityBookRequests(
              currentVisitorId
            );

          ownerCommunityBookRequests =
            Array.isArray(result)
              ? result
              : [];

          console.log(
            'SHELF — OWNER COMMUNITY REQUESTS:',
            {
              visitorId:
                currentVisitorId,

              count:
                ownerCommunityBookRequests.length,

              requests:
                ownerCommunityBookRequests,
            }
          );
        } catch (error) {
          console.error(
            'SHELF owner community book requests loading failed:',
            error
          );

          ownerCommunityBookRequests = [];
        }
      }

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

              pickupDeadline:
                request.pickup_deadline ||
                null,

              queuePosition:
                request.queue_position ??
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
                Number(
                  request.fine_amount ??
                    0
                ) || 0,

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

      setData({
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

        borrowRequests:
          uniqueBorrowRequests,

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
      });

      setConnectionError('');

      return {
        books,
        libraries,
        visitors,

        borrowRequests:
          uniqueBorrowRequests,

        attendanceLogs,

        personalBooks,

        communityBooks,

        myCommunityBookRequests,

        ownerCommunityBookRequests,
      };
    } catch (err) {
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
      setLoading(false);
    }
  }, [getCurrentVisitorId]);

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
        () => {
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
      ? supabase
          .channel('shelf-ilms-realtime')

          // ==================================================================
          // BOOKS
          // ==================================================================

          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'books',
            },
            () => {
              void refreshAll().catch(
                (error) => {
                  console.error(
                    'Realtime books refresh failed:',
                    error
                  );
                }
              );
            }
          )

          // ==================================================================
          // BORROW REQUESTS
          // ==================================================================

          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'borrow_requests',
            },
            () => {
              void refreshAll().catch(
                (error) => {
                  console.error(
                    'Realtime borrow requests refresh failed:',
                    error
                  );
                }
              );
            }
          )

          // ==================================================================
          // COMMUNITY BOOK REQUESTS
          // ==================================================================

          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'community_book_requests',
            },
            () => {
              void refreshAll().catch(
                (error) => {
                  console.error(
                    'Realtime community book request refresh failed:',
                    error
                  );
                }
              );
            }
          )

          // ==================================================================
          // ATTENDANCE
          // ==================================================================

          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'attendance_logs',
            },
            () => {
              void refreshAll().catch(
                (error) => {
                  console.error(
                    'Realtime attendance refresh failed:',
                    error
                  );
                }
              );
            }
          )

          // ==================================================================
          // VISITORS
          // ==================================================================

          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'visitors',
            },
            () => {
              void refreshAll().catch(
                (error) => {
                  console.error(
                    'Realtime visitors refresh failed:',
                    error
                  );
                }
              );
            }
          )

          // ==================================================================
          // LIBRARIES
          // ==================================================================

          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'libraries',
            },
            () => {
              void refreshAll().catch(
                (error) => {
                  console.error(
                    'Realtime libraries refresh failed:',
                    error
                  );
                }
              );
            }
          )

          .subscribe((status) => {
            console.log(
              'SHELF realtime status:',
              status
            );
          })
      : null;

    // ------------------------------------------------------------------------
    // Cleanup.
    // ------------------------------------------------------------------------

    return () => {
      mounted = false;

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
  }, [refreshAll]);

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

  const loadSampleCatalog = useMemo(
    () =>
      withRefresh(
        store.loadSampleCatalog,
        'loadSampleCatalog'
      ),
    [withRefresh]
  );

  // ==========================================================================
  // PERSONAL BOOK
  // ==========================================================================

  const addPersonalBook = useMemo(
    () =>
      withRefresh(
        store.addPersonalBook,
        'addPersonalBook'
      ),
    [withRefresh]
  );

  const setPersonalBookVisibility = useMemo(
    () =>
      withRefresh(
        store.setPersonalBookVisibility,
        'setPersonalBookVisibility'
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

      libraries:
        Array.isArray(data.libraries)
          ? data.libraries
          : [],

      visitors:
        Array.isArray(data.visitors)
          ? data.visitors
          : [],

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

      loading,

      connectionError,

      refreshAll,

      // ----------------------------------------------------------------------
      // Library management
      // ----------------------------------------------------------------------

      addLibrary,

      addBook,

      addBooksBulk,

      updateBook,

      deleteBook,

      loadSampleCatalog,

      // ----------------------------------------------------------------------
      // Personal / Community books
      // ----------------------------------------------------------------------

      addPersonalBook,

      setPersonalBookVisibility,

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

      connectionError,

      refreshAll,

      addLibrary,

      addBook,

      addBooksBulk,

      updateBook,

      deleteBook,

      loadSampleCatalog,

      addPersonalBook,

      setPersonalBookVisibility,

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
        <div className="bg-red-600 text-white text-xs font-semibold px-4 py-2 text-center">
          Could not reach the database:{' '}
          {connectionError}
        </div>
      )}

      {children}
    </LibraryContext.Provider>
  );
}
