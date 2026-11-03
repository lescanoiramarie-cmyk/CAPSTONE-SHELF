import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getCalendarDaysUntil,
  getDueDateNotificationType,
  getNotificationDateKey,
} from "./notificationDate.js";
import { getFineOverdueDays } from "./fineNotification.js";
import {
  claimNotification,
  releaseNotificationClaim,
  sendWithNotificationClaim,
} from "./notificationClaims.js";

const functionSource = readFileSync(
  new URL("./index.ts", import.meta.url),
  "utf8",
);

function createClaimClient({ failDelete = false, insertError = null, throwInsert = false } = {}) {
  const rows = new Map();
  return {
    rows,
    from(table) {
      return {
        insert(row) {
          if (throwInsert) return Promise.reject(new Error("insert outcome unknown"));
          if (insertError) return Promise.resolve({ error: insertError });
          const key = `${table}:${Object.values(row).slice(0, 1).join(":")}:${row.notification_type}:${row.notification_date}`;
          if (rows.has(key)) {
            return Promise.resolve({ error: { code: "23505" } });
          }
          rows.set(key, { table, row });
          return Promise.resolve({ error: null });
        },
        delete() {
          let filters = {};
          const query = {
            eq(column, value) {
              filters[column] = value;
              return query;
            },
            select() {
              if (failDelete) {
                return Promise.resolve({
                  data: null,
                  error: { message: "cleanup failed" },
                });
              }
              for (const [key, entry] of rows) {
                if (
                  entry.table === table &&
                  Object.entries(filters).every(
                    ([column, value]) => entry.row[column] === value,
                  )
                ) {
                  rows.delete(key);
                  return Promise.resolve({ data: [{ id: "claim" }], error: null });
                }
              }
              return Promise.resolve({ data: [], error: null });
            },
          };
          return query;
        },
      };
    },
  };
}

test("notification due-date boundaries use Manila calendar dates and exact instants", () => {
  const due = new Date("2026-04-12T03:00:00.000Z");
  assert.equal(getDueDateNotificationType(due, new Date(due.getTime() - 1)), "due_today");
  assert.equal(getDueDateNotificationType(due, due), "due_today");
  assert.equal(getDueDateNotificationType(due, new Date(due.getTime() + 1)), "overdue");
  assert.equal(
    getDueDateNotificationType(due, new Date("2026-04-09T03:00:00.000Z")),
    null,
  );
  assert.equal(
    getDueDateNotificationType(due, new Date("2026-04-10T03:00:00.000Z")),
    "due_soon",
  );
  assert.equal(getCalendarDaysUntil(due, new Date("2026-04-10T03:00:00.000Z")), 2);
});

test("fine overdue periods retain elapsed-time rounding", () => {
  const due = new Date("2026-04-12T03:00:00.000Z");
  assert.equal(getFineOverdueDays(due, due), 0);
  assert.equal(getFineOverdueDays(due, new Date(due.getTime() - 1)), 0);
  assert.equal(getFineOverdueDays(due, new Date(due.getTime() + 1)), 1);
  assert.equal(getFineOverdueDays(due, new Date(due.getTime() + 86_400_001)), 2);
});

test("Manila tracking keys stay on the Manila date across UTC rollover", () => {
  assert.equal(getNotificationDateKey(new Date("2026-04-11T15:59:59.999Z")), "2026-04-11");
  assert.equal(getNotificationDateKey(new Date("2026-04-11T16:00:00.000Z")), "2026-04-12");
  assert.equal(
    getNotificationDateKey(new Date("2026-04-12T15:59:59.999Z")),
    "2026-04-12",
  );
});

test("due timestamps at Manila midnight use the explicit Manila calendar day", () => {
  const dueAtManilaMidnight = new Date("2026-04-12T16:00:00.000Z");
  const twoManilaDaysBefore = new Date("2026-04-10T16:00:00.000Z");
  assert.equal(getNotificationDateKey(dueAtManilaMidnight), "2026-04-13");
  assert.equal(getDueDateNotificationType(dueAtManilaMidnight, twoManilaDaysBefore), "due_soon");
  assert.equal(
    getDueDateNotificationType(
      dueAtManilaMidnight,
      new Date("2026-04-12T15:59:59.999Z"),
    ),
    null,
  );
  assert.equal(getDueDateNotificationType(dueAtManilaMidnight, dueAtManilaMidnight), "due_today");
  assert.equal(
    getDueDateNotificationType(
      dueAtManilaMidnight,
      new Date(dueAtManilaMidnight.getTime() + 1),
    ),
    "overdue",
  );
});

test("scheduled and manual paths share Manila tracking-date keys", () => {
  assert.equal(
    (functionSource.match(/notificationDate\s*=\s*getNotificationDateKey\(now\)/g) || []).length,
    2,
  );
  assert.match(functionSource, /notificationDate\s*=\s*getNotificationDateKey\(asOf\)/);
  assert.doesNotMatch(functionSource, /toISOString\(\)\.slice\(0,\s*10\)/);
  assert.match(functionSource, /dueTime\s*>=\s*asOf\.getTime\(\)/);
});

