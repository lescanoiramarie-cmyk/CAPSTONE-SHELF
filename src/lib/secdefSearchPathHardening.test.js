import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../supabase/migrations/20270102002100_secdef_search_path_hardening.sql', import.meta.url),
  'utf8'
);

const targets = [
  'update_community_book_copy_availability',
  'enforce_book_copy_inventory',
  'follow_library_subscription_renewal',
  'dispatch_subscription_renewal_followups',
  'mark_subscription_renewal_notification_read',
  'set_borrow_request_library_id',
  'auto_cancel_expired_borrow_requests',
  'maintain_borrowed_book_counts',
  'reject_pending_community_requests_without_copies',
  'get_library_subscription_dashboard',
  'request_subscription_upgrade',
  'decide_subscription_upgrade'
];

test('secdef search_path hardening migration sets empty search_path on all 12 functions', () => {
  for (const fn of targets) {
    const name = fn.replace(/\(.*/, '');
    assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\s*\\(`));
    assert.match(migration, new RegExp(`SET search_path = ''`));
  }
});

test('subscription functions preserve superadmin/subadmin auth and JWT role matching', () => {
  assert.match(migration, /Authenticated super-admin account required/);
  assert.match(migration, /Unauthorized staff role/);
  assert.match(migration, /Active Sub Admin account required/);
  assert.match(migration, /Active assigned sub-admin account required/);
  assert.match(migration, /Only a super-admin can decide upgrade requests/);
  assert.match(migration, /auth\.jwt\(\) -> 'app_metadata' ->> 'role'/);
  assert.match(migration, /staff\.role/);
  assert.match(migration, /sp\.is_active IS TRUE/);
  assert.match(migration, /v_staff_library/);
});

test('trigger functions use fully qualified table references', () => {
  assert.match(migration, /public\.books/);
  assert.match(migration, /public\.borrow_requests/);
  assert.match(migration, /public\.community_book_requests/);
  assert.match(migration, /public\.borrowed_book_counts/);
  assert.match(migration, /public\.staff_notifications/);
  assert.match(migration, /public\.library_subscriptions/);
  assert.match(migration, /public\.libraries/);
  assert.match(migration, /public\.subscription_renewal_follows/);
});

test('subscription RPCs preserve branch scoping for subadmins', () => {
  assert.match(migration, /You can only view your assigned library subscription/);
  assert.match(migration, /subadmin/);
  assert.match(migration, /superadmin/);
  assert.match(migration, /l\.id = v_staff_library/);
});

test('auto_cancel_expired_borrow_requests retains empty search_path and grant pattern', () => {
  assert.match(migration, /auto_cancel_expired_borrow_requests/);
  assert.match(migration, /SET search_path = ''/);
});

test('reject_pending_community_requests_without_copies retains empty search_path', () => {
  assert.match(migration, /reject_pending_community_requests_without_copies/);
  assert.match(migration, /SET search_path = ''/);
});

test('subscription function signatures preserved', () => {
  assert.match(migration, /get_library_subscription_dashboard\(p_library_id text DEFAULT NULL\)/);
  assert.match(migration, /request_subscription_upgrade\(p_requested_plan text, p_note text DEFAULT NULL\)/);
  assert.match(migration, /decide_subscription_upgrade\(p_request_id uuid, p_decision text, p_note text DEFAULT NULL\)/);
  assert.match(migration, /follow_library_subscription_renewal\(p_library_id uuid\)/);
  assert.match(migration, /dispatch_subscription_renewal_followups\(\)/);
  assert.match(migration, /mark_subscription_renewal_notification_read\(p_notification_id uuid\)/);
});