// NOT-008 — Verify resolve_notifications_for() is wired at every documented
// resolution point and that new in-app notification inserts populate
// entity_type/entity_id so the helper can find them.
//
// Pure static (file-content) assertions — no Deno/Supabase runtime required.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

const SHARED = read("supabase/functions/_shared/resolve-notifications.ts");
const POI_ENG = read("supabase/functions/poi-engagements/index.ts");
const CHALLENGES = read("supabase/functions/match-challenges/index.ts");
const LIFECYCLE = read("supabase/functions/lifecycle-scheduler/index.ts");
const ENG_REMINDER = read("supabase/functions/engagement-reminder/index.ts");
const DD = read("supabase/functions/due-diligence/index.ts");
const MATCH = read("supabase/functions/match/index.ts");
const TRADE_APPROVAL = read("supabase/functions/trade-approval/index.ts");

describe("NOT-008 — resolve_notifications_for shared helper", () => {
  it("exports a typed helper that wraps the SECURITY DEFINER RPC", () => {
    expect(SHARED).toMatch(/export\s+async\s+function\s+resolveNotificationsFor/);
    expect(SHARED).toMatch(/rpc\(\s*["']resolve_notifications_for["']/);
    expect(SHARED).toMatch(/p_entity_type/);
    expect(SHARED).toMatch(/p_entity_id/);
  });
  it("is best-effort — never throws on rpc failure", () => {
    expect(SHARED).toMatch(/non-fatal/);
    expect(SHARED).toMatch(/return\s+\{\s*ok:\s*false/);
  });
});

describe("NOT-008 — poi-engagements terminal transitions resolve notifications", () => {
  it("imports the shared helper", () => {
    expect(POI_ENG).toMatch(/from\s+["']\.\.\/_shared\/resolve-notifications\.ts["']/);
  });
  it("resolves notifications after initiator cancel", () => {
    expect(POI_ENG).toMatch(/poi-engagements:initiator_cancel/);
  });
  it("resolves notifications after email-change cancel", () => {
    expect(POI_ENG).toMatch(/poi-engagements:cancelled_email_change/);
  });
  it("resolves notifications after counterparty accept/decline", () => {
    expect(POI_ENG).toMatch(/poi-engagements:counterparty_/);
  });
  it("resolves notifications after late-acceptance initiator decision", () => {
    expect(POI_ENG).toMatch(/poi-engagements:initiator_/);
  });
});

describe("NOT-008 — match-challenges terminal close resolves notifications", () => {
  it("imports the shared helper", () => {
    expect(CHALLENGES).toMatch(/from\s+["']\.\.\/_shared\/resolve-notifications\.ts["']/);
  });
  it("only resolves when transitioning into a terminal status", () => {
    expect(CHALLENGES).toMatch(/TERMINAL_STATUSES\.has\(p\.to_status\)/);
    expect(CHALLENGES).toMatch(/resolveNotificationsFor\(admin,\s*["']match_challenge["']/);
  });
});

describe("NOT-008 — lifecycle-scheduler resolution paths", () => {
  it("imports the shared helper", () => {
    expect(LIFECYCLE).toMatch(/from\s+["']\.\.\/_shared\/resolve-notifications\.ts["']/);
  });
  it("resolves notifications when a breach is remediated", () => {
    expect(LIFECYCLE).toMatch(/resolveNotificationsFor\(admin,\s*["']breach["']/);
    expect(LIFECYCLE).toMatch(/lifecycle-scheduler:breach_remediated/);
  });
  it("resolves notifications when matches are auto-expired", () => {
    expect(LIFECYCLE).toMatch(/resolveNotificationsFor\(admin,\s*["']match["']/);
    expect(LIFECYCLE).toMatch(/lifecycle-scheduler:match_expired/);
  });
});

describe("NOT-008 — engagement-reminder", () => {
  it("imports the shared helper", () => {
    expect(ENG_REMINDER).toMatch(/from\s+["']\.\.\/_shared\/resolve-notifications\.ts["']/);
  });
  it("links stale-reminder admin notifications to the engagement entity", () => {
    expect(ENG_REMINDER).toMatch(/entity_type:\s*["']poi_engagement["']/);
    expect(ENG_REMINDER).toMatch(/entity_id:\s*eng\.id/);
  });
  it("resolves notifications after auto-expiry", () => {
    expect(ENG_REMINDER).toMatch(/engagement-reminder:auto_expired/);
  });
});

describe("NOT-008 — due-diligence approval resolution", () => {
  it("imports the shared helper", () => {
    expect(DD).toMatch(/from\s+["']\.\.\/_shared\/resolve-notifications\.ts["']/);
  });
  it("links every approval_required / approval_completed / approval_rejected row to the dd_approval_request", () => {
    const occ = (DD.match(/entity_type:\s*["']dd_approval_request["']/g) || []).length;
    expect(occ).toBeGreaterThanOrEqual(4);
  });
  it("resolves notifications on rejection and completion", () => {
    expect(DD).toMatch(/due-diligence:rejected/);
    expect(DD).toMatch(/due-diligence:completed/);
  });
});

describe("NOT-008 — entity linkage on inserts", () => {
  it("trade-approval links approval_required rows to the trade_approval row", () => {
    expect(TRADE_APPROVAL).toMatch(/entity_type:\s*["']trade_approval["']/);
    expect(TRADE_APPROVAL).toMatch(/entity_id:\s*approval\.id/);
  });
  it("match POI notifications link to the match entity (3 routes)", () => {
    const occ = (MATCH.match(/entity_type:\s*["']match["']/g) || []).length;
    expect(occ).toBeGreaterThanOrEqual(3);
  });
});
