import { useContext } from 'react';
import { LibraryContext } from './libraryContext.js';

export function useLibrary() {
  const context = useContext(LibraryContext);
  if (!context) throw new Error('useLibrary must be used within a LibraryProvider');
  return context;
}

export function useLibraryData() {
  return useLibrary().data;
}