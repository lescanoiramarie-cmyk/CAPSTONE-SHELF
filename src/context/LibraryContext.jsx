import { useEffect, useState, useCallback } from 'react';
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
        books,
        libraries,
        visitors,
        borrowRequests,
        attendanceLogs,
      });

      setConnectionError('');
    } catch (err) {
      setConnectionError(
        err.message ||
          'Could not connect to the database.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refreshAll);

    const { data: authSubscription } = supabase?.auth.onAuthStateChange(() => {
      setTimeout(() => {
        refreshAll();
      }, 0);
    }) || { data: {} };

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
            refreshAll
          )
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'borrow_requests',
            },
            refreshAll
          )
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'attendance_logs',
            },
            refreshAll
          )
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'visitors',
            },
            refreshAll
          )
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'libraries',
            },
            refreshAll
          )
          .subscribe()
      : null;

    return () => {
      if (supabase && channel) supabase.removeChannel(channel);
      authSubscription.subscription?.unsubscribe();
    };
  }, [refreshAll]);

  const withRefresh =
    (fn) =>
    async (...args) => {
      const result = await fn(...args);
      await refreshAll();
      return result;
    };

  const value = {
    data,
    loading,
    connectionError,

    addLibrary: withRefresh(store.addLibrary),

    addBook: withRefresh(store.addBook),
    addBooksBulk: withRefresh(store.addBooksBulk),
    updateBook: withRefresh(store.updateBook),
    deleteBook: withRefresh(store.deleteBook),

    loadSampleCatalog:
      withRefresh(store.loadSampleCatalog),

    requestBorrow:
      withRefresh(store.requestBorrow),

    cancelBorrowRequest:
      withRefresh(store.cancelBorrowRequest),

    confirmPickup:
      withRefresh(store.confirmPickup),

    confirmReturn:
      withRefresh(store.confirmReturn),

    scanAttendance:
      withRefresh(store.scanAttendance),

    findVisitorByQr:
      store.findVisitorByQr,

    getVisitor:
      store.getVisitor,

    PICKUP_WINDOW_HOURS:
      store.PICKUP_WINDOW_HOURS,

    BORROW_PERIOD_DAYS:
      store.BORROW_PERIOD_DAYS,

    FINE_PER_DAY:
      store.FINE_PER_DAY,
  };

  return (
    <LibraryContext.Provider value={value}>
      {connectionError && (
        <div className="bg-red-600 text-white text-xs font-semibold px-4 py-2 text-center">
          Could not reach the database:{' '}
          {connectionError} — check your .env Supabase
          credentials (see .env.example) and that
          supabase/schema.sql has been run.
        </div>
      )}

      {children}
    </LibraryContext.Provider>
  );
}
