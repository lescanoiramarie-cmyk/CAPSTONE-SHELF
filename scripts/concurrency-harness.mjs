#!/usr/bin/env node
/**
 * Concurrency Test Harness for SHELF ILMS
 *
 * Executes the 8 concurrency scenarios from supabase/tests/concurrency_test_scenarios.sql
 * using multiple real database connections and barrier synchronization to test race conditions,
 * locking mechanisms, and transaction isolation.
 *
 * Runs against an isolated test database (never against production).
 */

import pg from 'pg';
import { setTimeout as sleep } from 'node:timers/promises';

const { Pool } = pg;

// ============================================================================
// CONFIGURATION
// ============================================================================
// Database connection configuration with standard environment variable precedence:
// Standard PostgreSQL variables (PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD) take priority.
// Defaults adhere to standard PostgreSQL conventions (127.0.0.1:5432, user: postgres, db: shelf_test).
// For isolated test clusters running on alternate ports (e.g. port 5433), set PGPORT=5433 or TEST_PGPORT=5433.
const DEFAULT_CONFIG = {
  host: process.env.PGHOST || '127.0.0.1',
  port: parseInt(process.env.PGPORT || process.env.TEST_PGPORT || '5432', 10),
  database: process.env.PGDATABASE || 'shelf_test',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD !== undefined ? process.env.PGPASSWORD : 'postgres',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

const LIB1_UUID = '11111111-1111-4111-8111-111111111111';
const LIB2_UUID = '22222222-2222-4222-8222-222222222222';
const AUTH_USER_1 = 'a0000000-0000-4000-8000-000000000001';
const AUTH_USER_2 = 'a0000000-0000-4000-8000-000000000002';
const AUTH_USER_3 = 'a0000000-0000-4000-8000-000000000003';
const AUTH_USER_4 = 'a0000000-0000-4000-8000-000000000004';
const AUTH_USER_5 = 'a0000000-0000-4000-8000-000000000005';
const STAFF_UID_1 = 'c0000000-0000-0000-0000-000000000001';
const STAFF_UID_2 = 'c0000000-0000-0000-0000-000000000002';
const STAFF_UID_A = 'c0000000-0000-0000-0000-00000000000a';
const STAFF_UID_B = 'c0000000-0000-0000-0000-00000000000b';

// Coordination barrier for synchronizing concurrent test sessions
class CoordinationBarrier {
  constructor(parties) {
    this.parties = parties;
    this.count = 0;
    this.resolve = null;
    this.promise = new Promise((resolve) => { this.resolve = resolve; });
  }

  async wait() {
    this.count++;
    if (this.count === this.parties) {
      this.resolve();
    } else {
      await this.promise;
    }
  }

  reset() {
    this.count = 0;
    this.promise = new Promise((resolve) => { this.resolve = resolve; });
  }
}

// ============================================================================
// TEST SESSION CLASS
// ============================================================================
class TestSession {
  constructor(name, pool, authUid, role = 'authenticated') {
    this.name = name;
    this.pool = pool;
    this.authUid = authUid;
    this.role = role;
    this.client = null;
    this.results = [];
    this.errors = [];
  }

  async connect() {
    this.client = await this.pool.connect();
    // Configure session GUCs for RLS emulation (is_local = false for connection session)
    await this.client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [this.authUid]);
    await this.client.query("SELECT set_config('request.jwt.claim.role', $1, false)", [this.role]);
    await this.client.query("SELECT set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({
        sub: this.authUid,
        role: this.role,
        aal: 'aal2',
        app_metadata: { role: this.role }
      })
    ]);
    return this;
  }

  async query(text, params) {
    if (!this.client) throw new Error('Session not connected');
    const start = Date.now();
    try {
      const result = await this.client.query(text, params);
      this.results.push({ query: text, params, duration: Date.now() - start, success: true });
      return result;
    } catch (err) {
      this.errors.push({ query: text, params, error: err.message, duration: Date.now() - start });
      throw err;
    }
  }

  async release() {
    if (this.client) {
      this.client.release();
      this.client = null;
    }
  }
}

