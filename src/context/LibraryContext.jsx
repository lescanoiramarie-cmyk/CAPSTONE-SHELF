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
  borrowRequests: [],
  attendanceLogs: [],
  personalBooks: [],
  communityBooks: [],
  myCommunityBookRequests: [],
  ownerCommunityBookRequests: [],
  ownerCommunityRequestLoadError: '',
};

export function LibraryProvider({ children }) {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState('');
  const refreshSequenceRef = useRef(0);

  // ==========================================================================
  // GET CURRENT VISITOR ID
  // ==========================================================================
  //
  // Resolve the visitor only from a real Supabase Auth session. A local
  // SHELF session controls protected-route UI state but is not proof of
  // identity for private RPCs or transaction history.
  // ==========================================================================

  const getCurrentVisitorId = useCallback(async () => {
    // Community-request RPCs are granted to authenticated visitors only.
    // Do not trust the local SHELF UI session as proof of identity: it can
    // exist without a Supabase access token and would make PostgREST execute
    // the RPC as anon, producing 401 / permission denied errors.
    try {
      const { data: authData, error: authError } =
        await supabase.auth.getSession();

      if (authError) {
        console.warn('SHELF Supabase session lookup failed:', authError);
        return null;
      }

      const authUserId = authData?.session?.user?.id || null;
      if (!authUserId) {
        return null;
      }

      const visitor = await store.getVisitor(authUserId);
      return visitor?.id || null;
    } catch (error) {
      console.warn('SHELF could not resolve authenticated visitor:', error);
      return null;
    }
  }, []);

  // ==========================================================================
  // LOAD ALL SHELF DATA
  // ==========================================================================

  const refreshAll = useCallback(async () => {
    const refreshSequence = ++refreshSequenceRef.current;
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
        externalCatalogBooks,
        libraries,
        visitors,
        normalBorrowRequests,
        attendanceLogs,
        communityBooks,
      ] = await Promise.all([
        store.fetchBooks(),
        store.fetchExternalCatalogBooks(),
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
      let ownerCommunityRequestLoadError = '';

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

        } catch (error) {
          console.error(
            'SHELF owner community book requests loading failed:',
            error
          );

          ownerCommunityBookRequests = [];
          ownerCommunityRequestLoadError =
            error?.message ||
            'Unable to load community book requests.';
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

      setData({
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

        ownerCommunityRequestLoadError,
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

      connectionError,

      refreshAll,

            // ----------------------------------------------------------------------
      // Library management
      // ----------------------------------------------------------------------

      addLibrary,

      updateLibrary,

      deleteLibrary,

      addBook,

      addBooksBulk,

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

      connectionError,

      refreshAll,

            addLibrary,

      updateLibrary,

      deleteLibrary,

      addBook,

      addBooksBulk,

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
        <div className="bg-red-600 text-white text-xs font-semibold px-4 py-2 text-center">
          Could not reach the database:{' '}
          {connectionError}
        </div>
      )}

      {children}
    </LibraryContext.Provider>
  );
}
