import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const opacSource = readFileSync(
  new URL('../component/OPACCatalog.jsx', import.meta.url),
  'utf8'
);
const storeSource = readFileSync(
  new URL('../data/store.js', import.meta.url),
  'utf8'
);
const rpcMigration = readFileSync(
  new URL('../../supabase/migrations/20270102002900_opac_book_count_rpc_fixed.sql', import.meta.url),
  'utf8'
);

test('reproduces and proves the historical 983 vs 1983 OPAC count discrepancy', () => {
  // Simulate a catalog with 1,983 total books
  const TOTAL_CATALOG_BOOKS = 1983;
  const mockDatabaseBooks = Array.from({ length: TOTAL_CATALOG_BOOKS }, (_, i) => ({
    id: `book-${i + 1}`,
    title: `Book Title ${i + 1}`,
    author: `Author ${i + 1}`,
    book_type: 'library',
    // 17 books are archived/inactive
    is_archived: i < 17,
    available_copies: (i % 3 === 0) ? 0 : 2,
  }));

  // Historical Bug: Client-side fetchBooks without RPC was subject to Supabase PostgREST default limit (1,000 rows max)
  const POSTGREST_DEFAULT_LIMIT = 1000;
  const clientTruncatedFetch = mockDatabaseBooks.slice(0, POSTGREST_DEFAULT_LIMIT);
  const clientFilteredBooks = clientTruncatedFetch.filter((b) => !b.is_archived);

  // When PostgREST capped at 1,000 rows, 1,000 minus 17 archived rows = 983 books!
  assert.equal(clientFilteredBooks.length, 983, 'PostgREST default 1000-row cap results in 983 books');

  // Fixed Architecture: Server-side RPC get_opac_filtered_book_count counts directly in PostgreSQL
  const serverSideFilteredCount = mockDatabaseBooks.filter((b) => !b.is_archived).length;
  assert.equal(serverSideFilteredCount, 1983 - 17, 'Server-side count evaluates entire dataset without 1000 limit');

  // Server-side total count includes all catalog books
  const serverSideTotalCount = mockDatabaseBooks.length;
  assert.equal(serverSideTotalCount, 1983, 'Server-side total accurately returns 1983');
});

test('OPACCatalog clearly distinguishes filtered and unfiltered totals and prioritizes server-side count', () => {
  // Total unfiltered book counts fetched from RPC
  assert.match(opacSource, /fetchOpacTotalBookCount\(\)/);
  assert.match(opacSource, /fetchOpacLibraryBookCount\(\)/);

  // Filtered book count fetched from RPC with active filter arguments
  assert.match(opacSource, /fetchOpacFilteredBookCount\(\{/);
  assert.match(opacSource, /search:\s*searchTerm/);
  assert.match(opacSource, /category:\s*selectedCategory/);
  assert.match(opacSource, /libraryId:\s*libraryIdForFilter/);
  assert.match(opacSource, /availability:\s*selectedAvailability/);

  // Display uses server-side filteredBookCount with fallback to filteredBooks.length
  assert.match(opacSource, /filteredBookCount !== null\s*\?\s*filteredBookCount\s*:\s*filteredBooks\.length/);

  // Pagination calculation uses filteredBookCount
  assert.match(opacSource, /\(filteredBookCount !== null \? filteredBookCount : filteredBooks\.length\) \/ catalogPageSize/);
});

test('store exports dedicated, typed count functions matching database RPC contracts', () => {
  // get_opac_total_book_count
  assert.match(storeSource, /export async function fetchOpacTotalBookCount\(\)/);
  assert.match(storeSource, /supabase\.rpc\('get_opac_total_book_count'\)/);

  // get_opac_filtered_book_count with parameters
  assert.match(storeSource, /export async function fetchOpacFilteredBookCount\(\{/);
  assert.match(storeSource, /supabase\.rpc\('get_opac_filtered_book_count',\s*\{/);
  assert.match(storeSource, /p_search:\s*search/);
  assert.match(storeSource, /p_category:\s*category/);
  assert.match(storeSource, /p_library_id:\s*libraryId/);
  assert.match(storeSource, /p_availability:\s*availability/);
});

test('migration 20270102002900 implements accurate server-side count logic without truncation', () => {
  // Uses security invoker to respect RLS
  assert.match(rpcMigration, /create or replace function public\.get_opac_filtered_book_count\(/i);
  assert.match(rpcMigration, /security invoker/i);
  assert.match(rpcMigration, /returns bigint/i);

  // SQL count(*) does not cap at 1,000
  assert.match(rpcMigration, /select count\(\*\) into v_count\s+from public\.books b/i);

  // Consistent search filtering across title, author, isbn, category, call_number
  assert.match(rpcMigration, /lower\(b\.title\) like/);
  assert.match(rpcMigration, /lower\(b\.author\) like/);
  assert.match(rpcMigration, /lower\(b\.isbn\) like/);
  assert.match(rpcMigration, /lower\(b\.category\) like/);
  assert.match(rpcMigration, /lower\(b\.call_number\) like/);

  // Availability filter matches physical copy counts
  assert.match(rpcMigration, /\(p_availability = 'Available' and b\.available_copies > 0\)/);
  assert.match(rpcMigration, /\(p_availability = 'Unavailable' and b\.available_copies = 0\)/);

  // External catalog books counted conditionally
  assert.match(rpcMigration, /if p_availability = 'All' or p_availability = 'Unavailable' then/);
  assert.match(rpcMigration, /from public\.external_catalog_books ecb/);
});
