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

  // Personal / Community books
  personalBooks: [],
  communityBooks: [],
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
    // Try Supabase Auth first.
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
    // Fallback: SHELF local QR session.
    // ------------------------------------------------------------------------

    try {
      const rawSession =
        globalThis.localStorage?.getItem(
          'shelf_ilms_session_v1'
        );

      if (!rawSession) {
        return null;
      }

      const parsedSession =
        JSON.parse(rawSession);

      return (
        parsedSession?.user?.id ||
        parsedSession?.visitor?.id ||
        parsedSession?.id ||
        null
      );
    } catch (error) {
      console.warn(
        'SHELF local visitor session could not be read:',
        error
      );

      return null;
    }
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

      // ----------------------------------------------------------------------
      // Load shared/global data.
      // ----------------------------------------------------------------------

      const [
        books,
        libraries,
        visitors,
        borrowRequests,
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

          // Do not prevent the rest of the application from loading.
          personalBooks = [];
        }
      }

      // ----------------------------------------------------------------------
      // Update centralized application state.
      // ----------------------------------------------------------------------

      setData({
        books: Array.isArray(books)
          ? books
          : [],

        libraries: Array.isArray(libraries)
          ? libraries
          : [],

        visitors: Array.isArray(visitors)
          ? visitors
          : [],

        borrowRequests: Array.isArray(
          borrowRequests
        )
          ? borrowRequests
          : [],

        attendanceLogs: Array.isArray(
          attendanceLogs
        )
          ? attendanceLogs
          : [],

        personalBooks: Array.isArray(
          personalBooks
        )
          ? personalBooks
          : [],

        communityBooks: Array.isArray(
          communityBooks
        )
          ? communityBooks
          : [],
      });

      setConnectionError('');

      return {
        books,
        libraries,
        visitors,
        borrowRequests,
        attendanceLogs,
        personalBooks,
        communityBooks,
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

  // ==========================================================================
  // COMMUNITY BOOK REQUESTS
  // ==========================================================================

  // --------------------------------------------------------------------------
  // Request a community book
  // --------------------------------------------------------------------------

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

      // Expose individual collections too.
      // This preserves compatibility with components that use:
      // const { books } = useLibraryData();

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

      requestCommunityBook,

      fetchOwnerCommunityBookRequests,

      fetchMyCommunityBookRequests,

      approveCommunityBookRequest,

      rejectCommunityBookRequest,

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

      requestCommunityBook,

      fetchOwnerCommunityBookRequests,

      fetchMyCommunityBookRequests,

      approveCommunityBookRequest,

      rejectCommunityBookRequest,

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
