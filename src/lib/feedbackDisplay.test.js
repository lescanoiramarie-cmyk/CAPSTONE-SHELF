import test from 'node:test';
import assert from 'node:assert/strict';
import { canReplyToFeedback, maskFeedbackName } from './feedbackDisplay.js';

test('feedback author names use the first and last initials', () => {
  assert.equal(maskFeedbackName('Kyle Morcilla'), 'K*** M.');
  assert.equal(maskFeedbackName('  maria   santos  '), 'M*** S.');
  assert.equal(maskFeedbackName('Ana Marie Reyes'), 'A*** R.');
});

test('system-wide feedback is assigned to the super admin in the staff view', () => {
  assert.equal(canReplyToFeedback('superadmin', null), true);
  assert.equal(canReplyToFeedback('superadmin', 'branch-id'), false);
  assert.equal(canReplyToFeedback('subadmin', 'branch-id'), true);
  assert.equal(canReplyToFeedback('subadmin', null), false);
  assert.equal(canReplyToFeedback('visitor', null), false);
});

test('feedback names handle a single word, Unicode and missing names', () => {
  assert.equal(maskFeedbackName('José'), 'J***');
  assert.equal(maskFeedbackName('ñora dela Cruz'), 'Ñ*** C.');
  assert.equal(maskFeedbackName('  '), 'Visitor');
  assert.equal(maskFeedbackName(null), 'Visitor');
});
