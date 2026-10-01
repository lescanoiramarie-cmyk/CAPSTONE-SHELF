import {
  useEffect,
  useState,
  useCallback,
} from 'react';

import { supabase } from '../lib/supabaseClient';
import * as store from '../data/store';
import { LibraryContext } from './libraryContext.js';
import { useAuth } from './useAuth.js';

const emptyData = {
  books: [],
  libraries: [],
  visitors: [],
  borrowRequests: [],
  attendanceLogs: [],
};

export function LibraryProvider({ children }) {
  const { user } = useAuth();

  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] =
    useState('');

  /*
   * =========================================================
   * ROLE HELPERS
   * =========================================================
   */

  const isVisitor =
    user?.role === 'visitor';

  const isSubAdmin =
    user?.role === 'subadmin';

  const isSuperAdmin =
    user?.role === 'superadmin';

  const isStaff =
    isSubAdmin || isSuperAdmin;

  /*
   * =========================================================
   * DATA REFRESH
   * =========================================================
   *
   * IMPORTANT:
   *
   * Visitor:
   * - books
   * - libraries
   *
   * Staff:
   * - books
   * - libraries
   * - visitors
   * - borrow requests
   * - attendance logs
   *
   * We intentionally do NOT load the entire visitors table,
   * attendance table, or borrow-request table for visitors.
   */

  const refreshAll = useCallback(async () => {
    /*
     * If there is no logged-in user yet, load only the
     * public catalog data.
     */
    if (!user) {
      try {
        const [
          books,
          libraries,
        ] = await Promise.all([
          store.fetchBooks(),
          store.fetchLibraries(),
        ]);

        setData({
          books,
          libraries,
          visitors: [],
          borrowRequests: [],
          attendanceLogs: [],
        });

        setConnectionError('');
      } catch (err) {
        setConnectionError(
          err?.message ||
            'Could not connect to the database.'
        );
      } finally {
        setLoading(false);
      }

      return;
    }

    /*
     * =======================================================
     * VISITOR
     * =======================================================
     *
     * Do NOT request:
     * - all visitors
     * - all attendance logs
     *
     * Those are administrative datasets.
     */
    if (isVisitor) {
      try {
        const [
          books,
          libraries,
        ] = await Promise.all([
          store.fetchBooks(),
          store.fetchLibraries(),
        ]);

        setData({
          books,
          libraries,
          visitors: [],
          borrowRequests: [],
          attendanceLogs: [],
        });

        setConnectionError('');
      } catch (err) {
        setConnectionError(
          err?.message ||
            'Could not connect to the database.'
        );
      } finally {
        setLoading(false);
      }

      return;
    }

    /*
     * =======================================================
     * STAFF
     * =======================================================
     *
     * Sub-Admin and Super Admin retain the existing
     * administrative data loading behavior for now.
     *
     * We will tighten this further after the visitor-side
     * request query and RLS policies are prepared.
     */
    if (isStaff) {
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
          err?.message ||
            'Could not connect to the database.'
        );
      } finally {
        setLoading(false);
      }

      return;
    }

    /*
     * Unknown role:
     * fail closed instead of loading administrative data.
     */
    setData(emptyData);
    setConnectionError('');
    setLoading(false);
  }, [
    user,
    isVisitor,
    isStaff,
  ]);

  /*
   * =========================================================
   * INITIAL LOAD + REALTIME
   * =========================================================
   */

  useEffect(() => {
    setLoading(true);

    void Promise.resolve().then(
      refreshAll
    );

    /*
     * =======================================================
     * REALTIME CHANNEL
     * =======================================================
     *
     * Visitors only need catalog/library changes.
     *
     * Staff can continue receiving the administrative
     * realtime changes.
     */

    if (!supabase) {
      return undefined;
    }

    const channel =
      supabase
        .channel(
          `shelf-ilms-realtime-${user?.role || 'guest'}`
        )
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
            table: 'libraries',
          },
          refreshAll
        );

    /*
     * Administrative realtime subscriptions are only
     * registered for staff.
     */
    if (isStaff) {
      channel
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
        );
    }

    channel.subscribe();

    /*
     * =======================================================
     * AUTO-EXPIRE PICKUPS
     * =======================================================
     *
     * Keep the existing behavior.
     */
    const interval = setInterval(() => {
      store
        .autoExpireOverduePickups()
        .catch(() => {});
    }, 30000);

    store
      .autoExpireOverduePickups()
      .catch(() => {});

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [
    refreshAll,
    user?.role,
    isStaff,
  ]);

  /*
   * =========================================================
   * REFRESH WRAPPER
   * =========================================================
   */

  const withRefresh =
    (fn) =>
    async (...args) => {
      const result =
        await fn(...args);

      await refreshAll();

      return result;
    };

  /*
   * =========================================================
   * CONTEXT VALUE
   * =========================================================
   */

  const value = {
    data,
    loading,
    connectionError,

    /*
     * =======================================================
     * LIBRARIES
     * =======================================================
     */

    addLibrary:
      withRefresh(
        store.addLibrary
      ),

    /*
     * =======================================================
     * BOOKS
     * =======================================================
     */

    addBook:
      withRefresh(
        store.addBook
      ),

    updateBook:
      withRefresh(
        store.updateBook
      ),

    deleteBook:
      withRefresh(
        store.deleteBook
      ),

    loadSampleCatalog:
      withRefresh(
        store.loadSampleCatalog
      ),

    /*
     * =======================================================
     * BORROWING / QUEUE
     * =======================================================
     */

    requestBorrow:
      withRefresh(
        store.requestBorrow
      ),

    cancelBorrowRequest:
      withRefresh(
        store.cancelBorrowRequest
      ),

    confirmPickup:
      withRefresh(
        store.confirmPickup
      ),

    confirmReturn:
      withRefresh(
        store.confirmReturn
      ),

    /*
     * =======================================================
     * ATTENDANCE
     * =======================================================
     */

    scanAttendance:
      withRefresh(
        store.scanAttendance
      ),

    /*
     * =======================================================
     * VISITOR LOOKUPS
     * =======================================================
     *
     * These remain available because some staff workflows
     * use QR-based visitor lookup.
     *
     * Actual authorization will be enforced at the database
     * RPC/RLS level in the next security step.
     */

    findVisitorByQr:
      store.findVisitorByQr,

    getVisitor:
      store.getVisitor,

    /*
     * =======================================================
     * CONSTANTS
     * =======================================================
     */

    PICKUP_WINDOW_HOURS:
      store.PICKUP_WINDOW_HOURS,

    BORROW_PERIOD_DAYS:
      store.BORROW_PERIOD_DAYS,

    FINE_PER_DAY:
      store.FINE_PER_DAY,
  };

  return (
    <LibraryContext.Provider
      value={value}
    >
      {connectionError && (
        <div className="bg-red-600 text-white text-xs font-semibold px-4 py-2 text-center">
          Could not reach the database:{' '}
          {connectionError} — check your .env
          Supabase credentials (see
          .env.example) and that
          supabase/schema.sql has been run.
        </div>
      )}

      {children}
    </LibraryContext.Provider>
  );
}
