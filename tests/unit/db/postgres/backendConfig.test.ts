import assert from "node:assert/strict";
import test from "node:test";
import { getStorageBackendConfig } from "../../../../src/lib/db/postgres/backendConfig.ts";

test("SQLite remains the default backend", () => {
  assert.deepEqual(getStorageBackendConfig({}), { backend: "sqlite" });
  assert.deepEqual(getStorageBackendConfig({ OMNIROUTE_STORAGE_BACKEND: "sqlite" }), {
    backend: "sqlite",
  });
});

test("unknown storage backend is rejected", () => {
  assert.throws(
    () => getStorageBackendConfig({ OMNIROUTE_STORAGE_BACKEND: "mysql" }),
    /Invalid OMNIROUTE_STORAGE_BACKEND/
  );
});

test("PostgreSQL requires an explicit database URL", () => {
  assert.throws(
    () => getStorageBackendConfig({ OMNIROUTE_STORAGE_BACKEND: "postgres" }),
    /OMNIROUTE_DATABASE_URL is required/
  );
});

test("PostgreSQL connection string must use a PostgreSQL scheme", () => {
  assert.throws(
    () =>
      getStorageBackendConfig({
        OMNIROUTE_STORAGE_BACKEND: "postgres",
        OMNIROUTE_DATABASE_URL: "https://example.supabase.co",
      }),
    /must use postgres:\/\//
  );
});

test("valid PostgreSQL configuration fails closed until the runtime adapter is integrated", () => {
  assert.throws(
    () =>
      getStorageBackendConfig({
        OMNIROUTE_STORAGE_BACKEND: "postgres",
        OMNIROUTE_DATABASE_URL: "postgresql://user:password@db.example.test:5432/postgres",
      }),
    /not enabled in this build yet/
  );
});
