function getBookLibraryId(book) {
  return String(book?.libraryId ?? book?.library_id ?? '');
}

export function getBookInventoryScope(books, libraries, user) {
  const allBooks = Array.isArray(books) ? books : [];
  const allLibraries = Array.isArray(libraries) ? libraries : [];
  const isSubAdmin = user?.role === 'subadmin';
  const assignedLibraryId = String(
    user?.libraryId ?? user?.assignedBranch ?? user?.library_id ?? ''
  );

  if (!isSubAdmin) {
    return {
      books: allBooks,
      libraries: allLibraries,
      assignedLibraryId,
      isSubAdmin,
    };
  }

  if (!assignedLibraryId) {
    return {
      books: [],
      libraries: [],
      assignedLibraryId,
      isSubAdmin,
    };
  }

  return {
    books: allBooks.filter(
      (book) => getBookLibraryId(book) === assignedLibraryId
    ),
    libraries: allLibraries.filter(
      (library) => String(library?.id ?? '') === assignedLibraryId
    ),
    assignedLibraryId,
    isSubAdmin,
  };
}