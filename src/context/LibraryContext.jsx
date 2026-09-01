import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import * as store from '../data/store';

const LibraryContext = createContext(null);

export function LibraryProvider({ children }) {
  const data = useSyncExternalStore(store.subscribe, store.getState, store.getState);

  // Auto-expire any "ready for pickup" requests whose window has passed, and
  // promote the next queued visitor. Runs on mount and every 30s so the
  // circulation desk / catalog views stay current without a manual refresh.
  useEffect(() => {
    store.autoExpireOverduePickups();
    const interval = setInterval(() => {
      store.autoExpireOverduePickups();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const value = {
    data,
    // books
    addBook: store.addBook,
    updateBook: store.updateBook,
    deleteBook: store.deleteBook,
    loadSampleCatalog: store.loadSampleCatalog,
    // borrowing / queue
    requestBorrow: store.requestBorrow,
    cancelBorrowRequest: store.cancelBorrowRequest,
    confirmPickup: store.confirmPickup,
    confirmReturn: store.confirmReturn,
    // attendance
    scanAttendance: store.scanAttendance,
    // visitors
    findVisitorByQr: store.findVisitorByQr,
    getVisitor: store.getVisitor,
    // constants
    PICKUP_WINDOW_HOURS: store.PICKUP_WINDOW_HOURS,
    BORROW_PERIOD_DAYS: store.BORROW_PERIOD_DAYS,
    FINE_PER_DAY: store.FINE_PER_DAY,
  };

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used within a LibraryProvider');
  return ctx;
}

// Small helper hook: books enriched with their queue length, for UI badges.
export function useBookQueueLength(bookId) {
  const { data } = useLibrary();
  return data.borrowRequests.filter((r) => r.bookId === bookId && r.status === 'queued').length;
}

export const useLibraryData = () => useLibrary().data;
