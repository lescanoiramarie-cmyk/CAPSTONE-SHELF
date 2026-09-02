import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as store from '../data/store';

const LibraryContext = createContext(null);

const emptyData = { books: [], libraries: [], visitors: [], borrowRequests: [], attendanceLogs: [] };

export function LibraryProvider({ children }) {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState('');

  const refreshAll = useCallback(async () => {
    try {
      const [books, libraries, visitors, borrowRequests, attendanceLogs] = await Promise.all([
        store.fetchBooks(),
        store.fetchLibraries(),
        store.fetchVisitors(),
        store.fetchBorrowRequests(),
        store.fetchAttendanceLogs(),
      ]);
      setData({ books, libraries, visitors, borrowRequests, attendanceLogs });
      setConnectionError('');
    } catch (err) {
      setConnectionError(err.message || 'Could not connect to the database.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + live sync across every open tab/device via Supabase
  // Realtime (Postgres Changes) — this is what makes borrow/return/attendance
  // updates appear instantly on the librarian's screen and the visitor's
  // screen at the same time, even on different devices.
  useEffect(() => {
    refreshAll();

    const channel = supabase
      .channel('shelf-ilms-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'books' }, refreshAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'borrow_requests' }, refreshAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_logs' }, refreshAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visitors' }, refreshAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'libraries' }, refreshAll)
      .subscribe();

    // Belt-and-suspenders: also sweep for expired pickups every 30s in case
    // no one is actively watching the affected rows.
    const interval = setInterval(() => {
      store.autoExpireOverduePickups().catch(() => {});
    }, 30000);
    store.autoExpireOverduePickups().catch(() => {});

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [refreshAll]);

  // Wrap mutating calls so the UI updates immediately after a successful
  // write, rather than waiting on the realtime round-trip.
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
    // libraries
    addLibrary: withRefresh(store.addLibrary),
    // books
    addBook: withRefresh(store.addBook),
    updateBook: withRefresh(store.updateBook),
    deleteBook: withRefresh(store.deleteBook),
    loadSampleCatalog: withRefresh(store.loadSampleCatalog),
    // borrowing / queue
    requestBorrow: withRefresh(store.requestBorrow),
    cancelBorrowRequest: withRefresh(store.cancelBorrowRequest),
    confirmPickup: withRefresh(store.confirmPickup),
    confirmReturn: withRefresh(store.confirmReturn),
    // attendance
    scanAttendance: withRefresh(store.scanAttendance),
    // visitors (read-only lookups, no refresh needed)
    findVisitorByQr: store.findVisitorByQr,
    getVisitor: store.getVisitor,
    // constants
    PICKUP_WINDOW_HOURS: store.PICKUP_WINDOW_HOURS,
    BORROW_PERIOD_DAYS: store.BORROW_PERIOD_DAYS,
    FINE_PER_DAY: store.FINE_PER_DAY,
  };

  return (
    <LibraryContext.Provider value={value}>
      {connectionError && (
        <div className="bg-red-600 text-white text-xs font-semibold px-4 py-2 text-center">
          Could not reach the database: {connectionError} — check your .env Supabase credentials (see .env.example)
          and that supabase/schema.sql has been run.
        </div>
      )}
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used within a LibraryProvider');
  return ctx;
}

export const useLibraryData = () => useLibrary().data;
