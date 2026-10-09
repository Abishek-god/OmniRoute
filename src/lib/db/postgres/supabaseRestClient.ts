/**
 * Supabase PostgREST client for server-side PostgreSQL-backed persistence.
 *
 * This module is deliberately separate from the synchronous SqliteAdapter. It
 * is an async building block for phased domain migrations; it is NOT a drop-in
 * replacement for getDbInstance() and must never be imported into client UI.
 *
 * Keep service-role credentials in server-only environment variables.
 */

export type SupabaseRow = Record<string, unknown>;
export type SupabaseQuery = URLSearchParams | Record<string, string>;

export interface SupabaseRestClientOptions {
  /** Supabase project URL, e.g. https://example.supabase.co */
  url: string;
  /** Server-only Supabase service-role key. Never expose this to browser code. */
  serviceRoleKey: string;
  /** PostgREST schema. Defaults to public. */
  schema?: string;
  /** Request timeout in milliseconds. Defaults to 10 seconds. */
  timeoutMs?: number;
  /** Injectable fetch for tests. Defaults to the Node runtime fetch. */
  fetcher?: typeof fetch;
}

export interface SupabaseWriteOptions {
  /** Optional columns that define the conflict target for an upsert. */
  onConflict?: string[];
}

interface PostgrestErrorBody {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
}

export class SupabaseRestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: string;

  constructor(status: number, body: PostgrestErrorBody | null, fallbackText: string) {
    const message = typeof body?.message === "string" ? body.message : fallbackText;
    super(`Supabase REST request failed (${status}): ${message}`);
    this.name = "SupabaseRestError";
    this.status = status;
    this.code = typeof body?.code === "string" ? body.code : undefined;
    this.details = typeof body?.details === "string" ? body.details : undefined;
  }
}

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const DEFAULT_TIMEOUT_MS = 10_000;

function assertIdentifier(value: string, kind: string): void {
  if (!IDENTIFIER.test(value)) {
    throw new TypeError(`Invalid ${kind} identifier: ${value}`);
  }
}

function makeQuery(query?: SupabaseQuery): URLSearchParams {
  if (!query) return new URLSearchParams({ select: "*" });
  return query instanceof URLSearchParams ? new URLSearchParams(query) : new URLSearchParams(query);
}

function parseErrorBody(raw: string): PostgrestErrorBody | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as PostgrestErrorBody;
    }
  } catch {
    // PostgREST usually returns JSON, but a gateway/proxy may return plain text.
  }
  return { message: raw.slice(0, 500) };
}

export class SupabaseRestClient {
  private readonly baseUrl: string;
  private readonly serviceRoleKey: string;
  private readonly schema: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(options: SupabaseRestClientOptions) {
    if (!options.url?.trim()) throw new Error("SUPABASE_URL is required");
    if (!options.serviceRoleKey?.trim()) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(options.url);
    } catch {
      throw new Error("SUPABASE_URL must be a valid absolute URL");
    }

    const isLocalHttp =
      (parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1") &&
      parsedUrl.protocol === "http:";
    if (parsedUrl.protocol !== "https:" && !isLocalHttp) {
      throw new Error("SUPABASE_URL must use HTTPS outside localhost");
    }

    this.baseUrl = parsedUrl.toString().replace(/\/+$/, "");
    this.serviceRoleKey = options.serviceRoleKey;
    this.schema = options.schema ?? "public";
    assertIdentifier(this.schema, "schema");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new Error("timeoutMs must be a positive integer");
    }
    this.fetcher = options.fetcher ?? fetch;
  }

  /** Read rows from a table using PostgREST query syntax, e.g. { select: "*", id: "eq.123" }. */
  async select<T extends SupabaseRow = SupabaseRow>(
    table: string,
    query?: SupabaseQuery
  ): Promise<T[]> {
    return this.request<T[]>(this.tableUrl(table, makeQuery(query)), { method: "GET" });
  }

  async insert<T extends SupabaseRow = SupabaseRow>(
    table: string,
    rows: SupabaseRow | SupabaseRow[]
  ): Promise<T[]> {
    return this.request<T[]>(this.tableUrl(table), {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(rows),
    });
  }

  async upsert<T extends SupabaseRow = SupabaseRow>(
    table: string,
    rows: SupabaseRow | SupabaseRow[],
    options: SupabaseWriteOptions = {}
  ): Promise<T[]> {
    const query = new URLSearchParams();
    if (options.onConflict?.length) {
      for (const column of options.onConflict) assertIdentifier(column, "conflict column");
      query.set("on_conflict", options.onConflict.join(","));
    }
    return this.request<T[]>(this.tableUrl(table, query), {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(rows),
    });
  }

  /** Update is intentionally filter-required to reduce the risk of a table-wide write. */
  async update<T extends SupabaseRow = SupabaseRow>(
    table: string,
    values: SupabaseRow,
    filters: Record<string, string>
  ): Promise<T[]> {
    this.assertFilters(filters);
    return this.request<T[]>(this.tableUrl(table, new URLSearchParams(filters)), {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(values),
    });
  }

  /** Delete is intentionally filter-required to reduce the risk of a table-wide deletion. */
  async delete<T extends SupabaseRow = SupabaseRow>(
    table: string,
    filters: Record<string, string>
  ): Promise<T[]> {
    this.assertFilters(filters);
    return this.request<T[]>(this.tableUrl(table, new URLSearchParams(filters)), {
      method: "DELETE",
      headers: { Prefer: "return=representation" },
    });
  }

  async rpc<T = unknown>(functionName: string, args: Record<string, unknown> = {}): Promise<T> {
    assertIdentifier(functionName, "function");
    return this.request<T>(`${this.baseUrl}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      body: JSON.stringify(args),
    });
  }

  private assertFilters(filters: Record<string, string>): void {
    const entries = Object.entries(filters);
    if (!entries.length) throw new Error("At least one explicit filter is required for this write");
    for (const [key, value] of entries) {
      assertIdentifier(key, "filter column");
      if (!value) throw new Error(`Filter "${key}" must not be empty`);
    }
  }

  private tableUrl(table: string, query?: URLSearchParams): string {
    assertIdentifier(table, "table");
    const suffix = query?.size ? `?${query.toString()}` : "";
    return `${this.baseUrl}/rest/v1/${table}${suffix}`;
  }

  private async request<T>(
    url: string,
    init: RequestInit & { headers?: Record<string, string> }
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("apikey", this.serviceRoleKey);
    headers.set("Authorization", `Bearer ${this.serviceRoleKey}`);
    headers.set("Accept-Profile", this.schema);
    if (init.method === "POST" || init.method === "PATCH" || init.method === "PUT") {
      headers.set("Content-Profile", this.schema);
      headers.set("Content-Type", "application/json");
    }

    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? `request timed out after ${this.timeoutMs}ms`
          : "network request failed";
      throw new Error(`Supabase REST ${message}`, { cause: error });
    }

    const raw = response.status === 204 ? "" : await response.text();
    if (!response.ok) {
      throw new SupabaseRestError(
        response.status,
        parseErrorBody(raw),
        raw.slice(0, 500) || response.statusText || "Unknown error"
      );
    }
    if (!raw) return undefined as T;

    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      throw new Error("Supabase REST returned invalid JSON", { cause: error });
    }
  }
}

/** Build a server-side client from environment variables. Does not cache credentials globally. */
export function createSupabaseRestClientFromEnv(): SupabaseRestClient {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("SUPABASE_URL is required when using the Supabase backend");
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required when using the Supabase backend");
  }
  return new SupabaseRestClient({ url, serviceRoleKey });
}