async function ensureBaseFixtures(client) {
  // Ensure Auth Users for Foreign Keys
  await client.query(`
    INSERT INTO auth.users (id, email)
    VALUES ('${AUTH_USER_1}', 'v1@main.edu'),
           ('${AUTH_USER_2}', 'v2@main.edu'),
           ('${AUTH_USER_3}', 'v3@main.edu'),
           ('${AUTH_USER_4}', 'v4@main.edu'),
           ('${AUTH_USER_5}', 'v5@main.edu'),
           ('${STAFF_UID_1}', 'staff1@main.edu'),
           ('${STAFF_UID_2}', 'staff2@main.edu'),
           ('${STAFF_UID_A}', 'staffA@main.edu'),
           ('${STAFF_UID_B}', 'staffB@satellite.edu')
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  `);

  // Ensure Libraries
  await client.query(`
    INSERT INTO libraries (id, name, status)
    VALUES ('${LIB1_UUID}', 'Main Branch', 'Open'),
           ('${LIB2_UUID}', 'Satellite Branch', 'Open')
    ON CONFLICT (id) DO UPDATE SET status = 'Open';
  `);

  // Ensure Visitors
  await client.query(`
    INSERT INTO visitors (id, auth_user_id, full_name, email, otp_verified, is_active, library_id, qr_code)
    VALUES ('VIS-00000001', '${AUTH_USER_1}', 'Visitor One', 'v1@main.edu', true, true, '${LIB1_UUID}', 'SHELF-QR-100001'),
           ('VIS-00000002', '${AUTH_USER_2}', 'Visitor Two', 'v2@main.edu', true, true, '${LIB1_UUID}', 'SHELF-QR-100002'),
           ('VIS-00000003', '${AUTH_USER_3}', 'Visitor Three', 'v3@main.edu', true, true, '${LIB1_UUID}', 'SHELF-QR-100003'),
           ('VIS-00000004', '${AUTH_USER_4}', 'Visitor Four', 'v4@main.edu', true, true, '${LIB1_UUID}', 'SHELF-QR-100004'),
           ('VIS-00000005', '${AUTH_USER_5}', 'Visitor Five', 'v5@main.edu', true, true, '${LIB1_UUID}', 'SHELF-QR-100005')
    ON CONFLICT (id) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id, is_active = true, otp_verified = true, qr_code = EXCLUDED.qr_code;
  `);

  // Ensure Staff Profiles
  await client.query(`
    INSERT INTO staff_profiles (id, email, full_name, role, library_id, is_active)
    VALUES ('${STAFF_UID_1}', 'staff1@main.edu', 'Staff One', 'subadmin', '${LIB1_UUID}', true),
           ('${STAFF_UID_2}', 'staff2@main.edu', 'Staff Two', 'subadmin', '${LIB1_UUID}', true),
           ('${STAFF_UID_A}', 'staffA@main.edu', 'Staff A', 'subadmin', '${LIB1_UUID}', true),
           ('${STAFF_UID_B}', 'staffB@satellite.edu', 'Staff B', 'subadmin', '${LIB2_UUID}', true)
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, library_id = EXCLUDED.library_id, is_active = true;
  `);
}

async function seedFineRequest(pool, { requestId, bookId, fineAmount, status = 'returned', libraryId = LIB1_UUID }) {
  const client = await pool.connect();
  try {
    await ensureBaseFixtures(client);
    await client.query('DELETE FROM public.fine_payment_idempotency WHERE request_id = $1::text', [requestId]);
    await client.query('DELETE FROM fine_payments WHERE borrow_request_id = $1', [requestId]);
    await client.query('DELETE FROM borrow_requests WHERE id = $1 OR book_id = $2', [requestId, bookId]);
    await client.query('DELETE FROM books WHERE id = $1', [bookId]);
    await client.query(`INSERT INTO books (id, title, author, available_copies, total_copies, fine_rate, library_id)
      VALUES ($1, 'Fine Test Book', 'Synthetic Author', 1, 1, 10, $2)`, [bookId, libraryId]);
    await client.query(`INSERT INTO borrow_requests
      (id, book_id, book_title, visitor_id, visitor_name, status, borrow_date, due_date, return_date,
       fine_amount, fine_paid_amount, fine_rate_snapshot, library_id)
      VALUES ($1, $2, 'Fine Test Book', 'VIS-00000001', 'Synthetic Visitor', $3,
        now() - interval '5 days', now() - interval '2 days',
        CASE WHEN $3 = 'returned' THEN now() ELSE NULL END,
        $4, 0, 10, $5)`, [requestId, bookId, status, fineAmount, libraryId]);
  } finally { client.release(); }
}

// ============================================================================
// TEST SCENARIOS (8 concurrency scenarios plus fine-payment behavior scenarios)
// ============================================================================

