import test from 'node:test';
import assert from 'node:assert/strict';
import { getMajorActionConfirmation } from './actionConfirmation.js';

function button(label, attributes = {}) {
  return {
    disabled: false,
    textContent: label,
    title: '',
    closest: () => null,
    hasAttribute: (name) => Object.hasOwn(attributes, name),
    getAttribute: (name) => attributes[name] ?? null,
  };
}

test('FAQ suggestions send without triggering transaction confirmation', () => {
  assert.equal(getMajorActionConfirmation(button('How do I request to borrow a book using SHELF?', { 'data-faq-suggestion': '' })), '');
});

test('real borrow and return actions retain their confirmation', () => {
  globalThis.window = { location: { pathname: '/visitor' } };
  try {
    assert.match(getMajorActionConfirmation(button('Request to borrow')), /submit this borrow request/);
    assert.match(getMajorActionConfirmation(button('Confirm return', { 'data-confirm-return': '' })), /confirm this book return/);
  } finally {
    delete globalThis.window;
  }
});
