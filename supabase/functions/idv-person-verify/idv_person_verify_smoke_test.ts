/**
 * Batch V-UI-Fix-4 -- idv-person-verify source-level guard tests (Deno).
 *
 * Mirrors the existing source-level guard pattern used by
 * supabase/functions/idv-verify/o_production_lockout_smoke_test.ts:
 * this function needs a live Supabase instance, an auth context and
 * VerifyNow sandbox credentials to run end-to-end, which is explicitly
 * out of scope for an automated test. These guards instead prove the
 * hardened contract is present in the committed source, with a network
 * fetch tripwire so any accidental live call fails the test hard.
 *
 * Explicit non-goals: no real VerifyNow call, no real Supabase call, no
 * DB write, no secrets required.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ---------------------------------------------------------------------
// Network tripwire -- any real fetch during this test file is a hard
// failure. Nothing here should ever reach the network.
// ---------------------------------------------------------------------
const REAL_FETCH = globalThis.fetch;
function installFetchTripwire(): string[] {
  const calls: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    calls.push(url);
    throw new Error(
      `[batch-v-ui-fix-4-smoke] real fetch attempted (${url}); tests must be pure in-memory`,
    );
  }) as typeof fetch;
  return calls;
}
function restoreFetch() {
  globalThis.fetch = REAL_FETCH;
}

const HERE = new URL(".", import.meta.url).pathname;
const PROJECT_ROOT = HERE.replace(
  /\/supabase\/functions\/idv-person-verify\/?$/,
  "",
);
async function read(rel: string): Promise<string> {
  return await Deno.readTextFile(`${PROJECT_ROOT}/${rel}`);
}

Deno.test("Batch V-UI-Fix-4 -- idv-person-verify imports the VerifyNow adapter", async () => {
  const calls = installFetchTripwire();
  try {
    const src = await read("supabase/functions/idv-person-verify/index.ts");
    assert(
      src.includes('from "../_shared/verifynow/adapter.ts"'),
      "must import the shared VerifyNow adapter",
    );
    assert(src.includes("verifyNowIdv("), "must call verifyNowIdv");
    assertEquals(calls.length, 0);
  } finally {
    restoreFetch();
  }
});

Deno.test("Batch V-UI-Fix-4 -- idv-person-verify never imports the legacy idv-verify function", async () => {
  const src = await read("supabase/functions/idv-person-verify/index.ts");
  assert(
    !/from\s+["']\.\.\/idv-verify/.test(src),
    "idv-person-verify must not import from idv-verify",
  );
});

Deno.test("Batch V-UI-Fix-4 -- idv-person-verify does not reference any legacy/company provider", async () => {
  const src = await read("supabase/functions/idv-person-verify/index.ts");
  const lower = src.toLowerCase();
  const banned = [
    "onfido",
    "cipc",
    "companies_house",
    "dilisense",
    "sanctions.io",
    "sumsub",
    "didit",
    "complycube",
  ];
  for (const b of banned) {
    assert(!lower.includes(b), `must not reference ${b}`);
  }
});

Deno.test("Batch V-UI-Fix-4 -- route resolution happens before any VerifyNow call", async () => {
  const src = await read("supabase/functions/idv-person-verify/index.ts");
  const routeCheckIdx = src.indexOf('routeRes.kind !== "route"');
  const verifyCallIdx = src.indexOf("await verifyNowIdv(");
  assert(routeCheckIdx > 0, "route-not-resolved guard must exist");
  assert(verifyCallIdx > 0, "verifyNowIdv call must exist");
  assert(
    routeCheckIdx < verifyCallIdx,
    "the provider_not_available guard must run BEFORE the VerifyNow call",
  );
});

Deno.test("Batch V-UI-Fix-4 -- authenticates the caller and checks subject ownership", async () => {
  const src = await read("supabase/functions/idv-person-verify/index.ts");
  assert(src.includes("authed.auth.getUser()"), "must authenticate the caller");
  assert(
    src.includes("subj.person_external_ref !== userId"),
    "must verify the subject belongs to the authenticated caller",
  );
});

Deno.test("Batch V-UI-Fix-4 -- records results via p5scr_record_idv, never a raw insert", async () => {
  const src = await read("supabase/functions/idv-person-verify/index.ts");
  assert(
    src.includes('admin.rpc("p5scr_record_idv"'),
    "must call the p5scr_record_idv RPC",
  );
  assert(
    !src.includes('.from("p5scr_idv_records").insert('),
    "must never raw-insert into p5scr_idv_records",
  );
});

Deno.test("Batch V-UI-Fix-4 -- the safe response never includes the raw provider payload", async () => {
  const src = await read("supabase/functions/idv-person-verify/index.ts");
  const returnIdx = src.lastIndexOf("ok: true,");
  assert(returnIdx > 0, "success response block must exist");
  const block = src.slice(returnIdx, returnIdx + 300);
  assert(
    !block.includes("raw_provider_payload"),
    "the user-facing response must not include the raw provider payload",
  );
});

Deno.test("Batch V-UI-Fix-4 -- VERIFYNOW_MODE is never overridden to production here", async () => {
  const src = await read("supabase/functions/idv-person-verify/index.ts");
  assert(
    !src.includes('VERIFYNOW_MODE'),
    "idv-person-verify must not reference VERIFYNOW_MODE directly (adapter-only, sandbox stays sandbox)",
  );
  assert(
    !/mode:\s*["']production["']/.test(src),
    "must never hardcode production mode",
  );
});

Deno.test("Batch V-UI-Fix-4 -- idv-verify (legacy entity/KYB function) remains untouched by this batch", async () => {
  const src = await read("supabase/functions/idv-verify/index.ts");
  // Same allow-list contract as before Fix-4 -- proves this batch did not
  // touch the legacy function's provider dispatch.
  assert(
    /const\s+COMPANY_ALLOWED_PROVIDERS\s*=\s*\[\s*"companies_house"\s*,\s*"cipc"\s*\]\s*as\s+const/.test(
      src,
    ),
    "idv-verify's company allow-list must be unchanged",
  );
  assert(
    /const\s+INDIVIDUAL_ALLOWED_PROVIDERS\s*=\s*\[\s*"onfido"\s*\]\s*as\s+const/.test(
      src,
    ),
    "idv-verify's individual allow-list must be unchanged",
  );
  assert(
    !src.includes("idv-person-verify"),
    "idv-verify must not reference the new idv-person-verify function",
  );
});
