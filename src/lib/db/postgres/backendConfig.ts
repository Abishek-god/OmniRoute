/**
 * Opt-in PostgreSQL backend configuration.
 *
 * This is deliberately only a configuration/readiness boundary. OmniRoute's
 * current domain modules consume the synchronous SqliteAdapter API, so this
 * flag must not silently route those callers to a network database before the
 * async repository port is complete.
 */

export type StorageBackend = "sqlite" | "postgres";

export interface StorageBackendConfig {
  backend: StorageBackend;
  databaseUrl?: string;
}

/**
 * Resolve the requested persistence backend.
 *
 * SQLite remains the default for compatibility. PostgreSQL requires both an
 * explicit opt-in and a server-only URL, but is intentionally rejected until
 * the PostgreSQL repository adapter is wired into the application runtime.
 */
export function getStorageBackendConfig(
  env: Record<string, string | undefined> = process.env
): StorageBackendConfig {
  const requested = env.OMNIROUTE_STORAGE_BACKEND?.trim().toLowerCase() || "sqlite";

  if (requested === "sqlite") {
    return { backend: "sqlite" };
  }

  if (requested !== "postgres") {
    throw new Error(
      'Invalid OMNIROUTE_STORAGE_BACKEND; supported values are "sqlite" and "postgres"'
    );
  }

  const databaseUrl = env.OMNIROUTE_DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("OMNIROUTE_DATABASE_URL is required when PostgreSQL is selected");
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("OMNIROUTE_DATABASE_URL must be a valid absolute PostgreSQL URL");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("OMNIROUTE_DATABASE_URL must use postgres:// or postgresql://");
  }

  // Fail closed rather than pretending that configuration alone enables the
  // backend. This guard can be removed only in the commit that connects the
  // fully tested async persistence runtime and migrations.
  throw new Error(
    "PostgreSQL storage is not enabled in this build yet; SQLite remains the active runtime backend"
  );
}
