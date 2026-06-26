/**
 * P-5 Batch 7 — Phase 5 unit tests for action wrappers.
 *
 * Validates permission gating, reason-required enforcement, dashboard/
 * export mismatch detection, and audit-event guard.
 */
import { describe, expect, it } from "vitest";
import {
  P5B7ActionError,
  p5b7CanRunExport,
  p5b7CreateExportJob,
  p5b7ExportRequiresReason,
} from "@/lib/p5-batch7/actions";

describe("p5b7 export permission gating", () => {
  it("denies caller without the authorised role", async () => {
    await expect(
      p5b7CreateExportJob({
        dashboard: "control_dashboard",
        exportType: "control_summary_csv",
        reason: "valid reason text here",
        effectiveRoles: ["org_user"],
      }),
    ).rejects.toMatchObject({ code: "export_not_authorised" });
  });

  it("rejects an export when reason is required but missing", async () => {
    await expect(
      p5b7CreateExportJob({
        dashboard: "control_dashboard",
        exportType: "control_summary_csv",
        reason: "",
        effectiveRoles: ["platform_admin"],
      }),
    ).rejects.toMatchObject({ code: "reason_required" });
  });

  it("rejects when export type does not belong to the dashboard", async () => {
    await expect(
      p5b7CreateExportJob({
        dashboard: "control_dashboard",
        exportType: "audit_event_csv",
        reason: "valid reason text here",
        effectiveRoles: ["platform_admin"],
      }),
    ).rejects.toMatchObject({ code: "export_dashboard_mismatch" });
  });

  it("p5b7CanRunExport matches the registry", () => {
    expect(p5b7CanRunExport("control_summary_csv", ["platform_admin"])).toBe(true);
    expect(p5b7CanRunExport("control_summary_csv", ["funder_user"])).toBe(false);
  });

  it("p5b7ExportRequiresReason aligns with the registry", () => {
    expect(p5b7ExportRequiresReason("control_summary_csv")).toBe(true);
    expect(p5b7ExportRequiresReason("org_case_summary_csv")).toBe(false);
  });

  it("P5B7ActionError is a typed error", () => {
    const e = new P5B7ActionError("x", "y");
    expect(e.name).toBe("P5B7ActionError");
    expect(e.code).toBe("y");
  });
});
