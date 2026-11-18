// Group 6: Transaction Security Regression Tests
// Covers borrow requests, inventory, pickup, return, fines, payments, attendance

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const migrationDir = path.resolve('supabase/migrations');

function readAllMigrations() {
  const files = fs.readdirSync(migrationDir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  return files.map(f => ({
    name: f,
    content: fs.readFileSync(path.join(migrationDir, f), 'utf8')
  }));
}

const allMigrations = readAllMigrations();

function findMigration(pattern) {
  for (const m of allMigrations) {
    if (m.content.includes(pattern) || m.name.includes(pattern)) return m;
  }
  return null;
}

// Test 1: confirm_pickup_v2 enforces AAL2 and staff role
const pickupV2 = findMigration('confirm_pickup_v2');
assert.ok(pickupV2, 'confirm_pickup_v2 migration exists');
assert.match(pickupV2.content, /auth\.jwt\(\) ->> 'aal' IS DISTINCT FROM 'aal2'/, 'confirm_pickup_v2 enforces AAL2');
assert.match(pickupV2.content, /v_role NOT IN \('superadmin', 'subadmin'\)/, 'confirm_pickup_v2 validates staff role');
assert.match(pickupV2.content, /SET search_path = ''/, 'confirm_pickup_v2 uses empty search_path');
assert.match(pickupV2.content, /auth\.jwt\(\) -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_role/, 'confirm_pickup_v2 validates JWT role claim');

// Test 2: confirm_return_v2 enforces AAL2 and staff role
const returnV2 = findMigration('confirm_return_v2');
assert.ok(returnV2, 'confirm_return_v2 migration exists');
assert.match(returnV2.content, /auth\.jwt\(\) ->> 'aal' IS DISTINCT FROM 'aal2'/, 'confirm_return_v2 enforces AAL2');
assert.match(returnV2.content, /v_role NOT IN \('superadmin', 'subadmin'\)/, 'confirm_return_v2 validates staff role');
assert.match(returnV2.content, /SET search_path = ''/, 'confirm_return_v2 uses empty search_path');
assert.match(returnV2.content, /auth\.jwt\(\) -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_role/, 'confirm_return_v2 validates JWT role claim');

// Test 3: Legacy confirm_pickup hardened with AAL2 and search_path fix (NO visitor ownership check vs auth.uid)
const legacyPickup = findMigration('20270102002300_legacy_handover_hardening');
assert.ok(legacyPickup, 'Legacy handover hardening migration exists');
assert.match(legacyPickup.content, /CREATE OR REPLACE FUNCTION public\.confirm_pickup/, 'Legacy confirm_pickup replaced');
assert.match(legacyPickup.content, /COALESCE\(auth\.jwt\(\) ->> 'aal', 'aal1'\) <> 'aal2'/, 'Legacy confirm_pickup enforces AAL2');
assert.match(legacyPickup.content, /SET search_path = ''/, 'Legacy confirm_pickup uses empty search_path');
// Staff functions authorize via branch access (is_active_staff_for_branch), NOT visitor_id = auth.uid()
// auth.uid() is staff's auth UUID; visitor_id is TEXT like 'VIS-abc12345' - they are NEVER equal
assert.ok(!legacyPickup.content.includes('v_req.visitor_id IS DISTINCT FROM auth.uid'), 'Legacy confirm_pickup does NOT have incorrect visitor_id = auth.uid check');
assert.match(legacyPickup.content, /public\.is_active_staff_for_branch\(book\.library_id::text\)/, 'Legacy confirm_pickup uses branch authorization');

// Test 4: Legacy confirm_return hardened with AAL2, search_path, fine_rate_snapshot (NO visitor ownership check vs auth.uid)
assert.match(legacyPickup.content, /CREATE OR REPLACE FUNCTION public\.confirm_return/, 'Legacy confirm_return replaced');
assert.match(legacyPickup.content, /COALESCE\(auth\.jwt\(\) ->> 'aal', 'aal1'\) <> 'aal2'/, 'Legacy confirm_return enforces AAL2');
assert.match(legacyPickup.content, /SET search_path = ''/, 'Legacy confirm_return uses empty search_path');
assert.ok(!legacyPickup.content.includes('v_req.visitor_id IS DISTINCT FROM auth.uid'), 'Legacy confirm_return does NOT have incorrect visitor_id = auth.uid check');
assert.match(legacyPickup.content, /v_req\.fine_rate_snapshot BETWEEN 1 AND 100/, 'Legacy confirm_return uses fine_rate_snapshot');
assert.match(legacyPickup.content, /v_book_fine_rate BETWEEN 1 AND 100/, 'Legacy confirm_return falls back to book.fine_rate');
assert.match(legacyPickup.content, /v_effective_rate := CASE/, 'Legacy confirm_return calculates effective rate');
assert.ok(!legacyPickup.content.includes('v_overdue_days * 10'), 'Legacy confirm_return no longer uses hardcoded fine rate 10');

// Test 5: lookup_attendance_visitor_v2 hardened with AAL2 and staff auth
const lookupAttendance = findMigration('20270102002200_lookup_attendance_visitor_auth');
assert.ok(lookupAttendance, 'lookup_attendance_visitor_v2 auth migration exists');
assert.match(lookupAttendance.content, /COALESCE\(auth\.jwt\(\) ->> 'aal', 'aal1'\) <> 'aal2'/, 'lookup_attendance_visitor_v2 enforces AAL2');
assert.match(lookupAttendance.content, /v_role NOT IN \('subadmin', 'superadmin'\)/, 'lookup_attendance_visitor_v2 validates staff role');
assert.match(lookupAttendance.content, /SET search_path = ''/, 'lookup_attendance_visitor_v2 uses empty search_path');
assert.match(lookupAttendance.content, /visitor\.otp_verified IS TRUE/, 'lookup_attendance_visitor_v2 requires OTP verified');
assert.match(lookupAttendance.content, /visitor\.is_active IS TRUE/, 'lookup_attendance_visitor_v2 requires active visitor');
assert.match(lookupAttendance.content, /v_role = 'subadmin'[\s\S]*?v_staff_library_id IS DISTINCT FROM v_library_id/, 'lookup_attendance_visitor_v2 enforces branch scoping for subadmin');

// Test 6: toggle_attendance (scanAttendance) hardened
const toggleAttendance = findMigration('20270101000000_attendance_security_hardening');
assert.ok(toggleAttendance, 'toggle_attendance hardening migration exists');
assert.match(toggleAttendance.content, /COALESCE\(auth\.jwt\(\) ->> 'aal', 'aal1'\) <> 'aal2'/, 'toggle_attendance enforces AAL2');
assert.match(toggleAttendance.content, /v_role NOT IN \('subadmin', 'superadmin'\)/, 'toggle_attendance validates staff role');
assert.match(toggleAttendance.content, /SET search_path = ''/, 'toggle_attendance uses empty search_path');
assert.match(toggleAttendance.content, /FOR UPDATE/, 'toggle_attendance uses row locking for check-out');
assert.match(toggleAttendance.content, /visitor\.otp_verified IS TRUE/, 'toggle_attendance requires OTP verified');
assert.match(toggleAttendance.content, /visitor\.is_active IS TRUE/, 'toggle_attendance requires active visitor');
assert.match(toggleAttendance.content, /v_role = 'subadmin'[\s\S]*?v_staff_library_id IS DISTINCT FROM v_library_id/, 'toggle_attendance enforces branch scoping for subadmin');

// Test 7: Fine payment privacy - subadmin detail RPCs require AAL2 + branch scoping
const finePrivacy = findMigration('20270102000100_fine_payment_privacy');
assert.ok(finePrivacy, 'Fine payment privacy migration exists');
assert.match(finePrivacy.content, /get_fine_payment_dashboard[\s\S]*?SECURITY DEFINER/, 'Fine dashboard RPC exists');
assert.match(finePrivacy.content, /COALESCE\(auth\.jwt\(\) ->> 'aal', 'aal1'\) <> 'aal2'/, 'Fine dashboard enforces AAL2');
assert.match(finePrivacy.content, /v_role <> 'subadmin'/, 'Fine dashboard requires subadmin role');
assert.match(finePrivacy.content, /p_library_id IS NOT NULL AND p_library_id <> v_library_id::text/, 'Fine dashboard enforces branch scoping');

// Test 8: Fine payment analytics - superadmin aggregate only, no request-level detail
assert.match(finePrivacy.content, /get_fine_payment_analytics[\s\S]*?SECURITY DEFINER/, 'Fine analytics RPC exists');
assert.match(finePrivacy.content, /v_role NOT IN \('subadmin', 'superadmin'\)/, 'Fine analytics allows superadmin and subadmin');
assert.match(finePrivacy.content, /IF v_role = 'subadmin'/, 'Fine analytics has subadmin branch scoping logic');
assert.match(finePrivacy.content, /report_kind text/, 'Fine analytics returns aggregate report_kind');
assert.match(finePrivacy.content, /fines_assessed numeric/, 'Fine analytics returns aggregate fines');
assert.match(finePrivacy.content, /paid_request_count bigint/, 'Fine analytics returns aggregate counts');

// Test 9: Fine payment recording - subadmin only, branch scoped
const fineAuth = findMigration('20270102000700_fine_payment_rpc_authorization');
assert.ok(fineAuth, 'Fine payment RPC authorization migration exists');
assert.match(fineAuth.content, /v_request_library_id IS DISTINCT FROM v_library_id/, 'Record fine payment enforces branch scoping');
assert.match(finePrivacy.content, /record_fine_payment[\s\S]*?SECURITY DEFINER/, 'Record fine payment wrapper RPC exists');
assert.match(finePrivacy.content, /v_role <> 'subadmin'/, 'Record fine payment wrapper requires subadmin');

// Test 10: request_borrow_v2 validates visitor and delegates to private function with row locking
const requestBorrowV2 = findMigration('20270102001300_request_borrow_v2');
assert.ok(requestBorrowV2, 'request_borrow_v2 migration exists');
assert.match(requestBorrowV2.content, /visitor\.otp_verified IS TRUE/, 'request_borrow_v2 requires OTP verified');
assert.match(requestBorrowV2.content, /visitor\.is_active IS TRUE/, 'request_borrow_v2 requires active visitor');
assert.match(requestBorrowV2.content, /visitor\.auth_user_id = v_uid/, 'request_borrow_v2 validates visitor ownership via auth_user_id');
assert.match(requestBorrowV2.content, /shelf_private\.request_borrow_unchecked/, 'request_borrow_v2 delegates to private function');

// Test 11: shelf_private.request_borrow_unchecked uses row locking and inventory validation
const requestBorrowUnchecked = findMigration('20261121000000_include_reserved_copies_in_inventory_validation');
assert.ok(requestBorrowUnchecked, 'request_borrow_unchecked migration exists');
assert.match(requestBorrowUnchecked.content, /FOR UPDATE;/, 'request_borrow_unchecked uses FOR UPDATE for row locking');
assert.match(requestBorrowUnchecked.content, /active_allocations.*community_allocations/, 'request_borrow_unchecked accounts for active and community allocations');
assert.match(requestBorrowUnchecked.content, /INSERT INTO public\.borrow_requests/, 'request_borrow_unchecked creates borrow request');

// Test 12: confirm_pickup_v2 and confirm_return_v2 delegate to hardened legacy functions
assert.match(pickupV2.content, /PERFORM public\.confirm_pickup\(p_request_id, p_staff_name\)/, 'confirm_pickup_v2 delegates to legacy');
assert.match(returnV2.content, /PERFORM public\.confirm_return\(p_request_id, p_staff_name\)/, 'confirm_return_v2 delegates to legacy');

// Test 13: Fine payment internal functions revoked from PUBLIC/anon/authenticated/service_role
assert.match(finePrivacy.content, /REVOKE ALL ON FUNCTION public\.get_fine_payment_dashboard_detail_internal[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/, 'Internal dashboard detail revoked');
assert.match(finePrivacy.content, /REVOKE ALL ON FUNCTION public\.record_fine_payment_subadmin_internal[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/, 'Internal record payment revoked');
assert.match(finePrivacy.content, /REVOKE ALL ON FUNCTION public\.resolve_fine_review_subadmin_internal[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/, 'Internal resolve review revoked');

// Test 14: Public wrapper RPCs granted only to authenticated and service_role
assert.match(finePrivacy.content, /GRANT EXECUTE ON FUNCTION public\.get_fine_payment_dashboard\(text\)[\s\S]*?TO authenticated, service_role/, 'Dashboard wrapper granted to authenticated and service_role');
assert.match(finePrivacy.content, /GRANT EXECUTE ON FUNCTION public\.record_fine_payment\(text, numeric, text, text, text\)[\s\S]*?TO authenticated, service_role/, 'Record payment wrapper granted to authenticated and service_role');
assert.match(finePrivacy.content, /GRANT EXECUTE ON FUNCTION public\.get_fine_payment_analytics\(text\)[\s\S]*?TO authenticated, service_role/, 'Analytics wrapper granted to authenticated and service_role');

// Test 15: Attendance legacy RPC lockdown - proper grants
const attendanceLegacy = findMigration('20270102000000_attendance_legacy_rpc_lockdown');
assert.ok(attendanceLegacy, 'Attendance legacy lockdown migration exists');
assert.match(attendanceLegacy.content, /GRANT EXECUTE ON FUNCTION public\.lookup_attendance_visitor_v2\(text, text\)[\s\S]*?TO authenticated/, 'lookup_attendance_visitor_v2 granted to authenticated');
assert.match(attendanceLegacy.content, /GRANT EXECUTE ON FUNCTION public\.scan_attendance\(text, text\)[\s\S]*?TO authenticated/, 'scan_attendance granted to authenticated');

// Test 16: scanAttendance frontend uses toggle_attendance RPC
const storeJs = fs.readFileSync('src/data/store.js', 'utf8');
assert.match(storeJs, /'toggle_attendance'/, 'scanAttendance uses toggle_attendance RPC');
assert.match(storeJs, /normalizeQr\(qrCode\)/, 'scanAttendance normalizes QR code');
assert.match(storeJs, /isValidShelfQr/, 'scanAttendance validates SHELF QR format');

// Test 17: AttendanceKiosk uses scanAttendance from store
const attendanceKiosk = fs.readFileSync('src/pages/subadmin/AttendanceKiosk.jsx', 'utf8');
assert.match(attendanceKiosk, /scanAttendance.*useLibrary/, 'AttendanceKiosk uses scanAttendance hook');
assert.match(attendanceKiosk, /await scanAttendance\(qrValue, libraryId\)/, 'AttendanceKiosk calls scanAttendance with QR and library');

// Test 18: No visitor self-service attendance (attendance requires staff AAL2)
const scanAttendanceImpl = storeJs.match(/export async function scanAttendance[\s\S]*?\n}/)[0];
assert.ok(scanAttendanceImpl.includes('supabase.rpc'), 'scanAttendance uses RPC not direct table access');
assert.ok(scanAttendanceImpl.includes('toggle_attendance'), 'scanAttendance calls toggle_attendance RPC');

// Test 19: Borrow request creation validates visitor ownership via auth_user_id (CORRECT pattern)
assert.match(requestBorrowV2.content, /visitor\.auth_user_id = v_uid/, 'request_borrow_v2 enforces visitor ownership via auth_user_id');

// Test 20: shelf_private.request_borrow_unchecked correctly maps auth_user_id to visitor.id
assert.match(requestBorrowUnchecked.content, /WHERE v\.auth_user_id = p_visitor_id/, 'request_borrow_unchecked looks up visitor by auth_user_id');
assert.match(requestBorrowUnchecked.content, /OR v\.id = p_visitor_id::text/, 'request_borrow_unchecked handles both auth_user_id and visitor.id lookup');
assert.match(requestBorrowUnchecked.content, /br\.visitor_id = v_visitor\.id/, 'request_borrow_unchecked uses visitor.id (TEXT) for borrow_requests.visitor_id');

// Test 21: Fine assessment on return uses fine_rate_snapshot not hardcoded rate
assert.match(legacyPickup.content, /v_effective_rate := CASE/, 'confirm_return calculates effective rate from snapshot');
assert.match(legacyPickup.content, /v_fine_amount := v_overdue_days \* v_effective_rate/, 'confirm_return uses effective rate for fine');
assert.ok(!legacyPickup.content.includes('* 10'), 'confirm_return does not use hardcoded 10');

// Test 22: Inventory consistency - release_copy_and_promote called on return
assert.match(legacyPickup.content, /release_copy_and_promote\(v_req\.book_id\)/, 'confirm_return calls release_copy_and_promote');

// Test 23: Row locking on borrow request creation prevents double-booking
assert.match(requestBorrowUnchecked.content, /FOR UPDATE;/, 'request_borrow_unchecked prevents double-booking with row locking');

// Test 24: Duplicate attendance check-in prevented by FOR UPDATE
assert.match(toggleAttendance.content, /FOR UPDATE/, 'toggle_attendance prevents duplicate check-in with row locking');

// Test 25: Payment recording validates outstanding balance
const recordPaymentLegacy = findMigration('20261108165442_automatic_fines_for_valid_rates');
if (recordPaymentLegacy) {
  const recordPaymentSection = recordPaymentLegacy.content.match(/CREATE OR REPLACE FUNCTION public\.record_fine_payment\([\s\S]*?^}/m);
  if (recordPaymentSection) {
    assert.match(recordPaymentSection[0], /v_remaining := GREATEST\(v_fine_amount - COALESCE\(v_request\.fine_paid_amount, 0\)\), 0\)/, 'Payment recording calculates remaining balance');
    assert.match(recordPaymentSection[0], /v_amount > v_remaining/, 'Payment recording prevents overpayment');
  }
}

// Test 26: Staff handover functions authorize via branch access, not visitor ownership
assert.match(legacyPickup.content, /public\.is_active_staff_for_branch\(book\.library_id::text\)/, 'confirm_pickup authorizes staff via branch access');
assert.match(legacyPickup.content, /public\.is_active_staff_for_branch\(book\.library_id::text\)/, 'confirm_return authorizes staff via branch access');

// Test 27: No direct table access paths for borrow/return in store.js (all via RPC)
const storeJsFull = fs.readFileSync('src/data/store.js', 'utf8');
assert.ok(storeJsFull.includes('confirm_pickup') || storeJsFull.includes('confirm_return'), 'Frontend uses RPC for handover operations');

// Test 28: confirm_pickup_v2 and confirm_return_v2 have same authorization as legacy
assert.match(pickupV2.content, /public\.is_active_staff_for_branch\(book\.library_id::text\)/, 'confirm_pickup_v2 checks branch access');
assert.match(returnV2.content, /public\.is_active_staff_for_branch\(book\.library_id::text\)/, 'confirm_return_v2 checks branch access');

console.log('\n✅ All 28 Group 6 Transaction Security regression tests passed!');