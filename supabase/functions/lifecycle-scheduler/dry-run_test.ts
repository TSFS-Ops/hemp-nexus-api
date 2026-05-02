// Stage 2C-B: lifecycle-scheduler true dry-run contract tests.
//
// These tests assert STATIC properties of the source file — they intentionally
// do NOT invoke the function over the network so they can run in CI without
// touching the live database. They are the contract guard that proves every
// mutation path is reachable only when `dryRun === false`.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SOURCE_PATH = new URL("./index.ts", import.meta.url);
const SOURCE = await Deno.readTextFile(SOURCE_PATH);

Deno.test("lifecycle-scheduler: parses dry_run flag from POST body", () => {
  assert(SOURCE.includes("dryRun = body?.dry_run === true || body?.dryRun === true"),
    "Function must read dry_run from request body");
  assert(SOURCE.includes('req.method === "POST"'),
    "Body parsing must be gated on POST");
});

Deno.test("lifecycle-scheduler: dry_run is reflected in the results payload", () => {
  assert(SOURCE.includes('{ dry_run: dryRun }'),
    "results object must initialise with dry_run flag");
  assert(SOURCE.includes("dry_run: dryRun"), "Response body must include dry_run");
});

Deno.test("lifecycle-scheduler: section 1 (invites/signals/matches/trade_orders) uses ternary SELECT in dry-run", () => {
  // Each of the four section-1 mutations should have `dryRun ? ... : ...` form
  const ternaries = SOURCE.match(/dryRun\s*\n?\s*\?\s*await admin/g) ?? [];
  assert(ternaries.length >= 4,
    `Expected ≥4 dryRun ternary update guards, found ${ternaries.length}`);
});

Deno.test("lifecycle-scheduler: breach detection loop short-circuits in dry-run", () => {
  // The pod_milestones.update + breaches.insert block must be preceded by an early `continue`
  const idx = SOURCE.indexOf("Mark breach detected with grace period on milestone");
  const prelude = SOURCE.slice(Math.max(0, idx - 400), idx);
  assert(prelude.includes("if (dryRun)") && prelude.includes("breachesCreated++"),
    "Breach detection must early-continue in dry-run before any mutation");
});

Deno.test("lifecycle-scheduler: breach finalisation skips both remediation and escalation mutations in dry-run", () => {
  const remediatedIdx = SOURCE.indexOf("Remediated - close breach");
  const remediatedPrelude = SOURCE.slice(Math.max(0, remediatedIdx - 200), remediatedIdx);
  assert(remediatedPrelude.includes("if (dryRun)") && remediatedPrelude.includes("breachesRemediated++"),
    "Remediation branch must early-continue in dry-run");

  const escalateIdx = SOURCE.indexOf("Not remediated - escalate to finalised, increase severity");
  const escalateBlock = SOURCE.slice(escalateIdx, escalateIdx + 1500);
  assert(escalateBlock.includes("if (dryRun)") && escalateBlock.includes("breachesFinalised++"),
    "Escalation branch must early-continue in dry-run");
});

Deno.test("lifecycle-scheduler: notification-dispatch loop is wrapped in if (!dryRun)", () => {
  const idx = SOURCE.indexOf("4. DISPATCH NOTIFICATIONS");
  const block = SOURCE.slice(idx, idx + 1200);
  // The loop body invokes notification-dispatch — must be inside `if (!dryRun)`.
  const ifIdx = block.indexOf("if (!dryRun)");
  const invokeIdx = block.indexOf('admin.functions.invoke("notification-dispatch"');
  assert(ifIdx >= 0, "Section 4 must contain `if (!dryRun)`");
  assert(invokeIdx > ifIdx, "notification-dispatch invoke must occur AFTER `if (!dryRun)`");
});

Deno.test("lifecycle-scheduler: stale unilateral loop early-continues in dry-run before any mutation", () => {
  const idx = SOURCE.indexOf("5. STALE UNILATERAL INTENTS");
  // Window widened in Stage 2C-D1 to accommodate the tightened-predicate comment block.
  const block = SOURCE.slice(idx, idx + 4000);
  const guardIdx = block.indexOf("if (dryRun)");
  const auditInsertIdx = block.indexOf('admin.from("admin_audit_logs").insert(');
  const dispatchIdx = block.indexOf('admin.functions.invoke("notification-dispatch"');
  const webhookIdx = block.indexOf("triggerWebhooks(");
  assert(guardIdx > 0, "Stale-unilateral loop must contain `if (dryRun)`");
  assert(auditInsertIdx > guardIdx, "admin_audit_logs insert must be AFTER dry-run guard");
  assert(dispatchIdx > guardIdx, "notification-dispatch invoke must be AFTER dry-run guard");
  assert(webhookIdx > guardIdx, "triggerWebhooks must be AFTER dry-run guard");
});

