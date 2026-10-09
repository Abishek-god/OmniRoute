---
title: "Supabase PostgreSQL Migration Plan"
version: 3.8.52
lastUpdated: 2026-10-09
---

# Supabase PostgreSQL backend: migration plan

## Status

Planning document only. The runtime continues to use SQLite. Do not set a PostgreSQL backend environment variable until a compatible implementation has been merged and tested.

## Why this must be staged

The current database contract is synchronous and explicitly SQLite-specific. It exposes prepared statements with synchronous `get/all/run`, `pragma`, synchronous transaction wrappers, WAL checkpointing, and file backup operations. Database initialization also runs SQLite-oriented migrations, integrity checks, health checks, backup/restore, FTS/vector functionality, and recovery logic.

Supabase PostgreSQL is a networked database. Adding a PostgreSQL connection string or swapping the driver without changing callers would break synchronous call sites and SQLite-specific SQL. A safe implementation needs an asynchronous, backend-neutral persistence boundary and clearly scoped SQLite-only services.

## Goals

- Preserve SQLite as the zero-configuration default for local, npm, Electron, and existing deployments.
- Add PostgreSQL as an opt-in backend for Vercel/hosted deployments.
- Keep secrets server-only; never expose the database URL or a secret key to browser bundles.
- Support the durable application state intended to survive serverless invocations: provider connections, provider nodes, API keys, combos, key/value settings, routing state, and usage/audit records, phased by domain.
- Provide a validated, one-way SQLite export/import utility with dry-run reporting, row-count checks, and explicit rollback instructions.
- Have backend contract tests and PostgreSQL integration tests before documenting production support.

## Proposed configuration

Use one documented backend selector and one server-only connection URL:

```env
OMNIROUTE_STORAGE_BACKEND=sqlite
# Set to postgres only after the PostgreSQL backend is implemented and enabled:
# OMNIROUTE_STORAGE_BACKEND=postgres
# OMNIROUTE_DATABASE_URL=postgresql://...
```

These names are proposed for the implementation and are not read by the current runtime.

For Supabase, use a supported PostgreSQL connection method for the target runtime. For serverless execution, evaluate Supabase's transaction/session pooler compatibility and TLS settings; do not commit connection credentials.

## Implementation phases

### Phase 0 — Inventory and design

- Inventory direct SQLite imports, adapter consumers, SQL dialect assumptions, transaction boundaries, and maintenance jobs.
- Mark SQLite-only features: PRAGMA/WAL/VACUUM, SQLite file backup/restore, FTS5, sqlite-vec, and native-driver diagnostics.
- Define async query, execute, transaction, health-check, and migration-lock contracts.
- Keep the implementation disabled by default.

### Phase 1 — Backend contract and tests

- Introduce a backend-neutral async contract without changing existing SQLite behavior.
- Add a SQLite compatibility implementation or façade, preserving current call sites while domains are migrated incrementally.
- Test parameterized queries, transactions/rollback, concurrent access, health checks, and error behavior.

### Phase 2 — PostgreSQL vertical slice

- Add PostgreSQL driver and server-only connection manager with bounded pool settings.
- Add PostgreSQL migrations independent from SQLite SQL files.
- Port a narrow set of durable control-plane tables first (provider connections, provider nodes, API keys, combos, and core settings).
- Define encryption compatibility for stored provider credentials and API keys; do not write plaintext credentials to the database.
- Add integration tests against a real PostgreSQL service.

### Phase 3 — Remaining durable state

- Port routing state, quotas/limits, affinity, usage history, call logs, and other state only after their data ownership and transaction semantics have been reviewed.
- Move startup jobs, scheduled cleanup, and schema migration execution behind explicit single-owner/lock behavior where needed.
- Provide PostgreSQL replacements or explicit exclusions for SQLite-specific search and vector features.

### Phase 4 — Migration tool and operations

- Export SQLite data with a stable snapshot.
- Support `--dry-run`, table/row counts, duplicate detection, credential-preservation checks, and a detailed report.
- Import in transactions per logical group and fail safely on validation errors.
- Document backup, restore, cutover, and rollback.
- Do not automatically delete or mutate the original SQLite file.

### Phase 5 — Vercel readiness

- Validate build and runtime behavior on Vercel.
- Confirm persistent state across separate function invocations and redeployments.
- Separately assess features that require a long-running process, WebSockets, local filesystem writes, workers, or scheduled maintenance. PostgreSQL persistence alone does not make those features serverless-compatible.
- Run lint, unit tests, PostgreSQL integration tests, and a smoke test before enabling the backend.

## Security requirements

- Keep `OMNIROUTE_DATABASE_URL` server-only; never prefix it with `public client-side environment-variable prefix `.
- Use TLS and least-privilege database roles.
- Do not place secrets in logs, migration reports, tests, or repository files.
- Preserve credential encryption semantics and verify encrypt/decrypt round trips during migration.
- Do not expose the Supabase secret key to browsers.
- Add access controls and policy review before using Supabase APIs directly from clients. The preferred application connection is server-side.

## Acceptance criteria

- Existing SQLite installs continue to work without new settings.
- PostgreSQL mode fails fast with a clear message if required configuration or migrations are missing.
- Backend contract tests pass for SQLite and PostgreSQL.
- PostgreSQL integration tests cover transactions, concurrency, reconnects, and migration locking.
- Import/export validation confirms expected row counts and credential decryption compatibility.
- CI proves that the default SQLite build and test suite are not regressed.
- Production support is not advertised until the required domain slices and Vercel runtime requirements are tested.

## Current limitations

This document does not implement a PostgreSQL driver, schemas, migrations, or data conversion. Those need to be developed as code changes with tests; setting the proposed environment variables alone will not switch the database.
