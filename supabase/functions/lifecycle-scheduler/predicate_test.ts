// Stage 2C-D1: stale-unilateral predicate contract tests.
//
// Static source-level assertions proving the stale-unilateral query in
// `index.ts` excludes terminal commercial states and only flags genuinely
// open unilateral intents. These do NOT hit the network.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SOURCE = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

// Isolate the stale-unilateral query block so assertions can't accidentally
// match strings from unrelated sections.
function staleBlock(): string {
  const start = SOURCE.indexOf("5. STALE UNILATERAL INTENTS");
  assert(start > 0, "Section 5 marker not found");
  const queryStart = SOURCE.indexOf(".from(\"matches\")", start);
  assert(queryStart > start, "stale-unilateral .from(matches) not found");
  const queryEnd = SOURCE.indexOf(".limit(", queryStart);
  assert(queryEnd > queryStart, "stale-unilateral .limit() terminator not found");
  return SOURCE.slice(queryStart, queryEnd + 20);
}

Deno.test("stale-unilateral: filters match_type = unilateral", () => {
  assert(staleBlock().includes('.eq("match_type", "unilateral")'));
});

Deno.test("stale-unilateral: requires created_at < staleCutoff", () => {
  assert(staleBlock().includes('.lt("created_at", staleCutoff)'));
});

Deno.test("stale-unilateral: requires buyer_id OR seller_id is null", () => {
  assert(staleBlock().includes('.or("buyer_id.is.null,seller_id.is.null")'));
});

Deno.test("stale-unilateral: excludes state = committed (terminal)", () => {
  const b = staleBlock();
  assert(b.includes('.not("state", "in", "(completed,cancelled,committed)")'),
    "state exclusion list must include 'committed'");
});

Deno.test("stale-unilateral: excludes state = completed and cancelled", () => {
  const b = staleBlock();
  assert(b.includes("completed") && b.includes("cancelled"));
});

Deno.test("stale-unilateral: excludes status = settled (terminal)", () => {
  assert(staleBlock().includes('.not("status", "in", "(settled,cancelled)")'),
    "status exclusion list must include 'settled' and 'cancelled'");
});

Deno.test("stale-unilateral: only includes live POI states (DRAFT/PENDING_APPROVAL/ELIGIBLE)", () => {
  const b = staleBlock();
  assert(b.includes('.in("poi_state", ["DRAFT", "PENDING_APPROVAL", "ELIGIBLE"])'),
    "must restrict poi_state to live/open values");
});

Deno.test("stale-unilateral: select projects status and poi_state for downstream visibility", () => {
  const b = staleBlock();
  assert(b.includes("status") && b.includes("poi_state"),
    "select must include status and poi_state to support audit metadata");
});

Deno.test("stale-unilateral: predicate change preserves dry-run guard semantics", () => {
  // The dry_run loop guard from Stage 2C-B must still wrap mutations.
  const idx = SOURCE.indexOf("5. STALE UNILATERAL INTENTS");
  const block = SOURCE.slice(idx, idx + 2800);
  const guardIdx = block.indexOf("if (dryRun)");
  const auditInsertIdx = block.indexOf('admin.from("admin_audit_logs").insert(');
  assert(guardIdx > 0 && auditInsertIdx > guardIdx,
    "dry-run guard must still precede admin_audit_logs insert");
});