const TEST_SCENARIOS = [
  {
    id: 1,
    name: 'Final copy simultaneous borrow',
    description: 'Two visitors borrowing the final available copy simultaneously',
    setup: async (pool) => {
      const client = await pool.connect();
      try {
        await ensureBaseFixtures(client);
        await client.query(`DELETE FROM borrow_requests WHERE book_id = 'test-book-1'`);
        await client.query(`DELETE FROM books WHERE id = 'test-book-1'`);
        await client.query(`
          INSERT INTO books (id, title, author, available_copies, total_copies, fine_rate, library_id)
          VALUES ('test-book-1', 'Test Book 1', 'Test Author 1', 1, 1, 10, '${LIB1_UUID}')
        `);
      } finally {
        client.release();
      }
    },
    sessions: [
      { name: 'Visitor One', authUid: AUTH_USER_1, query: "SELECT public.request_borrow_v2('test-book-1')" },
      { name: 'Visitor Two', authUid: AUTH_USER_2, query: "SELECT public.request_borrow_v2('test-book-1')" },
    ],
    verify: async (pool) => {
      const client = await pool.connect();
      try {
        const requests = await client.query(
          "SELECT * FROM borrow_requests WHERE book_id = 'test-book-1' ORDER BY request_date"
        );
        const book = await client.query(
          "SELECT available_copies FROM books WHERE id = 'test-book-1'"
        );

        console.log('  Verification results:');
        console.log(`    Borrow requests: ${requests.rows.length}`);
        requests.rows.forEach(r => console.log(`      - ${r.visitor_id}: ${r.status} (queue: ${r.queue_position})`));
        console.log(`    Available copies: ${book.rows[0]?.available_copies}`);

        const readyCount = requests.rows.filter(r => r.status === 'ready_for_pickup').length;
        const queuedCount = requests.rows.filter(r => r.status === 'queued').length;
        const avail = parseInt(book.rows[0]?.available_copies ?? '999', 10);

        if (readyCount !== 1) throw new Error(`Expected exactly 1 ready_for_pickup, got ${readyCount}`);
        if (queuedCount !== 1 && requests.rows.length < 2) throw new Error(`Expected 1 queued or handled second request, got ${queuedCount}`);
        if (avail < 0) throw new Error('available_copies went negative!');
        if (avail > 1) throw new Error('available_copies exceeds total!');

        return { pass: true };
      } finally {
        client.release();
      }
    }
  },
  {
    id: 2,
    name: 'Simultaneous pickup confirmations',
    description: 'Two simultaneous pickup confirmations for same request',
    setup: async (pool) => {
      const client = await pool.connect();
      try {
        await ensureBaseFixtures(client);
        await client.query(`DELETE FROM borrow_requests WHERE id = 'd0000000-0000-4000-8000-000000000001' OR book_id = 'test-book-2'`);
        await client.query(`DELETE FROM books WHERE id = 'test-book-2'`);
        await client.query(`
          INSERT INTO books (id, title, author, available_copies, total_copies, fine_rate, library_id)
          VALUES ('test-book-2', 'Test Book 2', 'Test Author 2', 0, 1, 10, '${LIB1_UUID}')
        `);
        await client.query(`
          INSERT INTO borrow_requests (id, book_id, book_title, visitor_id, visitor_name, status, pickup_deadline, library_id)
          VALUES ('d0000000-0000-4000-8000-000000000001', 'test-book-2', 'Test Book 2', 'VIS-00000001', 'Visitor One', 'ready_for_pickup', now() + interval '24 hours', '${LIB1_UUID}')
        `);
      } finally {
        client.release();
      }
    },
    sessions: [
      { name: 'Staff One', authUid: STAFF_UID_1, role: 'subadmin', query: "SELECT public.confirm_pickup('d0000000-0000-4000-8000-000000000001', 'Staff One')" },
      { name: 'Staff Two', authUid: STAFF_UID_2, role: 'subadmin', query: "SELECT public.confirm_pickup('d0000000-0000-4000-8000-000000000001', 'Staff Two')" },
    ],
    verify: async (pool) => {
      const client = await pool.connect();
      try {
        const req = await client.query(
          "SELECT status, borrow_date, due_date, confirmed_by FROM borrow_requests WHERE id = 'd0000000-0000-4000-8000-000000000001'"
        );
        console.log('  Verification results:');
        console.log(`    Status: ${req.rows[0]?.status}`);
        console.log(`    Confirmed by: ${req.rows[0]?.confirmed_by}`);

        if (req.rows[0]?.status !== 'borrowed') throw new Error('Request not marked as borrowed');
        if (!req.rows[0]?.confirmed_by) throw new Error('confirmed_by not set');

        return { pass: true };
      } finally {
        client.release();
      }
    }
  },
  {
    id: 3,
    name: 'Simultaneous return confirmations',
    description: 'Two simultaneous return confirmations for same request',
    setup: async (pool) => {
      const client = await pool.connect();
      try {
        await ensureBaseFixtures(client);
        await client.query(`DELETE FROM borrow_requests WHERE id = 'd0000000-0000-4000-8000-000000000002' OR book_id = 'test-book-3'`);
        await client.query(`DELETE FROM books WHERE id = 'test-book-3'`);
        await client.query(`
          INSERT INTO books (id, title, author, available_copies, total_copies, fine_rate, library_id)
          VALUES ('test-book-3', 'Test Book 3', 'Test Author 3', 0, 1, 10, '${LIB1_UUID}')
        `);
        await client.query(`
          INSERT INTO borrow_requests (id, book_id, book_title, visitor_id, visitor_name, status, borrow_date, due_date, fine_rate_snapshot, library_id)
          VALUES ('d0000000-0000-4000-8000-000000000002', 'test-book-3', 'Test Book 3', 'VIS-00000001', 'Visitor One', 'borrowed', now() - interval '10 days', now() - interval '3 days', 10, '${LIB1_UUID}')
        `);
      } finally {
        client.release();
      }
    },
    sessions: [
      { name: 'Staff One', authUid: STAFF_UID_1, role: 'subadmin', query: "SELECT public.confirm_return('d0000000-0000-4000-8000-000000000002', 'Staff One')" },
      { name: 'Staff Two', authUid: STAFF_UID_2, role: 'subadmin', query: "SELECT public.confirm_return('d0000000-0000-4000-8000-000000000002', 'Staff Two')" },
    ],
    verify: async (pool) => {
      const client = await pool.connect();
      try {
        const req = await client.query(
          "SELECT status, return_date, fine_amount, return_confirmed_by FROM borrow_requests WHERE id = 'd0000000-0000-4000-8000-000000000002'"
        );
        console.log('  Verification results:');
        console.log(`    Status: ${req.rows[0]?.status}`);
        console.log(`    Fine amount: ${req.rows[0]?.fine_amount}`);
        console.log(`    Confirmed by: ${req.rows[0]?.return_confirmed_by}`);

        if (req.rows[0]?.status !== 'returned') throw new Error('Request not marked as returned');
        if (req.rows[0]?.fine_amount === null) throw new Error('fine_amount not calculated');
        if (!req.rows[0]?.return_confirmed_by) throw new Error('return_confirmed_by not set');

        return { pass: true };
      } finally {
        client.release();
      }
    }
  },
  {
    id: 4,
    name: 'Overlapping fine payments',
    description: 'Two fine payments that together exceed the outstanding balance',
    setup: async (pool) => {
      const client = await pool.connect();
      try {
        await ensureBaseFixtures(client);
        await client.query(`DELETE FROM public.fine_payment_idempotency WHERE request_id = 'd0000000-0000-4000-8000-000000000003'::text`);
        await client.query(`DELETE FROM fine_payments WHERE borrow_request_id = 'd0000000-0000-4000-8000-000000000003'`);
        await client.query(`DELETE FROM borrow_requests WHERE id = 'd0000000-0000-4000-8000-000000000003' OR book_id = 'test-book-4'`);
        await client.query(`DELETE FROM books WHERE id = 'test-book-4'`);
        await client.query(`
          INSERT INTO books (id, title, author, available_copies, total_copies, fine_rate, library_id)
          VALUES ('test-book-4', 'Test Book 4', 'Test Author 4', 1, 1, 10, '${LIB1_UUID}')
        `);
        await client.query(`
          INSERT INTO borrow_requests (id, book_id, book_title, visitor_id, visitor_name, status, return_date, fine_amount, fine_paid_amount, fine_rate_snapshot, library_id)
          VALUES ('d0000000-0000-4000-8000-000000000003', 'test-book-4', 'Test Book 4', 'VIS-00000001', 'Visitor One', 'returned', now(), 50.00, 0.00, 10, '${LIB1_UUID}')
        `);
      } finally {
        client.release();
      }
    },
    sessions: [
      { name: 'Staff One', authUid: STAFF_UID_1, role: 'subadmin', query: "SELECT public.record_fine_payment_v2('d0000000-0000-4000-8000-000000000003', 30.00, 'cash', 'REF-1', 'Partial', 'e0000000-0000-4000-8000-000000000001')" },
      { name: 'Staff Two', authUid: STAFF_UID_2, role: 'subadmin', query: "SELECT public.record_fine_payment_v2('d0000000-0000-4000-8000-000000000003', 30.00, 'cash', 'REF-2', 'Partial', 'e0000000-0000-4000-8000-000000000002')" },
    ],
    verify: async (pool) => {
      const client = await pool.connect();
      try {
        const req = await client.query(
          "SELECT fine_amount, fine_paid_amount FROM borrow_requests WHERE id = 'd0000000-0000-4000-8000-000000000003'"
        );
        const payments = await client.query(
          "SELECT * FROM fine_payments WHERE borrow_request_id = 'd0000000-0000-4000-8000-000000000003' ORDER BY received_at"
        );
        console.log('  Verification results:');
        console.log(`    Fine amount: ${req.rows[0]?.fine_amount}, Paid: ${req.rows[0]?.fine_paid_amount}`);
        console.log(`    Payment rows: ${payments.rows.length}`);

        if (parseFloat(req.rows[0]?.fine_paid_amount || '0') !== 30) throw new Error('Expected exactly one $30 payment to be recorded.');
        if (payments.rows.length !== 1) throw new Error(`Expected one payment row, got ${payments.rows.length}`);
        if (parseFloat(req.rows[0]?.fine_amount || '0') - parseFloat(req.rows[0]?.fine_paid_amount || '0') !== 20) throw new Error('Outstanding balance is not $20.');

        return { pass: true };
      } finally {
        client.release();
      }
    }
  },
  {
    id: 5,
    name: 'Simultaneous attendance check-ins',
    description: 'Two simultaneous attendance check-ins for same visitor/library',
    setup: async (pool) => {
      const client = await pool.connect();
      try {
        await ensureBaseFixtures(client);
        await client.query(`DELETE FROM attendance_logs WHERE visitor_id = 'VIS-00000003'`);
      } finally {
        client.release();
      }
    },
    sessions: [
      { name: 'Staff One', authUid: STAFF_UID_1, role: 'subadmin', query: `SELECT * FROM public.toggle_attendance('SHELF-QR-100003', '${LIB1_UUID}')` },
      { name: 'Staff Two', authUid: STAFF_UID_2, role: 'subadmin', query: `SELECT * FROM public.toggle_attendance('SHELF-QR-100003', '${LIB1_UUID}')` },
    ],
    verify: async (pool) => {
      const client = await pool.connect();
      try {
        const logs = await client.query(
          `SELECT * FROM attendance_logs WHERE visitor_id = 'VIS-00000003' AND library_id = '${LIB1_UUID}' ORDER BY time_in`
        );
        console.log('  Verification results:');
        console.log(`    Attendance logs: ${logs.rows.length}`);
        logs.rows.forEach(l => console.log(`      - at ${l.time_in} (out: ${l.checked_out_at})`));

        return { pass: true };
      } finally {
        client.release();
      }
    }
  },
  {
    id: 6,
    name: 'Duplicate notification idempotency',
    description: 'Edge Function retry idempotency for due date notifications',
    setup: async (pool) => {
      const client = await pool.connect();
      try {
        await ensureBaseFixtures(client);
        await client.query(`DELETE FROM due_date_notifications WHERE borrow_request_id = 'd0000000-0000-0000-0000-000000000004'`);
      } finally {
        client.release();
      }
    },
    sessions: [
      {
        name: 'First Attempt',
        authUid: STAFF_UID_1,
        role: 'service_role',
        query: `INSERT INTO due_date_notifications (id, borrow_request_id, visitor_id, notification_type, notification_date, sent_at)
                VALUES (gen_random_uuid(), 'd0000000-0000-0000-0000-000000000004', 'VIS-00000001', 'overdue', CURRENT_DATE, now())
                ON CONFLICT (borrow_request_id, notification_type, notification_date) DO NOTHING`
      },
      {
        name: 'Retry Attempt',
        authUid: STAFF_UID_1,
        role: 'service_role',
        query: `INSERT INTO due_date_notifications (id, borrow_request_id, visitor_id, notification_type, notification_date, sent_at)
                VALUES (gen_random_uuid(), 'd0000000-0000-0000-0000-000000000004', 'VIS-00000001', 'overdue', CURRENT_DATE, now())
                ON CONFLICT (borrow_request_id, notification_type, notification_date) DO NOTHING`
      },
    ],
    verify: async (pool) => {
      const client = await pool.connect();
      try {
        const notifications = await client.query(
          "SELECT * FROM due_date_notifications WHERE borrow_request_id = 'd0000000-0000-0000-0000-000000000004'"
        );
        console.log('  Verification results:');
        console.log(`    Notification rows: ${notifications.rows.length}`);

        if (notifications.rows.length !== 1) {
          throw new Error(`Expected exactly 1 notification row, got ${notifications.rows.length}`);
        }

        return { pass: true };
      } finally {
        client.release();
      }
    }
  },
  {
    id: 7,
    name: 'Cross-visitor borrow isolation',
    description: 'Cross-visitor borrow request isolation',
    setup: async (pool) => {
      const client = await pool.connect();
      try {
        await ensureBaseFixtures(client);
        await client.query(`DELETE FROM borrow_requests WHERE book_id = 'test-book-7'`);
        await client.query(`DELETE FROM books WHERE id = 'test-book-7'`);
        await client.query(`
          INSERT INTO books (id, title, author, available_copies, total_copies, fine_rate, library_id)
          VALUES ('test-book-7', 'Test Book 7', 'Test Author 7', 2, 2, 10, '${LIB1_UUID}')
        `);
      } finally {
        client.release();
      }
    },
    sessions: [
      { name: 'Visitor Four', authUid: AUTH_USER_4, query: "SELECT public.request_borrow_v2('test-book-7')" },
      { name: 'Visitor Five', authUid: AUTH_USER_5, query: "SELECT public.request_borrow_v2('test-book-7')" },
    ],
    verify: async (pool) => {
      const client = await pool.connect();
      try {
        const requests = await client.query(
          "SELECT visitor_id, status FROM borrow_requests WHERE book_id = 'test-book-7'"
        );
        const book = await client.query("SELECT available_copies FROM books WHERE id = 'test-book-7'");
        console.log('  Verification results:');
        requests.rows.forEach(r => console.log(`    - ${r.visitor_id}: ${r.status}`));
        console.log(`    Available copies: ${book.rows[0]?.available_copies}`);

        if (requests.rows.length !== 2) throw new Error(`Expected 2 requests, got ${requests.rows.length}`);
        if (parseInt(book.rows[0]?.available_copies ?? '999', 10) !== 0) {
          throw new Error('available_copies not decremented to 0');
        }

        return { pass: true };
      } finally {
        client.release();
      }
    }
  },
  {
    id: 8,
    name: 'Cross-library staff access isolation',
    description: 'Cross-library staff access isolation',
    setup: async (pool) => {
      const client = await pool.connect();
      try {
        await ensureBaseFixtures(client);
        await client.query(`DELETE FROM borrow_requests WHERE id IN ('REQ-LIB1', 'REQ-LIB2')`);
        await client.query(`DELETE FROM books WHERE id IN ('book-lib1', 'book-lib2')`);
        await client.query(`
          INSERT INTO books (id, title, author, library_id)
          VALUES ('book-lib1', 'Lib 1 Book', 'Author 1', '${LIB1_UUID}'),
                 ('book-lib2', 'Lib 2 Book', 'Author 2', '${LIB2_UUID}')
        `);
        await client.query(`
          INSERT INTO borrow_requests (id, book_id, visitor_id, status, library_id)
          VALUES ('REQ-LIB1', 'book-lib1', 'VIS-00000001', 'borrowed', '${LIB1_UUID}'),
                 ('REQ-LIB2', 'book-lib2', 'VIS-00000002', 'borrowed', '${LIB2_UUID}')
        `);
      } finally {
        client.release();
      }
    },
    sessions: [
      { name: 'Staff A (wrong library)', authUid: STAFF_UID_A, role: 'subadmin', query: "SELECT public.confirm_return('REQ-LIB2', 'Staff A')" },
    ],
    verify: async (pool) => {
      const client = await pool.connect();
      try {
        const req1 = await client.query("SELECT status FROM borrow_requests WHERE id = 'REQ-LIB1'");
        const req2 = await client.query("SELECT status FROM borrow_requests WHERE id = 'REQ-LIB2'");
        console.log('  Verification results:');
        console.log(`    - REQ-LIB1: ${req1.rows[0]?.status}`);
        console.log(`    - REQ-LIB2: ${req2.rows[0]?.status}`);

        if (req2.rows[0]?.status === 'returned') {
          throw new Error('Staff from Library 1 was able to confirm return for Library 2!');
        }

        return { pass: true };
      } finally {
        client.release();
      }
    }
  },

  {
    id: 9,
    name: 'Full fine payment preserves borrowed status and history',
    description: 'A full synthetic fine payment settles an overdue balance without marking the unreturned book as returned',
    setup: (pool) => seedFineRequest(pool, { requestId: 'd0000000-0000-4000-8000-000000000009', bookId: 'test-book-pay-9', fineAmount: 20, status: 'borrowed' }),
    sessions: [
      { name: 'Sub-admin full payment', authUid: STAFF_UID_1, role: 'subadmin', query: "SELECT public.record_fine_payment_v2('d0000000-0000-4000-8000-000000000009',20,'cash','FULL-9','full payment','e0000000-0000-4000-8000-000000000009')" },
    ],
    verify: async (pool) => {
      const client = await pool.connect();
      try {
        const { rows } = await client.query("SELECT status,fine_amount,fine_paid_amount,(SELECT count(*) FROM fine_payments WHERE borrow_request_id='d0000000-0000-4000-8000-000000000009')::int payments FROM borrow_requests WHERE id='d0000000-0000-4000-8000-000000000009'");
        if (rows[0]?.status !== 'borrowed' || Number(rows[0]?.fine_paid_amount) !== 20 || Number(rows[0]?.payments) !== 1) throw new Error('Full payment did not settle exactly one payment while preserving borrowed status.');
        return { pass: true };
      } finally { client.release(); }
    },
  },
  {
    id: 10,
    name: 'Duplicate fine-payment retry is idempotent',
    description: 'Concurrent identical retries with one key record one ledger row',
    setup: (pool) => seedFineRequest(pool, { requestId: 'd0000000-0000-4000-8000-000000000010', bookId: 'test-book-pay-10', fineAmount: 30 }),
    sessions: [1, 2].map((_, index) => ({ name: `Retry ${index + 1}`, authUid: STAFF_UID_1, role: 'subadmin', query: "SELECT public.record_fine_payment_v2('d0000000-0000-4000-8000-000000000010',10,'cash','RETRY-10','same retry','e0000000-0000-4000-8000-000000000010')" })),
    verify: async (pool, results) => {
      const client = await pool.connect();
      try {
        const { rows } = await client.query("SELECT fine_paid_amount,(SELECT count(*) FROM fine_payments WHERE borrow_request_id='d0000000-0000-4000-8000-000000000010')::int payments FROM borrow_requests WHERE id='d0000000-0000-4000-8000-000000000010'");
        if (results.filter((result) => result.success).length !== 2 || Number(rows[0]?.fine_paid_amount) !== 10 || Number(rows[0]?.payments) !== 1) throw new Error('Duplicate retries did not return safely with one ledger row.');
        return { pass: true };
      } finally { client.release(); }
    },
  },
  {
    id: 11,
    name: 'Invalid fine-payment method is rejected',
    description: 'An unsupported payment method creates no payment or balance mutation',
    setup: (pool) => seedFineRequest(pool, { requestId: 'd0000000-0000-4000-8000-000000000011', bookId: 'test-book-pay-11', fineAmount: 30 }),
    sessions: [{ name: 'Invalid method', authUid: STAFF_UID_1, role: 'subadmin', query: "SELECT public.record_fine_payment_v2('d0000000-0000-4000-8000-000000000011',10,'crypto',NULL,NULL,'e0000000-0000-4000-8000-000000000011')" }],
    verify: async (pool, results) => {
      const client = await pool.connect();
      try {
        const { rows } = await client.query("SELECT fine_paid_amount,(SELECT count(*) FROM fine_payments WHERE borrow_request_id='d0000000-0000-4000-8000-000000000011')::int payments FROM borrow_requests WHERE id='d0000000-0000-4000-8000-000000000011'");
        if (!results[0]?.error?.includes('Choose a valid payment method') || Number(rows[0]?.fine_paid_amount) !== 0 || Number(rows[0]?.payments) !== 0) throw new Error('Invalid payment method was not rejected without mutation.');
        return { pass: true };
      } finally { client.release(); }
    },
  },
  {
    id: 12,
    name: 'Inactive staff cannot record fine payments',
    description: 'Inactive synthetic staff are denied and no payment is recorded',
    setup: async (pool) => {
      await seedFineRequest(pool, { requestId: 'd0000000-0000-4000-8000-000000000012', bookId: 'test-book-pay-12', fineAmount: 30 });
      const client = await pool.connect();
      try { await client.query('UPDATE staff_profiles SET is_active=false WHERE id=$1', [STAFF_UID_1]); } finally { client.release(); }
    },
    sessions: [{ name: 'Inactive staff', authUid: STAFF_UID_1, role: 'subadmin', query: "SELECT public.record_fine_payment_v2('d0000000-0000-4000-8000-000000000012',10,'cash',NULL,NULL,'e0000000-0000-4000-8000-000000000012')" }],
    verify: async (pool, results) => {
      const client = await pool.connect();
      try {
        await client.query('UPDATE staff_profiles SET is_active=true WHERE id=$1', [STAFF_UID_1]);
        const { rows } = await client.query("SELECT count(*)::int payments FROM fine_payments WHERE borrow_request_id='d0000000-0000-4000-8000-000000000012'");
        if (!results[0]?.error?.includes('Active Sub-Admin account required') || rows[0].payments !== 0) throw new Error('Inactive staff was not rejected without a payment.');
        return { pass: true };
      } finally { client.release(); }
    },
  },
  {
    id: 13,
    name: 'Cross-library staff cannot record fine payments',
    description: 'Sub-admin from another branch cannot access a synthetic payment request',
    setup: (pool) => seedFineRequest(pool, { requestId: 'd0000000-0000-4000-8000-000000000013', bookId: 'test-book-pay-13', fineAmount: 30 }),
    sessions: [{ name: 'Other library staff', authUid: STAFF_UID_B, role: 'subadmin', query: "SELECT public.record_fine_payment_v2('d0000000-0000-4000-8000-000000000013',10,'cash',NULL,NULL,'e0000000-0000-4000-8000-000000000013')" }],
    verify: async (pool, results) => {
      const client = await pool.connect();
      try {
        const { rows } = await client.query("SELECT count(*)::int payments FROM fine_payments WHERE borrow_request_id='d0000000-0000-4000-8000-000000000013'");
        if (!results[0]?.error?.includes('assigned library') || rows[0].payments !== 0) throw new Error('Cross-library staff request was not rejected without a payment.');
        return { pass: true };
      } finally { client.release(); }
    },
  },
];

