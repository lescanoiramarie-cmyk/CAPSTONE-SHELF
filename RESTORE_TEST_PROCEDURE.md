# SHELF ILMS Backup Recovery and Restore Drill

**Status: NOT VERIFIED.** No production recovery point, backup artifact, or restore drill has been evidenced. Do not run a production backup or restore until the owner separately approves the exact source, target, cost, and procedure.

## Supported recovery-point check

1. In the production Supabase Dashboard, open **Database > Backups**. Record the recovery-point timestamp, type (daily physical backup or PITR), retention window, project plan, and restore scope. Do not trigger an in-place restore.
2. Confirm the selected recovery point predates the incident/release window the owner needs to recover. Review retention and expected data loss with the owner.
3. Supabase's **Restore to a New Project** creates a separate database copy and requires physical backups on a paid plan. Review the displayed cost and target region before confirming. Do not restore over production.

## Separate-project restore drill

1. Obtain explicit owner approval for the new project and its cost. Use a distinct, access-restricted project in the source region. Do not enable public application traffic.
2. Restore the chosen recovery point to that new project through **Database > Backups > Restore to a New Project**. The restore is binary; enabled extensions such as `pg_cron`, `pg_net`, or wrappers may start external work immediately. Identify those jobs before restore and keep the project network-restricted. If these side effects cannot be contained, stop and prepare a separately reviewed logical-restore plan.
3. After restore, compare migration history and catalog evidence with the source report. Verify schema, critical functions, grants, RLS, policies, constraints, indexes, triggers, extensions, and representative aggregate counts. Do not export personal or payment rows.
4. Create fresh synthetic Auth users in the isolated project. Run real Auth/PostgREST, role/AAL, branch isolation, borrowing/return, attendance, notification, and fine-payment tests. Do not reuse production credentials, users, or API keys.
5. Record the project ref and test results without credentials. Keep the clone restricted. The owner decides retention or deletion in the Dashboard after review.

## Recovery scope and limitations

Supabase's current database backup/clone documentation says a restore-to-new-project transfers database schema/data/indexes, database roles and permissions, Auth user records, and the encryption root key. It does **not** copy Storage objects/settings or Edge Functions, and requires manual reconfiguration of Auth settings/API keys, Realtime settings, extensions/settings, and read replicas. Some project settings are copied; verify the actual restored project rather than assuming full configuration parity. This database restore is not a complete application recovery by itself.

Required separate recovery inventory: Storage objects and bucket settings; Edge Function source, configuration and secrets; Auth provider/SMTP/MFA settings; API keys; Realtime settings; extension configuration; Vault/encryption dependencies; scheduled jobs and webhook integrations; and external provider configuration. Keep these materials in their approved secure systems, never in this repository.

Official references: [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups) and [Restore to a New Project](https://supabase.com/docs/guides/platform/clone-project).

## Evidence record

| Gate | Status | Evidence |
|---|---|---|
| Production recovery point available | NOT VERIFIED | Owner Dashboard evidence required |
| Restore target approved and created | NOT STARTED | Owner approval and cost review required |
| Separate-project restore completed | NOT STARTED | No restore was run |
| Restored catalog/data/security verified | NOT STARTED | Depends on the restore drill |
| Application/Auth integration verified against restored project | NOT STARTED | Depends on isolated synthetic test setup |
