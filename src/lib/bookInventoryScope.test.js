import assert from 'node:assert/strict';
import test from 'node:test';

import { getBookInventoryScope } from './bookInventoryScope.js';

const books = [
  { id: 'lemery-book', libraryId: 'lemery' },
  { id: 'lipa-book', library_id: 'lipa' },
  { id: 'unassigned-book', libraryId: null },
];

const libraries = [
  { id: 'lemery', name: 'Lemery Library' },
  { id: 'lipa', name: 'Lipa Library' },
];

test('sub-admin inventory only includes books and branch options for its assignment', () => {
  const scope = getBookInventoryScope(books, libraries, {
    role: 'subadmin',
    libraryId: 'lemery',
  });

  assert.deepEqual(scope.books.map((book) => book.id), ['lemery-book']);
  assert.deepEqual(scope.libraries.map((library) => library.id), ['lemery']);
  assert.equal(scope.assignedLibraryId, 'lemery');
});

test('super-admin inventory remains system-wide', () => {
  const scope = getBookInventoryScope(books, libraries, {
    role: 'superadmin',
  });

  assert.equal(scope.books.length, books.length);
  assert.equal(scope.libraries.length, libraries.length);
});

test('sub-admin with no assigned branch sees no inventory or branch choices', () => {
  const scope = getBookInventoryScope(books, libraries, {
    role: 'subadmin',
  });

  assert.deepEqual(scope.books, []);
  assert.deepEqual(scope.libraries, []);
});