test("all three email paths require an atomic claim before provider submission", () => {
  assert.equal(
    (functionSource.match(/sendWithNotificationClaim\(/g) || []).length,
    3,
  );
  assert.equal((functionSource.match(/claimNotification\(/g) || []).length, 3);
  assert.match(functionSource, /success:\s*failed\s*===\s*0/);
});

test("atomic notification claims allow one concurrent winner", async () => {
  const client = createClaimClient();
  const row = {
    borrow_request_id: "request-1",
    visitor_id: "visitor-1",
    notification_type: "due_today",
    notification_date: "2026-04-12",
  };
  const outcomes = await Promise.all([
    claimNotification(client, "due_date_notifications", row),
    claimNotification(client, "due_date_notifications", row),
  ]);
  assert.deepEqual(outcomes.map(({ status }) => status).sort(), ["claimed", "duplicate"]);
});

test("claim failures fail closed and claim cleanup is checked", async () => {
  const client = createClaimClient();
  const row = {
    community_request_id: "request-2",
    visitor_id: "visitor-1",
    notification_type: "overdue",
    notification_date: "2026-04-12",
  };
  const claimed = await claimNotification(client, "community_due_date_notifications", row);
  assert.equal(claimed.status, "claimed");
  const released = await releaseNotificationClaim(
    client,
    "community_due_date_notifications",
    { community_request_id: row.community_request_id, notification_type: row.notification_type, notification_date: row.notification_date },
  );
  assert.equal(released.released, true);

  const stuckClient = createClaimClient({ failDelete: true });
  await claimNotification(stuckClient, "community_due_date_notifications", row);
  const failedCleanup = await releaseNotificationClaim(
    stuckClient,
    "community_due_date_notifications",
    { community_request_id: row.community_request_id, notification_type: row.notification_type, notification_date: row.notification_date },
  );
  assert.equal(failedCleanup.released, false);
  assert.ok(failedCleanup.error);

  assert.equal(
    (await claimNotification(
      createClaimClient({ insertError: { code: "42501" } }),
      "due_date_notifications",
      { borrow_request_id: "request-3", notification_type: "due_today", notification_date: "2026-04-12" },
    )).status,
    "failed",
  );
  assert.equal(
    (await claimNotification(
      createClaimClient({ throwInsert: true }),
      "due_date_notifications",
      { borrow_request_id: "request-4", notification_type: "due_today", notification_date: "2026-04-12" },
    )).status,
    "unknown",
  );
});

test("confirmed provider rejection releases a claim, while ambiguous and accepted outcomes retain it", async () => {
  const row = {
    borrow_request_id: "request-5",
    visitor_id: "visitor-1",
    notification_type: "overdue",
    notification_date: "2026-04-12",
  };

  const rejectedClient = createClaimClient();
  await claimNotification(rejectedClient, "due_date_notifications", row);
  const rejected = await sendWithNotificationClaim(
    rejectedClient,
    "due_date_notifications",
    { borrow_request_id: row.borrow_request_id, notification_type: row.notification_type, notification_date: row.notification_date },
    async () => ({ ok: false, status: 422 }),
  );
  assert.equal(rejected.status, "rejected");
  assert.equal(rejectedClient.rows.size, 0);

  const ambiguousClient = createClaimClient();
  await claimNotification(ambiguousClient, "due_date_notifications", row);
  const ambiguous = await sendWithNotificationClaim(
    ambiguousClient,
    "due_date_notifications",
    { borrow_request_id: row.borrow_request_id, notification_type: row.notification_type, notification_date: row.notification_date },
    async () => { throw new Error("network timeout"); },
  );
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguousClient.rows.size, 1);

  const serverErrorClient = createClaimClient();
  await claimNotification(serverErrorClient, "due_date_notifications", row);
  const serverError = await sendWithNotificationClaim(
    serverErrorClient,
    "due_date_notifications",
    { borrow_request_id: row.borrow_request_id, notification_type: row.notification_type, notification_date: row.notification_date },
    async () => ({ ok: false, status: 503 }),
  );
  assert.equal(serverError.status, "ambiguous");
  assert.equal(serverErrorClient.rows.size, 1);

  const cleanupFailureClient = createClaimClient({ failDelete: true });
  await claimNotification(cleanupFailureClient, "due_date_notifications", row);
  const cleanupFailure = await sendWithNotificationClaim(
    cleanupFailureClient,
    "due_date_notifications",
    { borrow_request_id: row.borrow_request_id, notification_type: row.notification_type, notification_date: row.notification_date },
    async () => ({ ok: false, status: 422 }),
  );
  assert.equal(cleanupFailure.status, "cleanup_failed");
  assert.equal(cleanupFailureClient.rows.size, 1);

  const acceptedClient = createClaimClient();
  await claimNotification(acceptedClient, "due_date_notifications", row);
  const accepted = await sendWithNotificationClaim(
    acceptedClient,
    "due_date_notifications",
    { borrow_request_id: row.borrow_request_id, notification_type: row.notification_type, notification_date: row.notification_date },
    async () => ({ ok: true, status: 200 }),
  );
  assert.equal(accepted.status, "accepted");
  assert.equal(acceptedClient.rows.size, 1);
});
