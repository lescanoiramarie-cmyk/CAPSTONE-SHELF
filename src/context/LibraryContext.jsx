import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as store from '../data/store';
import { LibraryContext } from './libraryContext.js';

const emptyData = {
  books: [],
  libraries: [],
  visitors: [],
  borrowRequests: [],
  attendanceLogs: [],
};

export function LibraryProvider({ children }) {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState('');

  /**
   * Load all SHELF data from Supabase.
   *
   * This is intentionally centralized here so components such as
   * OPACCatalog and VisitorDashboard always receive the latest
   * database state through useLibraryData().
   */
  const refreshAll = useCallback(async () => {
    try {
      const [
        books,
        libraries,
        visitors,
        borrowRequests,
        attendanceLogs,
      ] = await Promise.all([
        store.fetchBooks(),
        store.fetchLibraries(),
        store.fetchVisitors(),
        store.fetchBorrowRequests(),
        store.fetchAttendanceLogs(),
      ]);

      setData({
        books: Array.isArray(books) ? books : [],
        libraries: Array.isArray(libraries) ? libraries : [],
        visitors: Array.isArray(visitors) ? visitors : [],
        borrowRequests: Array.isArray(borrowRequests)
          ? borrowRequests
          : [],
        attendanceLogs: Array.isArray(attendanceLogs)
          ? attendanceLogs
          : [],
      });

      setConnectionError('');

      return {
        books,
        libraries,
        visitors,
        borrowRequests,
        attendanceLogs,
      };
    } catch (err) {
      console.error('SHELF refreshAll error:', err);

      setConnectionError(
        err?.message ||
          'Could not connect to the database.'
      );

      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Initial load + authentication listener + Supabase Realtime.
   */
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

    const authSubscription = supabase?.auth?.onAuthStateChange(
      () => {
        // Do not perform heavy Supabase queries directly
        // inside the auth callback.
        setTimeout(() => {
          if (mounted) {
            void refreshAll().catch((error) => {
              console.error(
                'SHELF auth refresh failed:',
                error
              );
            });
          }
        }, 0);
      }
    );

    const channel = supabase
      ? supabase
          .channel('shelf-ilms-realtime')

          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'books',
            },
            () => {
              void refreshAll().catch((error) => {
                console.error(
                  'Realtime books refresh failed:',
                  error
                );
              });
            }
          )

          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'borrow_requests',
            },
            () => {
              void refreshAll().catch((error) => {
                console.error(
                  'Realtime borrow requests refresh failed:',
                  error
                );
              });
            }
          )

          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'attendance_logs',
            },
            () => {
              void refreshAll().catch((error) => {
                console.error(
                  'Realtime attendance refresh failed:',
                  error
                );
              });
            }
          )

          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'visitors',
            },
            () => {
              void refreshAll().catch((error) => {
                console.error(
                  'Realtime visitors refresh failed:',
                  error
                );
              });
            }
          )

          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'libraries',
            },
            () => {
              void refreshAll().catch((error) => {
                console.error(
                  'Realtime libraries refresh failed:',
                  error
                );
              });
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
        void supabase.removeChannel(channel);
      }

      authSubscription?.data?.subscription?.unsubscribe();
    };
  }, [refreshAll]);

  /**
   * Execute a store operation and ALWAYS refresh the
   * centralized application state afterward.
   *
   * This is especially important for borrow requests.
   *
   * Example:
   *
   * requestBorrow(...)
   *      ↓
   * store.requestBorrow(...)
   *      ↓
   * Supabase INSERT succeeds
   *      ↓
   * refreshAll()
   *      ↓
   * data.borrowRequests contains the new request
   *      ↓
   * OPACCatalog re-renders immediately
   */
  const withRefresh = useCallback(
    (fn, operationName = 'operation') =>
      async (...args) => {
        try {
          const result = await fn(...args);

          // Explicitly reload the database state after
          // every successful mutation.
          await refreshAll();

          return result;
        } catch (error) {
          console.error(
            `SHELF ${operationName} failed:`,
            error
          );

          // Do not hide the original error from the component.
          throw error;
        }
      },
    [refreshAll]
  );

  /**
   * Mutation functions.
   *
   * Each operation refreshes the centralized state after
   * Supabase successfully changes the database.
   */
  const addLibrary = useMemo(
    () => withRefresh(store.addLibrary, 'addLibrary'),
    [withRefresh]
  );

  const addBook = useMemo(
    () => withRefresh(store.addBook, 'addBook'),
    [withRefresh]
  );

  const addBooksBulk = useMemo(
    () => withRefresh(store.addBooksBulk, 'addBooksBulk'),
    [withRefresh]
  );

  const updateBook = useMemo(
    () => withRefresh(store.updateBook, 'updateBook'),
    [withRefresh]
  );

  const deleteBook = useMemo(
    () => withRefresh(store.deleteBook, 'deleteBook'),
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

  const scanAttendance = useMemo(
    () =>
      withRefresh(
        store.scanAttendance,
        'scanAttendance'
      ),
    [withRefresh]
  );

  /**
   * Context value.
   */
  const value = useMemo(
    () => ({
      data,
      loading,
      connectionError,

      // Expose refreshAll so components can explicitly
      // request the latest database state when needed.
      refreshAll,

      addLibrary,

      addBook,
      addBooksBulk,
      updateBook,
      deleteBook,

      loadSampleCatalog,

      requestBorrow,
      cancelBorrowRequest,

      confirmPickup,
      confirmReturn,

      scanAttendance,

      findVisitorByQr: store.findVisitorByQr,
      getVisitor: store.getVisitor,

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
      requestBorrow,
      cancelBorrowRequest,
      confirmPickup,
      confirmReturn,
      scanAttendance,
    ]
  );

  return (
    <LibraryContext.Provider value={value}>
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
