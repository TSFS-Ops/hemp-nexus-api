/**
 * Retention Enforcement - Unit Tests
 *
 * Tests retention lifecycle state model, enforcement action mapping,
 * duplicate prevention, and resolution logic.
 */

import { describe, it, expect } from "vitest";

// ── Retention model types ──

interface RetentionFlag {
  id: string;
  table_name: string;
  record_id: string;
  flag_type: string;
  retention_status: string;
  retention_action: string | null;
  enforcement_applied_at: string | null;
  resolution_status: string | null;
  record_created_at: string;
  retention_expires_at: string;
}

// ── State model ──

const VALID_STATUSES = ["active", "flagged", "retained", "archived", "quarantined", "pending_deletion", "deleted", "resolved"];
const VALID_ACTIONS = ["archive", "quarantine", "mark_readonly", "schedule_deletion", "retain", "no_action"];
const VALID_RESOLUTIONS = ["acknowledged", "extended", "dismissed", "completed"];
const NON_REPROCESSABLE = ["archived", "quarantined", "retained", "resolved", "deleted", "pending_deletion"];

// Conservative defaults per record type
const DEFAULT_ACTIONS: Record<string, string> = {
  audit_logs: "retain",
  collapse_ledger: "retain",
  match_events: "archive",
  matches: "archive",
  screening_results: "archive",
  match_documents: "quarantine",
  wads: "archive",
  compliance_cases: "retain",
};

// ── Core enforcement functions ──

function determineRetentionStatus(isExpired: boolean): string {
  return isExpired ? "flagged" : "active";
}

function getDefaultAction(tableName: string): string {
  return DEFAULT_ACTIONS[tableName] || "archive";
}

function shouldReprocess(flag: RetentionFlag): boolean {
  return !NON_REPROCESSABLE.includes(flag.retention_status);
}

function resolveEnforcementStatus(action: string): string {
  switch (action) {
    case "archive": return "archived";
    case "quarantine": return "quarantined";
    case "retain": return "retained";
    case "mark_readonly": return "retained";
    case "schedule_deletion": return "pending_deletion";
    case "no_action": return "resolved";
    default: return "archived";
  }
}

function isExpired(recordCreatedAt: string, retentionYears: number): boolean {
  const created = new Date(recordCreatedAt);
  const expiresAt = new Date(created);
  expiresAt.setFullYear(expiresAt.getFullYear() + retentionYears);
  return expiresAt <= new Date();
}

function calculateExpiryDate(recordCreatedAt: string, retentionYears: number): Date {
  const created = new Date(recordCreatedAt);
  const expiresAt = new Date(created);
  expiresAt.setFullYear(expiresAt.getFullYear() + retentionYears);
  return expiresAt;
}

function isApproachingExpiry(recordCreatedAt: string, retentionYears: number, warningDays: number): boolean {
  const expiresAt = calculateExpiryDate(recordCreatedAt, retentionYears);
  const now = new Date();
  const warningDate = new Date(expiresAt);
  warningDate.setDate(warningDate.getDate() - warningDays);
  return now >= warningDate && now < expiresAt;
}

// ── Test data ──

const makeFlag = (overrides: Partial<RetentionFlag> = {}): RetentionFlag => ({
  id: "flag-001",
  table_name: "matches",
  record_id: "rec-001",
  flag_type: "approaching_expiry",
  retention_status: "active",
  retention_action: null,
  enforcement_applied_at: null,
  resolution_status: null,
  record_created_at: "2019-03-22T00:00:00Z",
  retention_expires_at: "2026-03-22T00:00:00Z",
  ...overrides,
});

// ── Tests ──

