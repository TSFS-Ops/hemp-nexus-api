/**
 * Batch D Test 6 — duplicate-click / Idempotency-Key replay protection.
 *
 * Source-pin tests (no live HTTP). They assert:
 *
 *  1. The seeder defines a fresh fixture DEMO-RECONFIRM-DUPLICATE-007 in
 *     `late_acceptance_pending_initiator_reconfirmation`, with all three
 *     late-acceptance timestamps populated, is_demo=true, and a future
 *     reconfirmation_window_expires_at, distinct from
 *     DEMO-LATE-RECONFIRM-005 so Test 5 consumption cannot contaminate it.
 *  2. The unseeder allowlists the new hash, so the test row can be cleanly
 *     removed.
 *  3. The poi-engagements edge function reconfirm/decline-late-acceptance
 *     branch hard-requires the Idempotency-Key header, calls the shared
 *     idempotency lookup helper, and persists the successful response via
 *     the shared store helper — so a duplicate request replays the same
 *     200 body instead of running atomic_reconfirm_late_acceptance again.
 *  4. ReconfirmLateAcceptanceCard sends the Idempotency-Key header on both
 *     reconfirm and decline-late-acceptance POSTs, and reuses one stable
 *     key per user-initiated attempt so a rapid double-tap of the dialog
 *     confirm button does not mint two distinct keys.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SEEDER = readFileSync(
  resolve("supabase/functions/seed-daniel-fixtures/index.ts"),
  "utf8",
);
const UNSEEDER = readFileSync(
  resolve("supabase/functions/unseed-daniel-fixtures/index.ts"),
  "utf8",
);
const EDGE = readFileSync(
  resolve("supabase/functions/poi-engagements/index.ts"),
  "utf8",
);
const CARD = readFileSync(
  resolve("src/components/match/ReconfirmLateAcceptanceCard.tsx"),
  "utf8",
);

describe("Batch D Test 6 — seeder fixture DEMO-RECONFIRM-DUPLICATE-007", () => {
  it("declares the fixture id in the FIXTURES list", () => {
    expect(SEEDER).toContain('"DEMO-RECONFIRM-DUPLICATE-007"');
  });

  it("seeds it as a separate match (distinct hash) from DEMO-LATE-RECONFIRM-005", () => {
    expect(SEEDER).toMatch(
      /ensureMatch\([^)]*"DEMO-RECONFIRM-DUPLICATE-007"/,
    );
    // It must coexist with — not replace — the original Test 5 fixture.
    expect(SEEDER).toContain('"DEMO-LATE-RECONFIRM-005"');
  });

  it("is seeded in late_acceptance_pending_initiator_reconfirmation with future window", () => {
    const block = SEEDER.split("DEMO-RECONFIRM-DUPLICATE-007")
      .slice(1)
      .join("DEMO-RECONFIRM-DUPLICATE-007");
    expect(block).toMatch(
      /engagement_status:\s*"late_acceptance_pending_initiator_reconfirmation"/,
    );
    expect(block).toContain("original_expired_at");
    expect(block).toContain("late_acceptance_recorded_at");
    expect(block).toContain("reconfirmation_window_expires_at");
    // future window — uses now + N * day
    expect(block).toMatch(/now \+ \d+ \* day/);
  });

  it("returns the /desk/match/:matchId route in the seeder response", () => {
    const block = SEEDER.split("DEMO-RECONFIRM-DUPLICATE-007")
      .slice(1)
      .join("DEMO-RECONFIRM-DUPLICATE-007");
    expect(block).toMatch(/route:\s*`\/desk\/match\/\$\{matchId\}`/);
  });

  it("unseeder allowlists the new hash for clean removal", () => {
    expect(UNSEEDER).toContain('"DEMO-RECONFIRM-DUPLICATE-007"');
  });
});

describe("Batch D Test 6 — edge function Idempotency-Key wiring", () => {
  // Narrow to the reconfirm / decline-late-acceptance branch only so we do
  // not accidentally pass on idempotency wiring belonging to other branches.
  const branchStart = EDGE.indexOf(
    '(parts[1] === "reconfirm" || parts[1] === "decline-late-acceptance")',
  );
  const branchEnd = EDGE.indexOf(
    "// ── POST /poi-engagements/respond/:matchId",
    branchStart,
  );
  const branch = EDGE.slice(branchStart, branchEnd);

  it("locates the reconfirm / decline-late-acceptance branch", () => {
    expect(branchStart).toBeGreaterThan(-1);
    expect(branchEnd).toBeGreaterThan(branchStart);
  });

  it("hard-requires Idempotency-Key (400 VALIDATION_ERROR when missing)", () => {
    expect(branch).toContain('req.headers.get("Idempotency-Key")');
    expect(branch).toMatch(
      /VALIDATION_ERROR[\s\S]{0,80}Idempotency-Key header is required/,
    );
  });

  it("looks up cached response via the shared helper before running the RPC", () => {
    const lookupIdx = branch.indexOf("lookupIdempotentResponse");
    const rpcIdx = branch.indexOf("supabase.rpc(rpcName");
    expect(lookupIdx).toBeGreaterThan(-1);
    expect(rpcIdx).toBeGreaterThan(-1);
    expect(lookupIdx).toBeLessThan(rpcIdx);
    expect(branch).toContain("cachedResponseToHttp(cached, headers)");
  });

  it("scopes the cache key by per-action endpoint path", () => {
    expect(branch).toMatch(
      /endpoint:\s*`POST \/poi-engagements\/\$\{engagementId\}\/\$\{action\}`/,
    );
  });

  it("persists successful 200 responses for replay", () => {
    expect(branch).toContain(
      "storeIdempotentResponse(idemOpts, { status: 200, body: responseBody })",
    );
  });
});

describe("Batch D Test 6 — ReconfirmLateAcceptanceCard sends Idempotency-Key", () => {
  it("imports the shared key generator", () => {
    expect(CARD).toContain(
      'import { generateIdempotencyKey } from "@/lib/api-client"',
    );
  });

  it("sends Idempotency-Key on the reconfirm/decline POST", () => {
    expect(CARD).toMatch(
      /headers:\s*\{\s*"Idempotency-Key":\s*key\s*\}/,
    );
  });

  it("reuses one stable key per attempt (per dialog open)", () => {
    expect(CARD).toMatch(
      /idempotencyKeys\[action\]\s*\?\?\s*generateIdempotencyKey/,
    );
    // openPending stores the per-action key in state before opening the dialog.
    expect(CARD).toContain("const openPending");
    expect(CARD).toMatch(
      /prev\[action\]\s*\?\?\s*generateIdempotencyKey\(`reconfirm_\$\{action\}`\)/,
    );
  });

  it("clears the stored key after a successful resolution", () => {
    expect(CARD).toContain(
      'setIdempotencyKeys({ reconfirm: null, "decline-late-acceptance": null })',
    );
  });

  it("buttons route through openPending (not raw setPending)", () => {
    expect(CARD).toContain('onClick={() => openPending("reconfirm")}');
    expect(CARD).toContain(
      'onClick={() => openPending("decline-late-acceptance")}',
    );
    // Defensive: no remaining direct setPending("reconfirm"...) call sites,
    // which would bypass the per-attempt key generation.
    expect(CARD).not.toMatch(/setPending\("reconfirm"\)/);
    expect(CARD).not.toMatch(/setPending\("decline-late-acceptance"\)/);
  });
});
