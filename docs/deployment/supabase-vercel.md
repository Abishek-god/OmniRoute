# Supabase PostgreSQL on Vercel — current foundation

## Important status

This fork does **not yet** have a complete PostgreSQL storage backend. The existing runtime database interface is synchronous and SQLite-specific. The new `src/lib/db/postgres/supabaseRestClient.ts` is an asynchronous server-side data-access foundation; it does not replace `getDbInstance()`, SQLite migrations, backups, or domain persistence yet.

Do not change the production application to use PostgreSQL until the domain migrations and regression tests are complete. Setting environment variables alone will not migrate any existing data.

## Vercel configuration

In Vercel → Project → Settings → Environment Variables, add these for the server environment where the experimental client will be used:

- `SUPABASE_URL`: the project URL, such as `https://your-project.supabase.co`.
- `SUPABASE_SERVICE_ROLE_KEY`: the server-side service role key from Supabase.

Keep these variables server-only. Do **not** use a `NEXT_PUBLIC_` prefix, expose them to browser components, commit them to the repository, or print them in logs. The service-role key bypasses Row Level Security and must be treated as a highly privileged secret.

The runtime helper reads those variables only when `createSupabaseRestClientFromEnv()` is called. It does not create tables and it does not auto-select PostgreSQL as the OmniRoute runtime database.

## Supabase setup

The client uses Supabase's PostgREST endpoint (`/rest/v1`), which reads and writes PostgreSQL-backed tables. Database schema changes should be applied through reviewed Supabase SQL migrations, not by passing DDL through the REST data API.

Create only the tables required by a domain slice after its schema and data conversion have been reviewed. Do not point the existing SQLite migrations at PostgreSQL: they include SQLite-specific syntax, PRAGMAs, and lifecycle assumptions.

## Example server-only usage

```ts
import { createSupabaseRestClientFromEnv } from "@/lib/db/postgres/supabaseRestClient";

const supabase = createSupabaseRestClientFromEnv();
const rows = await supabase.select("your_table", {
  select: "id,created_at",
  id: "eq.some-id",
});
```

Only call this from server-only modules (API routes, server actions, or backend services). Never import it from a client component.

The helper supports parameterized-by-URL PostgREST filters, inserts, upserts, filtered updates/deletes, RPC calls, request timeouts, and structured errors. It is an HTTP data-access client, not a general SQL connection, and transactions must be implemented through carefully designed Postgres functions/RPCs or a server-side PostgreSQL driver when the domain needs multi-statement atomicity.

## Required migration work before production

1. Define an async backend-neutral persistence contract. Do not attempt to implement asynchronous PostgreSQL as a fake synchronous SQLite adapter.
2. Port one domain at a time and update all callers to await the new operations.
3. Add PostgreSQL schema migrations, migration locking, and import/export from SQLite.
4. Verify encryption and decryptability of existing provider credentials and API keys.
5. Replace SQLite-only health checks, WAL/backup/restore, FTS5, and vector-search paths or mark them unsupported in PostgreSQL mode.
6. Run SQLite regression tests plus PostgreSQL integration tests and a Vercel runtime smoke test.
7. Enable PostgreSQL only after persistent state, streaming, and long-running-process requirements have been validated for the target hosting model.

Vercel's serverless environment is not a drop-in replacement for OmniRoute's persistent Node.js service. Supabase solves durable database storage, not the separate WebSocket, background-worker, filesystem, or long-running-process requirements.
