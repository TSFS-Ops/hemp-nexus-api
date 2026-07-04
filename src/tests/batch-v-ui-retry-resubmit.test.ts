/**
 * Batch V-UI — retry / resubmit CTA logic for the IDV status widget.
 *
 * Verifies that the resubmit-eligible statuses map to safe labels
 * and route through /desk/idv/start?resubmit=1&reason=<status>.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { idvSafeLabel, IDV_BANNED_WORDING } from "@/components/idv/idv-status-labels";

const RESUBMIT_STATES = [
  "retry_required",
  "alternative_document_required",
  "failed",
  "expired",
  "error",
  "provider_error",
] as const;

describe("Batch V-UI — retry / resubmit flow", () => {
  it("every resubmit-eligible state has a safe label and next action", () => {
    for (const s of RESUBMIT_STATES) {
      const l = idvSafeLabel(s);
      expect(l.label).toBeTruthy();
      expect(l.next_action).toBeTruthy();
      const hay = `${l.label} ${l.next_action}`.toLowerCase();
      for (const bad of IDV_BANNED_WORDING) {
        expect(hay.includes(bad)).toBe(false);
      }
    }
  });

  it("status widget resubmit CTA invokes the idv-resubmit edge function", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/idv/IdvStatusWidget.tsx"),
      "utf8",
    );
    expect(src).toContain('supabase.functions.invoke');
    expect(src).toContain('"idv-resubmit"');
    expect(src).toContain('source: "status_widget"');
    // Widget navigates programmatically after the API call succeeds.
    expect(src).toContain("useNavigate");
  });

  it("start screen renders a resubmit banner and fires idv-resubmit on mount", () => {
    const src = readFileSync(
      join(process.cwd(), "src/pages/desk/idv/IdvStart.tsx"),
      "utf8",
    );
    expect(src).toContain("idv-resubmit-banner");
    expect(src).toContain("useSearchParams");
    expect(src).toContain('"idv-resubmit"');
    expect(src).toContain('source: "start_screen"');
  });

  it("idv-resubmit edge function persists intent, appends screening audit, and writes a compliance audit_log", () => {
    const src = readFileSync(
      join(process.cwd(), "supabase/functions/idv-resubmit/index.ts"),
      "utf8",
    );
    for (const s of RESUBMIT_STATES) {
      expect(src).toContain(`"${s}"`);
    }
    expect(src).toContain('"user_initiated"');
    expect(src).toContain("p5scr_audit_events");
    expect(src).toContain("p5_screening.idv_required");
    expect(src).toContain("idv_resubmit_intents");

    // Structured compliance audit — actor, action, entity, reason, states.
    expect(src).toContain('from("audit_logs")');
    expect(src).toContain('"idv.resubmit_requested"');
    expect(src).toContain('entity_type: "idv_subject"');
    expect(src).toContain("actor_user_id: user.id");
    expect(src).toContain("prior_state");
    expect(src).toContain("resulting_state");
    expect(src).toContain("audit_logged");

    // The function must never surface raw provider payloads or secrets.
    expect(src).not.toContain("raw_provider_payload");
    expect(src).not.toContain("VERIFYNOW_API_KEY");
  });

  it("status widget reads idv_resubmit_intents and prefers the latest reason", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/idv/IdvStatusWidget.tsx"),
      "utf8",
    );
    expect(src).toContain('idv_resubmit_intents');
    expect(src).toContain("preferIntent");
  });

  it("status widget polls until the run reaches a terminal / actionable state", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/idv/IdvStatusWidget.tsx"),
      "utf8",
    );
    expect(src).toContain("ACTIVE_POLL_STATES");
    expect(src).toContain("POLL_INTERVAL_MS");
    expect(src).toContain("POLL_MAX_ATTEMPTS");
    expect(src).toContain("startPolling");
    expect(src).toContain("idv-polling-indicator");
    expect(src).toContain("pollOnMount");
    // Terminal / actionable states must NOT be in the active-poll set.
    const activeLine = src.split("\n").find((l) => l.includes("ACTIVE_POLL_STATES = new Set")) ?? "";
    for (const terminal of [
      "idv_completed",
      "manual_review_accepted",
      "manual_review_required",
      "failed",
      "expired",
      "retry_required",
      "alternative_document_required",
      "provider_error",
      "blocked_pending_admin_decision",
    ]) {
      expect(activeLine.includes(`"${terminal}"`)).toBe(false);
    }
  });

  it("start screen mounts the widget in poll-on-mount mode when resubmitting", () => {
    const src = readFileSync(
      join(process.cwd(), "src/pages/desk/idv/IdvStart.tsx"),
      "utf8",
    );
    expect(src).toContain("pollOnMount={isResubmit}");
  });
});