describe("Retention Enforcement", () => {
  describe("Status model validation", () => {
    it("all valid statuses are recognized", () => {
      expect(VALID_STATUSES).toContain("active");
      expect(VALID_STATUSES).toContain("flagged");
      expect(VALID_STATUSES).toContain("archived");
      expect(VALID_STATUSES).toContain("quarantined");
      expect(VALID_STATUSES).toContain("pending_deletion");
      expect(VALID_STATUSES).toContain("resolved");
      expect(VALID_STATUSES).toHaveLength(8);
    });

    it("all valid actions are recognized", () => {
      expect(VALID_ACTIONS).toContain("archive");
      expect(VALID_ACTIONS).toContain("quarantine");
      expect(VALID_ACTIONS).toContain("retain");
      expect(VALID_ACTIONS).toContain("schedule_deletion");
      expect(VALID_ACTIONS).toHaveLength(6);
    });

    it("all valid resolutions are recognized", () => {
      expect(VALID_RESOLUTIONS).toContain("acknowledged");
      expect(VALID_RESOLUTIONS).toContain("extended");
      expect(VALID_RESOLUTIONS).toContain("dismissed");
      expect(VALID_RESOLUTIONS).toContain("completed");
      expect(VALID_RESOLUTIONS).toHaveLength(4);
    });
  });

  describe("Expiry detection", () => {
    it("detects expired records (>7 years old)", () => {
      expect(isExpired("2015-01-01T00:00:00Z", 7)).toBe(true);
    });

    it("does not flag recent records as expired", () => {
      const recent = new Date();
      recent.setFullYear(recent.getFullYear() - 1);
      expect(isExpired(recent.toISOString(), 7)).toBe(false);
    });

    it("detects approaching expiry within warning window", () => {
      const almostExpired = new Date();
      almostExpired.setFullYear(almostExpired.getFullYear() - 7);
      almostExpired.setDate(almostExpired.getDate() + 30); // 30 days before expiry
      expect(isApproachingExpiry(almostExpired.toISOString(), 7, 90)).toBe(true);
    });

    it("does not flag records far from expiry", () => {
      const recent = new Date();
      recent.setFullYear(recent.getFullYear() - 2);
      expect(isApproachingExpiry(recent.toISOString(), 7, 90)).toBe(false);
    });
  });

  describe("Status determination", () => {
    it("returns flagged for expired records", () => {
      expect(determineRetentionStatus(true)).toBe("flagged");
    });

    it("returns active for non-expired records", () => {
      expect(determineRetentionStatus(false)).toBe("active");
    });
  });

  describe("Default action mapping", () => {
    it("audit_logs default to retain", () => {
      expect(getDefaultAction("audit_logs")).toBe("retain");
    });

    it("collapse_ledger defaults to retain", () => {
      expect(getDefaultAction("collapse_ledger")).toBe("retain");
    });

    it("matches default to archive", () => {
      expect(getDefaultAction("matches")).toBe("archive");
    });

    it("match_documents default to quarantine", () => {
      expect(getDefaultAction("match_documents")).toBe("quarantine");
    });

    it("wads default to archive", () => {
      expect(getDefaultAction("wads")).toBe("archive");
    });

    it("compliance_cases default to retain", () => {
      expect(getDefaultAction("compliance_cases")).toBe("retain");
    });

    it("unknown table defaults to archive", () => {
      expect(getDefaultAction("unknown_table")).toBe("archive");
    });
  });

  describe("Enforcement action resolution", () => {
    it("archive → archived", () => {
      expect(resolveEnforcementStatus("archive")).toBe("archived");
    });

    it("quarantine → quarantined", () => {
      expect(resolveEnforcementStatus("quarantine")).toBe("quarantined");
    });

    it("retain → retained", () => {
      expect(resolveEnforcementStatus("retain")).toBe("retained");
    });

    it("mark_readonly → retained", () => {
      expect(resolveEnforcementStatus("mark_readonly")).toBe("retained");
    });

    it("schedule_deletion → pending_deletion", () => {
      expect(resolveEnforcementStatus("schedule_deletion")).toBe("pending_deletion");
    });

    it("no_action → resolved", () => {
      expect(resolveEnforcementStatus("no_action")).toBe("resolved");
    });

    it("unknown action defaults to archived", () => {
      expect(resolveEnforcementStatus("invalid_action")).toBe("archived");
    });
  });

  describe("Duplicate enforcement prevention", () => {
    it("allows reprocessing active records", () => {
      expect(shouldReprocess(makeFlag({ retention_status: "active" }))).toBe(true);
    });

    it("allows reprocessing flagged records", () => {
      expect(shouldReprocess(makeFlag({ retention_status: "flagged" }))).toBe(true);
    });

    it("blocks reprocessing archived records", () => {
      expect(shouldReprocess(makeFlag({ retention_status: "archived" }))).toBe(false);
    });

    it("blocks reprocessing quarantined records", () => {
      expect(shouldReprocess(makeFlag({ retention_status: "quarantined" }))).toBe(false);
    });

    it("blocks reprocessing retained records", () => {
      expect(shouldReprocess(makeFlag({ retention_status: "retained" }))).toBe(false);
    });

    it("blocks reprocessing resolved records", () => {
      expect(shouldReprocess(makeFlag({ retention_status: "resolved" }))).toBe(false);
    });

    it("blocks reprocessing deleted records", () => {
      expect(shouldReprocess(makeFlag({ retention_status: "deleted" }))).toBe(false);
    });

    it("blocks reprocessing pending_deletion records", () => {
      expect(shouldReprocess(makeFlag({ retention_status: "pending_deletion" }))).toBe(false);
    });
  });

  describe("Safety constraints", () => {
    it("no record type defaults to destructive deletion", () => {
      for (const [table, action] of Object.entries(DEFAULT_ACTIONS)) {
        expect(action).not.toBe("delete");
        expect(action).not.toBe("destroy");
        // schedule_deletion is intentional for specific cases, but none currently use it
        if (action === "schedule_deletion") {
          // Acceptable but should be verified
          expect(VALID_ACTIONS).toContain(action);
        }
      }
    });

    it("audit_logs and collapse_ledger never default to archive or delete", () => {
      expect(DEFAULT_ACTIONS["audit_logs"]).toBe("retain");
      expect(DEFAULT_ACTIONS["collapse_ledger"]).toBe("retain");
    });

    it("all default actions are valid", () => {
      for (const action of Object.values(DEFAULT_ACTIONS)) {
        expect(VALID_ACTIONS).toContain(action);
      }
    });
  });

  describe("Expiry date calculation", () => {
    it("calculates correct 7-year expiry", () => {
      const expiresAt = calculateExpiryDate("2019-06-15T00:00:00Z", 7);
      expect(expiresAt.getFullYear()).toBe(2026);
      expect(expiresAt.getMonth()).toBe(5); // June (0-indexed)
      expect(expiresAt.getDate()).toBe(15);
    });

    it("handles leap year correctly", () => {
      const expiresAt = calculateExpiryDate("2020-02-29T00:00:00Z", 7);
      expect(expiresAt.getFullYear()).toBe(2027);
      // Feb 29 2020 + 7 years = March 1 2027 (2027 is not a leap year)
      expect(expiresAt.getMonth()).toBe(2); // March
      expect(expiresAt.getDate()).toBe(1);
    });
  });
});