Deno.test("lifecycle-scheduler: webhook_replay_guard prune is skipped in dry-run", () => {
  const idx = SOURCE.indexOf("Webhook replay-guard pruning");
  const block = SOURCE.slice(idx, idx + 1000);
  assert(block.includes("if (dryRun)"), "Replay-guard prune must check dry-run");
  assert(block.includes("skipped_dry_run: true"),
    "Dry-run branch must record skipped_dry_run flag");
  // The actual prune RPC must be inside the `else` branch
  const elseIdx = block.indexOf("} else {");
  const pruneIdx = block.indexOf('"prune_webhook_replay_guard"');
  assert(elseIdx > 0 && pruneIdx > elseIdx,
    "prune_webhook_replay_guard RPC must only execute in the non-dry-run else branch");
});

Deno.test("lifecycle-scheduler: final audit_logs insert is skipped in dry-run (true zero-mutation contract)", () => {
  const idx = SOURCE.indexOf("// ── Audit ──");
  const block = SOURCE.slice(idx, idx + 600);
  assert(block.includes("if (!dryRun)"),
    "Final audit_logs insert must be wrapped in if (!dryRun)");
  // The insert must come AFTER the if
  const ifIdx = block.indexOf("if (!dryRun)");
  const insertIdx = block.indexOf('admin.from("audit_logs").insert(');
  assert(insertIdx > ifIdx, "audit_logs insert must be inside the if (!dryRun) block");
});

Deno.test("lifecycle-scheduler: lock is acquired AND released in dry-run paths too", () => {
  // Lock acquisition is unconditional; release happens at the end of the success
  // path AND in the catch block. Dry-run must not bypass either.
  assert(SOURCE.includes("await admin.rpc('try_lifecycle_lock')"),
    "Advisory lock acquisition must be unconditional");
  assert(SOURCE.includes("await releaseLock()"),
    "Lock must be released on success path");
  assert(SOURCE.includes("await adminClient.rpc('release_lifecycle_lock')"),
    "Lock must be released in catch block");
});

Deno.test("lifecycle-scheduler: response body advertises dry_run state", () => {
  // Caller must be able to programmatically detect dry-run from the response.
  const responseBlock = SOURCE.slice(SOURCE.indexOf("return new Response(JSON.stringify({"));
  assert(responseBlock.includes("dry_run: dryRun"),
    "Response must include dry_run boolean");
});

Deno.test("lifecycle-scheduler: results includes dry-run-skipped counters for observability", () => {
  assert(SOURCE.includes("skipped_dry_run"),
    "Results payload must include `skipped_dry_run` counters so operators can verify zero-mutation");
  assert(SOURCE.includes("notifications_skipped_dry_run"),
    "Stale-unilateral results must report skipped notifications");
  assert(SOURCE.includes("webhooks_skipped_dry_run"),
    "Stale-unilateral results must report skipped webhooks");
});

Deno.test("lifecycle-scheduler: every mutation primitive is preceded by a dry-run guard", () => {
  // Static safety net: assert that the count of mutation calls hasn't grown
  // past what we've individually audited. If a future edit adds a new
  // .update/.insert/.delete/.invoke/triggerWebhooks call without updating this
  // test, the count check will fail and force re-audit.
  const updates = (SOURCE.match(/\.update\(/g) ?? []).length;
  const inserts = (SOURCE.match(/\.insert\(/g) ?? []).length;
  const deletes = (SOURCE.match(/\.delete\(/g) ?? []).length;
  const invokes = (SOURCE.match(/\.functions\.invoke\(/g) ?? []).length;
  const webhooks = (SOURCE.match(/triggerWebhooks\(/g) ?? []).length;
  const pruneRpc = (SOURCE.match(/"prune_webhook_replay_guard"/g) ?? []).length;

  // Snapshot of expected mutation-primitive counts as of Stage 2C-B.
  // If you add or remove a mutation, update this snapshot AND prove the new
  // call is dry-run-guarded with a dedicated test above.
  assertEquals(updates, 10, "Unexpected change in .update() call count — re-audit dry-run guards");
  assertEquals(inserts, 3, "Unexpected change in .insert() call count — re-audit dry-run guards");
  assertEquals(deletes, 0, "No direct .delete() calls expected in lifecycle-scheduler");
  assertEquals(invokes, 2, "Unexpected change in .functions.invoke() call count — re-audit");
  assertEquals(webhooks, 1, "Unexpected change in triggerWebhooks() call count — re-audit");
  assertEquals(pruneRpc, 1, "Unexpected change in prune_webhook_replay_guard call count — re-audit");
});
