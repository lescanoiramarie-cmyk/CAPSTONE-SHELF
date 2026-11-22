import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { matchesCallNumberSearch, normalizeCallNumber, MAX_CALL_NUMBER_LENGTH } from './callNumber.js';

const storeSource = readFileSync(new URL('../data/store.js', import.meta.url), 'utf8');
const inventorySource = readFileSync(new URL('../component/BookInventory.jsx', import.meta.url), 'utf8');
const migrationSource = readFileSync(
  new URL('../../supabase/migrations/20270102001000_books_call_number.sql', import.meta.url),
  'utf8'
);
const opacSource = readFileSync(new URL('../component/OPACCatalog.jsx', import.meta.url), 'utf8');
const landingSource = readFileSync(new URL('../pages/visitor/LandingPage.jsx', import.meta.url), 'utf8');

test('Call Number normalization trims values, permits blank values, and enforces the database limit', () => {
  assert.equal(normalizeCallNumber(' QA 76.73 .J38 2024 '), 'QA 76.73 .J38 2024');
  assert.equal(normalizeCallNumber('   '), null);
  assert.equal(normalizeCallNumber(null), null);
  assert.throws(() => normalizeCallNumber('x'.repeat(MAX_CALL_NUMBER_LENGTH + 1)), /100 characters/);
  assert.equal(normalizeCallNumber(123), '123');
  assert.equal(normalizeCallNumber(0), '0');
  assert.equal(normalizeCallNumber(12.5), '12.5');
  assert.equal(normalizeCallNumber('007'), '007');
  assert.throws(() => normalizeCallNumber(Number.NaN), /finite number/);
  assert.throws(() => normalizeCallNumber(true), /finite number/);
});

test('OPAC Call Number search is case-insensitive and accepts database and view-model fields', () => {
  assert.equal(matchesCallNumberSearch({ callNumber: 'QA 76.73 .J38' }, 'qa 76'), true);
  assert.equal(matchesCallNumberSearch({ call_number: '004.678' }, '004.'), true);
  assert.equal(matchesCallNumberSearch({ callNumber: 123 }, '123'), true);
  assert.equal(matchesCallNumberSearch({ callNumber: 'QA 76' }, 'Z 999'), false);
  assert.equal(matchesCallNumberSearch({}, ''), true);
});

test('inventory creation, update, display, search, and edit forms carry Call Number', () => {
  assert.match(storeSource, /callNumber:\s*r\.call_number/);
  assert.match(storeSource, /call_number:\s*normalizeCallNumber\(book\?\.callNumber\)/);
  assert.match(storeSource, /dbPatch\.call_number\s*=\s*normalizeCallNumber\(patch\.callNumber\)/);
  assert.match(inventorySource, /callNumber:\s*book\.callNumber\s*\|\|\s*''/);
  assert.match(inventorySource, /value=\{form\.callNumber\}/);
  assert.match(inventorySource, /Call Number:/);
  assert.match(inventorySource, /book\.callNumber\?\.toLowerCase\(\)/);
  assert.match(migrationSource, /ADD COLUMN call_number text/);
  assert.match(migrationSource, /books_call_number_length_check/);
  assert.match(migrationSource, /p_patch \? 'call_number'/);
  assert.match(migrationSource, /update_inventory_book has an unexpected definition/);
  assert.match(storeSource, /row\.call_number = normalizeCallNumber\(row\.call_number \?\? row\.callNumber\)/);
});

test('OPAC reading-list cards and book details render Call Number exactly once each', () => {
  assert.equal((opacSource.match(/Call Number: \{book\.callNumber\}/g) || []).length, 1);
  assert.equal((opacSource.match(/Call Number: \{selectedBook\.callNumber\}/g) || []).length, 1);
});

test('OPAC catalog, community, personal, and reading-list searches include Call Number', () => {
  assert.equal((opacSource.match(/matchesCallNumberSearch\(book,/g) || []).length, 4);
});

test('landing-page OPAC actions disclose the sign-in requirement', () => {
  assert.match(landingSource, /const navigateToProtectedCatalog = \(message\) =>/);
  assert.match(landingSource, /if \(!isAuthenticated\)\s*\{\s*setSignInPromptMessage\(message\);\s*return;/);
  assert.match(landingSource, /Please sign in to access the OPAC Catalog\./);
  assert.match(landingSource, /Browse OPAC/);
});
