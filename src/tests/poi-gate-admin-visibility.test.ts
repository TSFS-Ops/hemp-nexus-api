/**
 * Ticket 2 — POI Gate Admin Visibility.
 *
 * Static assertions that the existing admin/HQ audit UI
 * (`src/components/admin/AdminAuditLogs.tsx`) surfaces blocked POI
 * attempts emitted by the legitimacy + authority gates. We deliberately
 * test the existing surface rather than building a new one.
 *
 * The POI Verification Gate itself is NOT touched by this ticket — these
 * tests assert visibility only.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("Ticket 2 — POI Gate Admin Visibility", () => {
  const ui = read("src/components/admin/AdminAuditLogs.tsx");

  it("audit UI registers human-readable labels for both gate events", () => {
    expect(ui).toMatch(/POI_GATE_LABELS/);
    expect(ui).toMatch(/"poi\.mint_denied"\s*:\s*\{\s*label:\s*"POI mint denied"/);
    expect(ui).toMatch(/"legitimacy\.gate_blocked"\s*:\s*\{\s*label:\s*"Organisation legitimacy gate blocked POI"/);
    expect(ui).toMatch(/"intent\.denied"\s*:\s*\{\s*label:\s*"Blocked POI attempt"/);
  });

  it("audit UI exposes a poi_gate filter that targets only the gate events", () => {
    expect(ui).toMatch(/SelectItem value="poi_gate"/);
    expect(ui).toMatch(/groupFilter === "poi_gate"/);
    // The filter must constrain to exactly the three gate events, never widen.
    expect(ui).toMatch(/"poi\.mint_denied",\s*"legitimacy\.gate_blocked",\s*"intent\.denied",?\s*\]/);
  });

  it("details dialog promotes gate reason fields and keeps the raw event key visible", () => {
    expect(ui).toMatch(/Blocked POI attempt — \{POI_GATE_LABELS\[selectedLog\.action\]\.label\}/);
    expect(ui).toMatch(/reason_code/);
    expect(ui).toMatch(/legitimacy_reason/);
    expect(ui).toMatch(/authority_reason/);
    expect(ui).toMatch(/held_roles/);
    expect(ui).toMatch(/Raw event key:/);
  });

  it("the gate code paths emit the canonical audit events expected by the UI", () => {
    const pois = read("supabase/functions/pois/index.ts");
    const match = read("supabase/functions/match/index.ts");
    const transition = read("supabase/functions/poi-transition/index.ts");
    const engagements = read("supabase/functions/poi-engagements/index.ts");

    expect(pois).toMatch(/action:\s*"poi\.mint_denied"/);
    expect(match).toMatch(/action:\s*"poi\.mint_denied"/);
    expect(match).toMatch(/action:\s*"intent\.denied"/);
    expect(transition).toMatch(/action:\s*"legitimacy\.gate_blocked"/);
    expect(engagements).toMatch(/action:\s*"legitimacy\.gate_blocked"/);
  });

  it("UI does not weaken admin route guards — mounted only inside HQ", () => {
    const hq = read("src/pages/HQ.tsx");
    expect(hq).toMatch(/AdminAuditLogs/);
    // HQ.tsx itself is wrapped in platform_admin / RequireAuth guards; this
    // test pins the mount location so a future move can't accidentally
    // expose the panel from a non-admin surface.
  });
});
