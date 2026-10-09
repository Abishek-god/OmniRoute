import assert from "node:assert/strict";
import test from "node:test";
import {
  SupabaseRestClient,
  SupabaseRestError,
  createSupabaseRestClientFromEnv,
} from "../../../../src/lib/db/postgres/supabaseRestClient";

function makeClient(fetcher: typeof fetch = fetch) {
  return new SupabaseRestClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-server-secret",
    fetcher,
  });
}

test("select sends server credentials and PostgREST query parameters", async () => {
  let receivedUrl = "";
  let receivedInit: RequestInit | undefined;

  const client = makeClient(async (input, init) => {
    receivedUrl = String(input);
    receivedInit = init;
    return new Response(JSON.stringify([{ key: "theme", value: "dark" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const rows = await client.select("key_value", { select: "key,value", namespace: "eq.settings" });
  assert.deepEqual(rows, [{ key: "theme", value: "dark" }]);
  assert.equal(
    receivedUrl,
    "https://example.supabase.co/rest/v1/key_value?select=key%2Cvalue&namespace=eq.settings"
  );

  const headers = new Headers(receivedInit?.headers);
  assert.equal(headers.get("apikey"), "test-server-secret");
  assert.equal(headers.get("authorization"), "Bearer test-server-secret");
  assert.equal(headers.get("accept-profile"), "public");
});

test("upsert requests merge-on-conflict and returns the representation", async () => {
  let receivedInit: RequestInit | undefined;

  const client = makeClient(async (_input, init) => {
    receivedInit = init;
    return new Response(JSON.stringify([{ namespace: "settings", key: "theme" }]), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  });

  const rows = await client.upsert(
    "key_value",
    { namespace: "settings", key: "theme", value: { mode: "dark" } },
    { onConflict: ["namespace", "key"] }
  );

  assert.equal(rows.length, 1);
  assert.equal(
    receivedInit?.headers && new Headers(receivedInit.headers).get("prefer"),
    "resolution=merge-duplicates,return=representation"
  );
  assert.equal(
    receivedInit?.body,
    JSON.stringify({ namespace: "settings", key: "theme", value: { mode: "dark" } })
  );
});

test("update and delete reject unfiltered writes", async () => {
  const client = makeClient(async () => new Response("[]", { status: 200 }));

  await assert.rejects(
    client.update("key_value", { value: "new" }, {}),
    /At least one explicit filter is required/
  );
  await assert.rejects(client.delete("key_value", {}), /At least one explicit filter is required/);
});

test("table and RPC identifiers are validated", async () => {
  const client = makeClient(async () => new Response("[]", { status: 200 }));

  await assert.rejects(client.select("key_value;drop_table"), /Invalid table identifier/);
  await assert.rejects(client.rpc("read_secret()"), /Invalid function identifier/);
});

test("PostgREST errors preserve status and machine-readable code", async () => {
  const client = makeClient(async () =>
    new Response(JSON.stringify({ message: "permission denied", code: "42501" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })
  );

  await assert.rejects(client.select("key_value"), (error: unknown) => {
    assert.ok(error instanceof SupabaseRestError);
    assert.equal(error.status, 403);
    assert.equal(error.code, "42501");
    assert.match(error.message, /permission denied/);
    return true;
  });
});

test("environment factory fails with actionable missing-configuration errors", () => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.throws(createSupabaseRestClientFromEnv, /SUPABASE_URL is required/);

    process.env.SUPABASE_URL = "https://example.supabase.co";
    assert.throws(createSupabaseRestClientFromEnv, /SUPABASE_SERVICE_ROLE_KEY is required/);
  } finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});
