// Phase 2b — End-to-end proof for /match-challenges/upload-evidence
// =================================================================
//
// One-shot orchestration harness. Provisions ephemeral fixtures
// (orgs, users, match, open challenge), runs the 10 required tests
// against the DEPLOYED match-challenges edge function, and tears
// everything down on the way out.
//
// Invocation: POST { "confirm": "RUN_PHASE2B_E2E" }
// Auth: platform_admin only (verified via has_role).
//
// Returns a structured PASS/FAIL report. Idempotent enough — every
// fixture is namespaced with a fresh run_id so concurrent runs
// don't collide.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders as __buildCorsHeaders, handleCors as __handleCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

type TestRecord = {
  id: string;
  description: string;
  route: string;
  account_role: string;
  expected: string;
  observed: string;
  pass: boolean;
  details?: unknown;
};

const PASSWORD = "Phase2bE2E!Test#" + crypto.randomUUID().slice(0, 8);

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function signIn(email: string, password: string): Promise<string | null> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.access_token ?? null;
}

async function callUploadEvidence(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/match-challenges/upload-evidence`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  let j: any = null;
  try { j = await r.json(); } catch { /* ignore */ }
  return { status: r.status, body: j };
}

Deno.serve(async (req) => {
  const baseHeaders = { ...__buildCorsHeaders(Deno.env.get("ALLOWED_ORIGINS") || "", req.headers.get("origin")), "Content-Type": "application/json" };
  const __pf = __handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (__pf) return __pf;
  if (req.method === "OPTIONS") return new Response(null, { headers: baseHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: baseHeaders });
  }

  // Caller must be platform_admin OR present a valid INTERNAL_CRON_KEY.
  const internalKey = Deno.env.get("INTERNAL_CRON_KEY") ?? "";
  const presented = req.headers.get("x-internal-key") ?? "";
  const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE);
  let authorized = false;
  if (internalKey && presented && presented === internalKey) {
    authorized = true;
  } else {
    const authz = req.headers.get("authorization");
    if (authz?.startsWith("Bearer ")) {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authz } } });
      const { data: u } = await userClient.auth.getUser();
      if (u?.user) {
        const { data: isAdminCaller } = await admin.rpc("is_admin", { user_id: u.user.id });
        if (isAdminCaller) authorized = true;
      }
    }
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "FORBIDDEN", message: "platform_admin or INTERNAL_CRON_KEY required" }), { status: 403, headers: baseHeaders });
  }

  let payload: any;
  try { payload = await req.json(); } catch { payload = {}; }
  if (payload?.confirm !== "RUN_PHASE2B_E2E") {
    return new Response(JSON.stringify({ error: "CONFIRM_REQUIRED", hint: "POST { confirm: 'RUN_PHASE2B_E2E' }" }), { status: 400, headers: baseHeaders });
  }

  const runId = crypto.randomUUID();
  const tag = `phase2b_${runId.slice(0, 8)}`;
  const tests: TestRecord[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];

  const record = (t: TestRecord) => { tests.push(t); };

  try {
    // ─── Setup ────────────────────────────────────────────────
    // 3 orgs
    const { data: orgA } = await admin.from("organizations").insert({ name: `${tag}_orgA_buyer` }).select("id").single();
    const { data: orgB } = await admin.from("organizations").insert({ name: `${tag}_orgB_seller` }).select("id").single();
    const { data: orgC } = await admin.from("organizations").insert({ name: `${tag}_orgC_unrelated` }).select("id").single();
    cleanup.push(() => admin.from("organizations").delete().in("id", [orgA!.id, orgB!.id, orgC!.id]));

    // Users
    type U = { id: string; email: string; token: string };
    const mkUser = async (label: string, orgId: string | null, role: string | null): Promise<U> => {
      const email = `${tag}_${label}@phase2b.test.invalid`;
      const { data: created, error } = await admin.auth.admin.createUser({
        email, password: PASSWORD, email_confirm: true,
      });
      if (error || !created.user) throw new Error(`createUser ${label}: ${error?.message}`);
      const uid = created.user.id;
      cleanup.push(() => admin.auth.admin.deleteUser(uid));

      // The on_auth_user_created → _provision_user trigger has just (a) created
      // a brand-new "New Organisation", (b) inserted a profile pointing at it,
      // and (c) granted this user `org_admin` of that auto-org. We must strip
      // the auto-granted roles AND the auto-org, otherwise our explicit role
      // assignment is contaminated by leftover org_admin grants.
      const { data: priorProfile } = await admin
        .from("profiles").select("org_id").eq("id", uid).maybeSingle();
      const autoOrgId = priorProfile?.org_id ?? null;
      // Wipe ALL auto-granted roles for this fresh user.
      await admin.from("user_roles").delete().eq("user_id", uid);
      // Re-pin profile to the intended org.
      await admin.from("profiles").upsert({ id: uid, org_id: orgId, full_name: label, email });
      cleanup.push(() => admin.from("profiles").delete().eq("id", uid));
      // Drop the orphan auto-org if it still exists and isn't one of our fixture orgs.
      if (autoOrgId && autoOrgId !== orgId && autoOrgId !== orgA!.id && autoOrgId !== orgB!.id && autoOrgId !== orgC!.id) {
        await admin.from("organizations").delete().eq("id", autoOrgId);
      }
      // Now assign exactly the role we want.
      if (role) {
        await admin.from("user_roles").insert({ user_id: uid, role });
      }

      // Sign in
      const token = await signIn(email, PASSWORD);
      if (!token) throw new Error(`signIn ${label} failed`);
      return { id: uid, email, token };
    };

    const userA = await mkUser("buyerAdmin", orgA!.id, "org_admin");      // party (buyer side)
    const userB = await mkUser("sellerAdmin", orgB!.id, "org_admin");     // party (seller side)
    const userM = await mkUser("orgMember", orgA!.id, "org_member");      // ordinary member of buyer org
    const userU = await mkUser("unrelatedAdmin", orgC!.id, "org_admin"); // unrelated org admin
    const userP = await mkUser("platformAdmin", null, "platform_admin");  // platform admin

    // Match
    const { data: match, error: mErr } = await admin.from("matches").insert({
      buyer_org_id: orgA!.id,
      seller_org_id: orgB!.id,
      org_id: orgA!.id,
      buyer_id: `${tag}_buyer`,
      seller_id: `${tag}_seller`,
      buyer_name: `${tag} buyer`,
      seller_name: `${tag} seller`,
      commodity: "TEST_PHASE2B",
      quantity_amount: 1, quantity_unit: "MT",
      price_amount: 1, price_currency: "USD",
      terms: "TEST", state: "discovery", status: "matched",
      hash: `phase2b_${runId}`,
    }).select("id").single();
    if (mErr) throw new Error("create match: " + mErr.message);
    cleanup.push(() => admin.from("matches").delete().eq("id", match!.id));

    // Open challenge raised by userA (buyer admin)
    const { data: chOpen, error: cErr } = await admin.from("match_challenges").insert({
      match_id: match!.id,
      org_id: orgA!.id,
      raised_by_org_id: orgA!.id,
      raised_by_user_id: userA.id,
      raised_by_role: "buyer_org_admin",
      subject_code: "terms_disagreement",
      summary: `Phase 2b live proof challenge ${tag}`,
      status: "open",
    }).select("id, match_id, status").single();
    if (cErr) throw new Error("create challenge: " + cErr.message);
    cleanup.push(async () => {
      await admin.from("match_challenge_evidence").delete().eq("challenge_id", chOpen!.id);
      await admin.from("match_challenges").delete().eq("id", chOpen!.id);
    });
    cleanup.push(async () => {
      // best-effort wipe of any storage objects under this challenge
      const prefix = `${match!.id}/${chOpen!.id}/`;
      const { data: list } = await admin.storage.from("match-challenge-evidence").list(prefix);
      if (list?.length) {
        await admin.storage.from("match-challenge-evidence").remove(list.map((o) => prefix + o.name));
      }
    });

    // helper for sample file
    const makeFile = async (label: string) => {
      const bytes = new TextEncoder().encode(`hello-phase2b-${label}-${runId}`);
      return { bytes, sha: await sha256Hex(bytes) };
    };

    // Smoke probe: verify userA.token is recognised by GoTrue from inside this fn.
    {
      const probe = createClient(SUPABASE_URL, ANON_KEY);
      const { data: pu, error: pe } = await probe.auth.getUser(userA.token);
      record({
        id: "T0", description: "Smoke: userA token validates against GoTrue (auth.getUser(jwt))",
        route: "auth.getUser(jwt)", account_role: "buyer_org_admin",
        expected: "user resolves with same uid",
        observed: `uid=${pu?.user?.id ?? "null"} err=${pe?.message ?? "-"} token_len=${userA.token.length}`,
        pass: !!pu?.user && pu.user.id === userA.id,
      });
    }

    // ─── T1 party org_admin uploads to open challenge ─────────
    {
      const f = await makeFile("t1");
      const r = await callUploadEvidence(userA.token, {
        challenge_id: chOpen!.id,
        filename: "t1_party_admin.txt",
        mime_type: "text/plain",
        content_base64: b64(f.bytes),
        sha256: f.sha,
      });
      const ok = r.status === 201 && typeof r.body?.storage_path === "string"
        && r.body.storage_path.startsWith(`${match!.id}/${chOpen!.id}/`);
      record({
        id: "T1", description: "Party org_admin can upload evidence to open challenge",
        route: "POST /match-challenges/upload-evidence", account_role: "buyer_org_admin",
        expected: "201 + server-built storage_path",
        observed: `status=${r.status} path=${r.body?.storage_path ?? "n/a"} err=${r.body?.error ?? "-"}`,
        pass: ok, details: r.body,
      });
    }

    // ─── T2 platform_admin uploads to open challenge ──────────
    {
      const f = await makeFile("t2");
      const r = await callUploadEvidence(userP.token, {
        challenge_id: chOpen!.id,
        filename: "t2_platform_admin.txt",
        mime_type: "text/plain",
        content_base64: b64(f.bytes),
        sha256: f.sha,
      });
      const ok = r.status === 201;
      record({
        id: "T2", description: "Platform admin can upload evidence to open challenge",
        route: "POST /match-challenges/upload-evidence", account_role: "platform_admin",
        expected: "201",
        observed: `status=${r.status} err=${r.body?.error ?? "-"}`,
        pass: ok, details: r.body,
      });
    }

    // ─── T3 ordinary org member is denied ─────────────────────
    {
      // Diagnostic snapshot of authorisation inputs
      const [profM, rolesM, isAdminM, isBuyerAdmin, isSellerAdmin] = await Promise.all([
        admin.from("profiles").select("id, org_id, status").eq("id", userM.id).maybeSingle(),
        admin.from("user_roles").select("role").eq("user_id", userM.id),
        admin.rpc("is_admin", { user_id: userM.id }),
        admin.rpc("is_org_admin", { _user_id: userM.id, _org_id: orgA!.id }),
        admin.rpc("is_org_admin", { _user_id: userM.id, _org_id: orgB!.id }),
      ]);
      const f = await makeFile("t3");
      const r = await callUploadEvidence(userM.token, {
        challenge_id: chOpen!.id,
        filename: "t3_member.txt",
        mime_type: "text/plain",
        content_base64: b64(f.bytes),
        sha256: f.sha,
      });
      const ok = r.status === 403 && r.body?.error === "FORBIDDEN";
      record({
        id: "T3", description: "Ordinary org member cannot upload evidence",
        route: "POST /match-challenges/upload-evidence", account_role: "org_member (party org)",
        expected: "403 FORBIDDEN",
        observed: `status=${r.status} err=${r.body?.error ?? "-"} | diag: profile.org_id=${profM.data?.org_id} status=${profM.data?.status} roles=${JSON.stringify(rolesM.data)} is_admin=${isAdminM.data} is_org_admin(buyer=${orgA!.id})=${isBuyerAdmin.data} is_org_admin(seller=${orgB!.id})=${isSellerAdmin.data}`,
        pass: ok, details: { resp: r.body, diag: { profile: profM.data, roles: rolesM.data, isAdmin: isAdminM.data, isBuyerAdmin: isBuyerAdmin.data, isSellerAdmin: isSellerAdmin.data } },
      });
    }

    // ─── T4 unrelated org admin is denied ─────────────────────
    {
      const f = await makeFile("t4");
      const r = await callUploadEvidence(userU.token, {
        challenge_id: chOpen!.id,
        filename: "t4_unrelated.txt",
        mime_type: "text/plain",
        content_base64: b64(f.bytes),
        sha256: f.sha,
      });
      const ok = r.status === 403 && r.body?.error === "FORBIDDEN";
      record({
        id: "T4", description: "Unrelated org admin cannot upload evidence",
        route: "POST /match-challenges/upload-evidence", account_role: "org_admin (unrelated org)",
        expected: "403 FORBIDDEN",
        observed: `status=${r.status} err=${r.body?.error ?? "-"}`,
        pass: ok, details: r.body,
      });
    }

    // ─── T6 SHA-256 mismatch is rejected before storage write ─
    // Snapshot storage object count before T6 to prove no upload occurred.
    const prefix = `${match!.id}/${chOpen!.id}/`;
    const { data: preList } = await admin.storage.from("match-challenge-evidence").list(prefix);
    const preCount = preList?.length ?? 0;
    {
      const f = await makeFile("t6");
      const r = await callUploadEvidence(userA.token, {
        challenge_id: chOpen!.id,
        filename: "t6_sha_mismatch.txt",
        mime_type: "text/plain",
        content_base64: b64(f.bytes),
        sha256: "0".repeat(64), // wrong
      });
      const { data: postList } = await admin.storage.from("match-challenge-evidence").list(prefix);
      const postCount = postList?.length ?? 0;
      const ok = r.status === 400 && r.body?.error === "VALIDATION_ERROR" && postCount === preCount;
      record({
        id: "T6", description: "SHA-256 mismatch rejected before any storage/DB write",
        route: "POST /match-challenges/upload-evidence", account_role: "buyer_org_admin",
        expected: "400 VALIDATION_ERROR + zero storage delta",
        observed: `status=${r.status} err=${r.body?.error ?? "-"} delta=${postCount - preCount}`,
        pass: ok, details: { msg: r.body?.message, preCount, postCount },
      });
    }

    // ─── T7 client cannot pick storage path ───────────────────
    // Schema strips unknown fields; even if client sends `storage_path`/`path`,
    // server must construct its own `<match>/<challenge>/<uuid>-<safe-filename>`.
    // Use a benign filename so the assertion can rely solely on path-shape.
    {
      const f = await makeFile("t7");
      const spoof = "../../../../etc/passwd";
      const benignFilename = "t7_benign.txt";
      const r = await callUploadEvidence(userA.token, {
        challenge_id: chOpen!.id,
        filename: benignFilename,
        mime_type: "text/plain",
        content_base64: b64(f.bytes),
        sha256: f.sha,
        storage_path: spoof,
        path: spoof,
      });
      const path: string = r.body?.storage_path ?? "";
      const segs = path.split("/");
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;
      const ok = r.status === 201
        && segs.length === 3
        && segs[0] === match!.id
        && segs[1] === chOpen!.id
        && uuidRe.test(segs[2])
        && segs[2].endsWith(benignFilename)
        && !path.includes("..")
        && !path.includes("etc/passwd")
        && !path.startsWith("/");
      record({
        id: "T7", description: "Client cannot choose / spoof storage path; server constructs <match>/<challenge>/<uuid>-<safe-filename>",
        route: "POST /match-challenges/upload-evidence", account_role: "buyer_org_admin",
        expected: `201 with shape ${match!.id}/${chOpen!.id}/<uuid>-${benignFilename}`,
        observed: `status=${r.status} path=${path}`,
        pass: ok, details: { spoof_attempted: spoof, returned: path, segs },
      });
    }

    // ─── T8 wrong match_id / challenge_id is impossible by design ─
    // Schema only accepts challenge_id; server derives match from challenge.
    // Negative: pass an unknown challenge UUID → 404.
    {
      const f = await makeFile("t8");
      const fakeChal = crypto.randomUUID();
      const r = await callUploadEvidence(userA.token, {
        challenge_id: fakeChal,
        filename: "t8_wrong_chal.txt",
        mime_type: "text/plain",
        content_base64: b64(f.bytes),
        sha256: f.sha,
      });
      const ok = r.status === 404 && r.body?.error === "NOT_FOUND";
      record({
        id: "T8", description: "Cannot target wrong challenge_id; schema does not accept match_id, server derives it",
        route: "POST /match-challenges/upload-evidence", account_role: "buyer_org_admin",
        expected: "404 NOT_FOUND for unknown challenge_id; match_id is not a client-controlled field",
        observed: `status=${r.status} err=${r.body?.error ?? "-"}`,
        pass: ok, details: { fake_challenge_id: fakeChal },
      });
    }

    // ─── T9 orphan storage object cleaned up on DB insert failure ─
    {
      const f = await makeFile("t9");
      const { data: preList9 } = await admin.storage.from("match-challenge-evidence").list(prefix);
      const r = await callUploadEvidence(userA.token, {
        challenge_id: chOpen!.id,
        filename: "__PHASE2B_FORCE_FAIL__t9.txt", // trips diagnostic trigger
        mime_type: "text/plain",
        content_base64: b64(f.bytes),
        sha256: f.sha,
      });
      // Give storage list a moment to settle then verify the failed object isn't there.
      await new Promise((r) => setTimeout(r, 250));
      const { data: postList9 } = await admin.storage.from("match-challenge-evidence").list(prefix);
      const orphan = (postList9 ?? []).find((o) => o.name.includes("__PHASE2B_FORCE_FAIL__"));
      const ok = r.status === 400 && r.body?.error === "DB_ERROR" && !orphan;
      record({
        id: "T9", description: "If storage upload succeeds but DB insert fails, the orphan object is removed",
        route: "POST /match-challenges/upload-evidence", account_role: "buyer_org_admin",
        expected: "400 DB_ERROR + no orphaned object remains under prefix",
        observed: `status=${r.status} err=${r.body?.error ?? "-"} orphan_present=${!!orphan} pre=${preList9?.length ?? 0} post=${postList9?.length ?? 0}`,
        pass: ok, details: { msg: r.body?.message, orphan: orphan?.name },
      });
    }

    // ─── T10 evidence row's storage_path mirrors the server-built path ─
    {
      // Use the most recent successful evidence row for this challenge.
      const { data: rows } = await admin
        .from("match_challenge_evidence")
        .select("id, storage_path, filename")
        .eq("challenge_id", chOpen!.id)
        .order("created_at", { ascending: false })
        .limit(5);
      const row = rows?.[0];
      let storagePresent = false;
      if (row) {
        const segs = row.storage_path.split("/");
        const objName = segs.slice(2).join("/");
        const { data: sList } = await admin.storage.from("match-challenge-evidence").list(`${segs[0]}/${segs[1]}`);
        storagePresent = !!sList?.find((o) => o.name === objName);
      }
      const ok = !!row && row.storage_path.startsWith(`${match!.id}/${chOpen!.id}/`) && storagePresent;
      record({
        id: "T10", description: "match_challenge_evidence.storage_path mirrors server-built path AND object exists",
        route: "DB read + storage list", account_role: "service_role (audit)",
        expected: `row.storage_path begins with ${match!.id}/${chOpen!.id}/ and storage object exists`,
        observed: row ? `path=${row.storage_path} object_present=${storagePresent}` : "no evidence row found",
        pass: ok, details: row,
      });
    }

    // ─── T5 upload to TERMINAL challenge is rejected ──────────
    // Move challenge to terminal status via service role (bypass RLS).
    await admin.from("match_challenges").update({
      status: "withdrawn",
      outcome_code: "withdrawn_by_raiser",
      outcome_summary: "Phase 2b E2E: forcing terminal state to test upload rejection on terminal challenges (>=40 chars).",
      closed_by_user_id: userA.id,
      closed_at: new Date().toISOString(),
    }).eq("id", chOpen!.id);
    {
      const f = await makeFile("t5");
      const r = await callUploadEvidence(userA.token, {
        challenge_id: chOpen!.id,
        filename: "t5_terminal.txt",
        mime_type: "text/plain",
        content_base64: b64(f.bytes),
        sha256: f.sha,
      });
      const ok = r.status === 409 && r.body?.error === "CHALLENGE_TERMINAL";
      record({
        id: "T5", description: "Upload to terminal (withdrawn) challenge is rejected",
        route: "POST /match-challenges/upload-evidence", account_role: "buyer_org_admin",
        expected: "409 CHALLENGE_TERMINAL",
        observed: `status=${r.status} err=${r.body?.error ?? "-"}`,
        pass: ok, details: r.body,
      });
    }

  } catch (e) {
    record({
      id: "SETUP", description: "Harness setup or orchestration error",
      route: "n/a", account_role: "n/a",
      expected: "no exceptions", observed: e instanceof Error ? e.message : String(e),
      pass: false,
    });
  } finally {
    // Reverse-order teardown
    for (const fn of cleanup.reverse()) {
      try { await fn(); } catch (e) { console.error("cleanup error:", e); }
    }
  }

  const summary = {
    run_id: runId,
    total: tests.length,
    passed: tests.filter((t) => t.pass).length,
    failed: tests.filter((t) => !t.pass).length,
  };
  return new Response(JSON.stringify({ summary, tests }, null, 2), {
    status: summary.failed === 0 ? 200 : 207,
    headers: baseHeaders,
  });
});
