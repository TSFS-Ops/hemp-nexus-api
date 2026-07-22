/**
 * Institutional Funder Evidence Workspace -- Batch 3 verification pass
 * (RFI lifecycle).
 *
 * Confirms fw_funder_close_rfi_v1 enforces the documented V1 workflow
 * precondition -- an RFI must be answered before it can be closed (see
 * docs/funder-workspace/authenticated-browser-walkthrough-DRAFT.md,
 * "Close RFI" row) -- and that the funder-facing RFI panel only offers
 * the "Close request" action once that precondition can be met.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIG_DIR = "supabase/migrations";

function allMigrations(): string {
    return readdirSync(MIG_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(MIG_DIR, f), "utf8"))
      .join("\n");
}

function latestCloseRfiFunctionBody(sql: string): string {
    const marker = "CREATE OR REPLACE FUNCTION public.fw_funder_close_rfi_v1";
    const start = sql.lastIndexOf(marker);
    expect(start, "fw_funder_close_rfi_v1 definition must exist in some migration").toBeGreaterThan(-1);
    const fromStart = sql.slice(start);
    const end = fromStart.indexOf("$$;");
    return fromStart.slice(0, end + 3);
}

const FUNDER_PANEL = readFileSync(
    join(
          process.cwd(),
          "src/pages/funder/workspace/components/FunderWorkflowPanels.tsx",
        ),
    "utf8",
  );

describe("Batch 3 -- RFI close requires an answer", () => {
    const sql = allMigrations();
    const body = latestCloseRfiFunctionBody(sql);

           it("rejects closing an RFI that has not been answered", () => {
                 expect(body).toMatch(/rfi_not_answered/);
                 expect(body).toMatch(/v_status\s*<>\s*'answered'/);
           });

           it("still blocks closing an already-terminal (closed/withdrawn) RFI", () => {
                 expect(body).toMatch(/rfi_terminal/);
                 expect(body).toMatch(/'closed','withdrawn'/);
           });

           it("does not touch the function signature (still p_rfi_id uuid, p_reason text)", () => {
                 expect(body).toMatch(/fw_funder_close_rfi_v1\(p_rfi_id uuid, p_reason text\)/);
           });

           it("funder RFI panel only offers 'Close request' once the RFI is answered", () => {
                 expect(FUNDER_PANEL).toMatch(/rfi\?\.status === "answered"/);
           });
});