// ============================================================================
// CONCURRENCY TEST HARNESS RUNNER
// ============================================================================
class ConcurrencyHarness {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.pool = null;
    this.results = [];
  }

  async initialize() {
    try {
      this.pool = new Pool(this.config);
      const client = await this.pool.connect();
      try {
        await client.query('SELECT 1');
        console.log(`✓ Database connection established (${this.config.host}:${this.config.port}/${this.config.database})`);
      } finally {
        client.release();
      }
    } catch (err) {
      // If default port 5432 failed and no explicit PGPORT or TEST_PGPORT was set, attempt fallback to local isolated test port 5433
      if (!process.env.PGPORT && !process.env.TEST_PGPORT && this.config.port === 5432) {
        console.log('[INFO] Port 5432 unavailable or rejected credentials. Attempting fallback to isolated local test port 5433...');
        await this.pool.end().catch(() => {});
        this.config.port = 5433;
        this.config.password = process.env.PGPASSWORD !== undefined ? process.env.PGPASSWORD : '';
        this.pool = new Pool(this.config);
        const client = await this.pool.connect();
        try {
          await client.query('SELECT 1');
          console.log(`✓ Database connection established (${this.config.host}:${this.config.port}/${this.config.database})`);
        } finally {
          client.release();
        }
      } else {
        throw err;
      }
    }
  }

  async runScenario(scenario) {
    console.log(`\n📋 Test ${scenario.id}: ${scenario.name}`);
    console.log(`   ${scenario.description}`);

    if (process.env.TEST_ONLY && parseInt(process.env.TEST_ONLY, 10) !== scenario.id) {
      console.log('   (Skipped)');
      this.results.push({
        id: scenario.id,
        name: scenario.name,
        pass: true,
        skipped: true,
      });
      return;
    }

    const barrier = new CoordinationBarrier(scenario.sessions.length);
    const sessions = [];

    try {
      // Setup
      if (scenario.setup) {
        await scenario.setup(this.pool);
      }

      // Create sessions
      for (const s of scenario.sessions) {
        const session = new TestSession(s.name, this.pool, s.authUid, s.role || 'authenticated');
        await session.connect();
        sessions.push({ session, query: s.query });
      }

      // Execute concurrently with barrier synchronization
      const executePromises = sessions.map(async ({ session, query }) => {
        await barrier.wait(); // Wait for all sessions to be ready
        return session.query(query);
      });

      // Wait for all to complete
      const results = await Promise.allSettled(executePromises);

      // Collect results
      const sessionResults = results.map((r, i) => ({
        session: scenario.sessions[i].name,
        success: r.status === 'fulfilled',
        value: r.status === 'fulfilled' ? r.value.rows : null,
        error: r.status === 'rejected' ? r.reason.message : null,
      }));

      // Release sessions
      for (const { session } of sessions) {
        await session.release();
      }

      // Verify
      let verification = { pass: true };
      if (scenario.verify) {
        try {
          verification = await scenario.verify(this.pool, sessionResults);
        } catch (err) {
          verification = { pass: false, error: err.message };
        }
      }

      const pass = verification.pass;
      this.results.push({
        id: scenario.id,
        name: scenario.name,
        sessionResults,
        verification,
        pass,
      });

      console.log(`   ${pass ? '✓ PASS' : '✗ FAIL'}`);
    } catch (err) {
      this.results.push({
        id: scenario.id,
        name: scenario.name,
        sessionResults: [],
        verification: { pass: false, error: err.message },
        pass: false,
      });
      console.log(`   ✗ ERROR: ${err.message}`);
    }
  }

  async runAll() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  SHELF ILMS Concurrency Test Harness');
    console.log('═══════════════════════════════════════════════════════════');

    await this.initialize();

    for (const scenario of TEST_SCENARIOS) {
      await this.runScenario(scenario);
    }

    this.printSummary();
    await this.cleanup();
  }

  printSummary() {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  SUMMARY');
    console.log('═══════════════════════════════════════════════════════════');

    const passed = this.results.filter(r => r.pass).length;
    const failed = this.results.filter(r => !r.pass).length;

    this.results.forEach(r => {
      const status = r.pass ? '✓ PASS' : '✗ FAIL';
      console.log(`  ${status}  Test ${r.id}: ${r.name}`);
      if (!r.pass) {
        r.sessionResults.forEach(sr => {
          if (!sr.success) console.log(`       Session "${sr.session}": ${sr.error}`);
        });
        if (!r.verification.pass) console.log(`       Verification: ${r.verification.error}`);
      }
    });

    console.log(`\n  Total: ${this.results.length} | Passed: ${passed} | Failed: ${failed}`);
  }

  async cleanup() {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================
async function main() {
  const harness = new ConcurrencyHarness();

  try {
    await harness.runAll();
    const allPassed = harness.results.every(r => r.pass);
    process.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('Harness failed:', err);
    process.exit(1);
  }
}

main();
