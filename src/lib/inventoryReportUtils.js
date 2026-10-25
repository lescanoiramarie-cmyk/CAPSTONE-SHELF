const numberValue = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const getInstitutionalBooks = (books = []) =>
  (Array.isArray(books) ? books : []).filter((book) =>
    (book.bookType ?? book.book_type) === 'library'
  );

const borrowedCopies = (book) => Math.max(
  0,
  numberValue(book.totalCopies ?? book.total_copies) - numberValue(book.availableCopies ?? book.available_copies)
);

const utilizationRate = (book) => {
  const total = numberValue(book.totalCopies ?? book.total_copies);
  return total ? Number(((borrowedCopies(book) / total) * 100).toFixed(2)) : 0;
};

export const buildBranchAuditRows = (books) => getInstitutionalBooks(books).map((book) => ({
  id: book.id,
  title: book.title,
  author: book.author,
  category: book.category,
  isbn: book.isbn,
  shelfLocation: book.shelfLocation ?? book.shelf_location,
  totalCopies: numberValue(book.totalCopies ?? book.total_copies),
  availableCopies: numberValue(book.availableCopies ?? book.available_copies),
  borrowedCopies: borrowedCopies(book),
  condition: book.condition,
}));

export const buildMasterCatalogRows = (books) => getInstitutionalBooks(books).map((book) => ({
  id: book.id,
  title: book.title,
  author: book.author,
  isbn: book.isbn,
  category: book.category,
  libraryId: book.libraryId ?? book.library_id,
  totalCopies: numberValue(book.totalCopies ?? book.total_copies),
  availableCopies: numberValue(book.availableCopies ?? book.available_copies),
  createdAt: book.createdAt ?? book.created_at,
  updatedAt: book.updatedAt ?? book.updated_at,
}));

export const buildAssetAllocationRows = (books) => getInstitutionalBooks(books).map((book) => ({
  id: book.id,
  title: book.title,
  author: book.author,
  libraryId: book.libraryId ?? book.library_id,
  totalCopies: numberValue(book.totalCopies ?? book.total_copies),
  availableCopies: numberValue(book.availableCopies ?? book.available_copies),
  borrowedCopies: borrowedCopies(book),
  utilizationRate: utilizationRate(book),
  createdAt: book.createdAt ?? book.created_at,
}));

const groupSum = (rows, key, value = () => 1) => {
  const groups = new Map();
  rows.forEach((row) => {
    const label = row[key] || 'Uncategorized';
    groups.set(label, (groups.get(label) || 0) + value(row));
  });
  return [...groups.entries()].sort((left, right) => right[1] - left[1]);
};

const libraryName = (libraries, id) =>
  libraries.find((library) => String(library.id) === String(id))?.name || String(id || 'Unknown');

export const buildBranchAuditAnalytics = (rows) => {
  const available = rows.reduce((sum, row) => sum + row.availableCopies, 0);
  const borrowed = rows.reduce((sum, row) => sum + row.borrowedCopies, 0);
  const categories = groupSum(rows, 'category');
  return {
    kpis: [
      { label: 'Total Titles', value: rows.length },
      { label: 'Total Copies', value: available + borrowed },
      { label: 'Utilization', value: `${available + borrowed ? ((borrowed / (available + borrowed)) * 100).toFixed(1) : '0.0'}%` },
    ],
    charts: [
      { type: 'doughnut', title: 'Stock Availability Status', labels: ['Available Copies', 'Borrowed Copies'], data: [available, borrowed], colors: ['#10B981', '#F97316'] },
      { type: 'bar', title: 'Inventory by Category', labels: categories.map(([label]) => label), data: categories.map(([, count]) => count), colors: '#2563EB' },
    ],
  };
};

export const buildMasterCatalogAnalytics = (rows) => {
  const categories = groupSum(rows, 'category');
  const growth = groupSum(rows.map((row) => ({ period: String(row.createdAt || '').slice(0, 7) || 'Unknown' })), 'period');
  return {
    kpis: [
      { label: 'Total Titles', value: rows.length },
      { label: 'Total Copies', value: rows.reduce((sum, row) => sum + row.totalCopies, 0) },
      { label: 'Utilization', value: `${rows.reduce((sum, row) => sum + row.totalCopies, 0) ? ((rows.reduce((sum, row) => sum + row.totalCopies - row.availableCopies, 0) / rows.reduce((sum, row) => sum + row.totalCopies, 0)) * 100).toFixed(1) : '0.0'}%` },
    ],
    charts: [
      { type: 'bar', title: 'Category Distribution System-Wide', labels: categories.map(([label]) => label), data: categories.map(([, count]) => count), colors: '#2563EB', horizontal: true },
      { type: 'line', title: 'Catalog Growth Trend', labels: growth.map(([label]) => label), data: growth.map(([, count]) => count), colors: '#0F766E', borderColor: '#0F766E', datasetLabel: 'New Books' },
    ],
  };
};

export const buildAssetAllocationAnalytics = (rows, libraries = []) => {
  const branches = new Map();
  rows.forEach((row) => {
    const key = row.libraryId || 'Unknown';
    const current = branches.get(key) || { copies: 0, borrowed: 0 };
    current.copies += row.totalCopies;
    current.borrowed += row.borrowedCopies;
    branches.set(key, current);
  });
  const entries = [...branches.entries()];
  const labels = entries.map(([id]) => libraryName(libraries, id));
  return {
    kpis: [
      { label: 'Total Titles', value: rows.length },
      { label: 'Total Copies', value: rows.reduce((sum, row) => sum + row.totalCopies, 0) },
      { label: 'Utilization', value: `${rows.reduce((sum, row) => sum + row.totalCopies, 0) ? ((rows.reduce((sum, row) => sum + row.borrowedCopies, 0) / rows.reduce((sum, row) => sum + row.totalCopies, 0)) * 100).toFixed(1) : '0.0'}%` },
    ],
    charts: [
      { type: 'bar', title: 'Total Stock per Branch', labels, data: entries.map(([, value]) => value.copies), colors: '#2563EB' },
      { type: 'bar', title: 'Branch Utilization Rate %', labels, data: entries.map(([, value]) => value.copies ? Number(((value.borrowed / value.copies) * 100).toFixed(2)) : 0), colors: '#F97316' },
    ],
  };
};
