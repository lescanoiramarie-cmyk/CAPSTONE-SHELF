import {
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';

import { supabase } from '../lib/supabaseClient';
import * as store from '../data/store';
import { LibraryContext } from './libraryContext.js';

const emptyData = {
  books: [],
  libraries: [],
  visitors: [],
  borrowRequests: [],
  attendanceLogs: [],

  // =========================================================
  // PERSONAL / COMMUNITY BOOKS
  // =========================================================
  personalBooks: [],
  communityBooks: [],
};

export function LibraryProvider({ children }) {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState('');

  // =========================================================
  // GET CURRENT VISITOR ID
  // =========================================================
  //
  // SHELF currently supports QR/local-session visitor login.
  // Therefore, do not rely exclusively on supabase.auth.getUser().
  //
  // The store already knows how to work with the SHELF visitor
  // session, so we first try the Supabase Auth session and then
  // the local SHELF session.
  // =========================================================

  const getCurrentVisitorId = useCallback(async () => {
    try {
      const {
        data: authData,
      } = await supabase.auth.getSession();

      const authUserId =
        authData?.session?.user?.id || null;

      if (authUserId) {
        try {
          const visitor = await store.getVisitor(
            authUserId
          );

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

    // =======================================================
    // FALLBACK: SHELF LOCAL QR SESSION
    // =======================================================

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

  // =========================================================
  // LOAD ALL SHELF DATA
  // =========================================================

  const refreshAll = useCallback(async () => {
    try {
      // -------------------------------------------------------
      // Resolve current visitor first.
      // -------------------------------------------------------

      const currentVisitorId =
        await getCurrentVisitorId();

      // -------------------------------------------------------
      // Load shared/global data.
      // -------------------------------------------------------

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

        // Community books are available to visitors who can
        // access the catalog.
        store.fetchCommunityBooks(),
      ]);

      // -------------------------------------------------------
      // Load books owned by the current visitor.
      // -------------------------------------------------------

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

          // Do not destroy the rest of the application
          // state if only personal books fail.
          personalBooks = [];
        }
      }

      // -------------------------------------------------------
      // Update centralized application state.
      // -------------------------------------------------------

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

  // =========================================================
  // INITIAL LOAD + AUTH + REALTIME
  // =========================================================

  useEffect(() => {
    let mounted = true;

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

    // -------------------------------------------------------
    // Supabase authentication changes
    // -------------------------------------------------------

    const authSubscription =
      supabase?.auth?.onAuthStateChange(
        () => {
          // Do not perform heavy Supabase operations
          // directly inside the Auth callback.
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

    // -------------------------------------------------------
    // Supabase Realtime
    // -------------------------------------------------------

    const channel = supabase
      ? supabase
          .channel('shelf-ilms-realtime')

          // =================================================
          // BOOKS
          // =================================================
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

          // =================================================
          // BORROW REQUESTS
          // =================================================
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

          // =================================================
          // ATTENDANCE
          // =================================================
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

          // =================================================
          // VISITORS
          // =================================================
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

          // =================================================
          // LIBRARIES
          // =================================================
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

    return () => {
      mounted = false;

      if (supabase && channel) {
        void supabase.removeChannel(
          channel
        );
      }

      authSubscription?.data?.subscription?.unsubscribe();
    };
  }, [refreshAll]);

  // =========================================================
  // GENERIC MUTATION + REFRESH
  // =========================================================

  const withRefresh = useCallback(
    (fn, operationName = 'operation') =>
      async (...args) => {
        try {
          const result = await fn(...args);

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

  // =========================================================
  // LIBRARY MUTATIONS
  // =========================================================

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

  // =========================================================
  // PERSONAL BOOK MUTATIONS
  // =========================================================
  //
  // addPersonalBook() creates a visitor-owned book.
  //
  // We expose it through the LibraryContext so that
  // OPACCatalog does not need to import Supabase/store
  // directly.
  // =========================================================

  const addPersonalBook = useMemo(
    () =>
      withRefresh(
        store.addPersonalBook,
        'addPersonalBook'
      ),
    [withRefresh]
  );

  // =========================================================
  // BORROW / RESERVATION
  // =========================================================

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

  // =========================================================
  // ATTENDANCE
  // =========================================================

  const scanAttendance = useMemo(
    () =>
      withRefresh(
        store.scanAttendance,
        'scanAttendance'
      ),
    [withRefresh]
  );

  // =========================================================
  // CONTEXT VALUE
  // =========================================================

  const value = useMemo(
    () => ({
      data,

      loading,

      connectionError,

      refreshAll,

      // -----------------------------------------------------
      // Library management
      // -----------------------------------------------------

      addLibrary,

      addBook,
      addBooksBulk,
      updateBook,
      deleteBook,

      loadSampleCatalog,

      // -----------------------------------------------------
      // Personal / community books
      // -----------------------------------------------------

      addPersonalBook,

      // -----------------------------------------------------
      // Borrowing
      // -----------------------------------------------------

      requestBorrow,
      cancelBorrowRequest,

      confirmPickup,
      confirmReturn,

      // -----------------------------------------------------
      // Attendance
      // -----------------------------------------------------

      scanAttendance,

      // -----------------------------------------------------
      // Visitor helpers
      // -----------------------------------------------------

      findVisitorByQr:
        store.findVisitorByQr,

      getVisitor:
        store.getVisitor,

      // -----------------------------------------------------
      // Business rules
      // -----------------------------------------------------

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

      requestBorrow,
      cancelBorrowRequest,

      confirmPickup,
      confirmReturn,

      scanAttendance,
    ]
  );

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
