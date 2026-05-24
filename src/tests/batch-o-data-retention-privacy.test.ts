/**
 * Batch O — Data retention, privacy and audit-integrity hardening.
 *
 * Static source-contract tests. Mirrors the Batch O approved scope:
 *
 *   1.  audit_logs UPDATE blocked by AUDIT_IMMUTABLE trigger
 *   2.  audit_logs DELETE blocked by AUDIT_IMMUTABLE trigger
 *   3.  admin_audit_logs UPDATE blocked
 *   4.  admin_audit_logs DELETE blocked
 *   5.  audit INSERT still allowed (trigger is BEFORE UPDATE OR DELETE only)
 *   6.  redactExportMetadata strips actor_ip / ip_address / user_agent / request_id / payment_reference
 *   7.  redactExportMetadata strips any *_token / *_secret / *_key / *_password / *_hash
 *   8.  AdminAuditLogs export uses redactExportMetadata
 *   9.  MatchesList / Outreach CSV exports do NOT dump raw metadata blobs
 *  10.  AdminAuditLogs export records export.csv audit row BEFORE writing CSV
 *  11.  Sensitive exports gate on AAL2 (aal_required surfaces a toast block)
 *  12.  delete-account calls scrub_user_pii
 *  13.  scrub_user_pii anonymises email_send_log.recipient_email
 *  14.  scrub_user_pii scrubs notification payload (title/body/link)
 *  15.  account-deletion-sweeper handles auth.users email anonymisation explicitly
 *  16.  email_send_log TTL anonymisation function + edge job exist
 *  17.  TTL job writes its own run-summary admin audit row
 *  18.  enqueue-storage-cleanup rejects active match_documents reference with ACTIVE_EVIDENCE_PROTECTED
 *  19.  enqueue-storage-cleanup rejects active WaD evidence_bundle reference
 *  20.  Blocked cleanup writes ACTIVE_EVIDENCE_PROTECTED admin audit row
 *  21.  data-retention dry-run path supported (counts without mutation)
 *  22.  Sensitive admin export requires reason/AAL2 in export-audit
 *  23.  admin_audit_logs writes from key admin paths carry ip + user_agent
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  redactExportMetadata,
} from "@/lib/download-utils";

function read(p: string): string {
  return readFileSync(resolve(p), "utf8");
}

const MIGRATION_GLOB = "supabase/migrations";
function findMigration(snippet: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("node:fs") as typeof import("node:fs");
  const files = fs.readdirSync(MIGRATION_GLOB).filter((f) => f.endsWith(".sql"));
  for (const f of files) {
    const body = fs.readFileSync(resolve(MIGRATION_GLOB, f), "utf8");
    if (body.includes(snippet)) return body;
  }
  return "";
}

describe("Batch O — audit immutability triggers", () => {
  const migration = findMigration("assert_audit_immutable");

  it("[1/2] migration creates trigger blocking UPDATE/DELETE on audit_logs", () => {
    expect(migration).toContain("audit_logs_no_mutate_trg");
    expect(migration).toMatch(/BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+public\.audit_logs/);
  });

  it("[3/4] migration creates trigger blocking UPDATE/DELETE on admin_audit_logs", () => {
    expect(migration).toContain("admin_audit_logs_no_mutate_trg");
    expect(migration).toMatch(/BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+public\.admin_audit_logs/);
  });

  it("[5] INSERT is NOT in trigger event list (insert remains allowed)", () => {
    // Trigger declarations must list only UPDATE OR DELETE — never INSERT.
    const triggerDecls = migration.match(/BEFORE[^;]+EXECUTE FUNCTION public\.assert_audit_immutable/g) ?? [];
    expect(triggerDecls.length).toBeGreaterThanOrEqual(2);
    for (const decl of triggerDecls) {
      expect(decl).not.toMatch(/\bINSERT\b/);
    }
  });

  it("trigger raises AUDIT_IMMUTABLE error", () => {
    expect(migration).toContain("AUDIT_IMMUTABLE");
  });

  it("trigger fires for service_role too (no role-bypass logic)", () => {
    // The function body must not check auth.role() / current_user to skip.
    const fnBody = migration.split("assert_audit_immutable")[2] ?? "";
    expect(fnBody).not.toMatch(/auth\.role\(\)\s*=\s*'service_role'/);
  });
});

describe("Batch O — redactExportMetadata", () => {
  it("[6] strips actor_ip / ip_address / user_agent / request_id / payment_reference", () => {
    const out = redactExportMetadata({
      actor_ip: "1.2.3.4",
      ip_address: "1.2.3.4",
      user_agent: "Mozilla/5.0",
      request_id: "abc-123",
      payment_reference: "PAY-XYZ",
      kept: "ok",
    }) as Record<string, unknown>;
    expect(out.actor_ip).toBe("[redacted]");
    expect(out.ip_address).toBe("[redacted]");
    expect(out.user_agent).toBe("[redacted]");
    expect(out.request_id).toBe("[redacted]");
    expect(out.payment_reference).toBe("[redacted]");
    expect(out.kept).toBe("ok");
  });

  it("[7] strips any *_token / *_secret / *_key / *_password / *_hash suffix", () => {
    const out = redactExportMetadata({
      access_token: "xxx",
      refresh_token: "xxx",
      webhook_secret: "xxx",
      api_key: "sk_xxx",
      service_role_key: "xxx",
      user_password: "xxx",
      seal_hash: "xxx",
      signature: "xxx",
      authorization_url: "https://...",
      access_code: "...",
      visible_field: "ok",
    }) as Record<string, unknown>;
    for (const k of [
      "access_token", "refresh_token", "webhook_secret", "api_key",
      "service_role_key", "user_password", "seal_hash", "signature",
      "authorization_url", "access_code",
    ]) {
      expect(out[k]).toBe("[redacted]");
    }
    expect(out.visible_field).toBe("ok");
  });

  it("recurses into nested objects and arrays", () => {
    const out = redactExportMetadata({
      inner: { api_key: "sk_x", ok: 1 },
      items: [{ access_token: "tok", label: "L" }],
    }) as Record<string, unknown>;
    expect((out.inner as Record<string, unknown>).api_key).toBe("[redacted]");
    expect((out.inner as Record<string, unknown>).ok).toBe(1);
    expect(((out.items as Array<Record<string, unknown>>)[0]).access_token).toBe("[redacted]");
    expect(((out.items as Array<Record<string, unknown>>)[0]).label).toBe("L");
  });
});

describe("Batch O — CSV export wiring", () => {
  const auditPanel = read("src/components/admin/AdminAuditLogs.tsx");
  const outreach = read("src/components/admin/AdminOutreachBlocksPanel.tsx");
  const matches = read("src/components/MatchesList.tsx");

  it("[8] AdminAuditLogs CSV uses redactExportMetadata", () => {
    expect(auditPanel).toContain("redactExportMetadata");
    expect(auditPanel).toMatch(/redactExportMetadata\(log\.metadata/);
  });

  it("[9] MatchesList export does not dump raw metadata", () => {
    // The CSV row construction must not splat `m.metadata` directly.
    expect(matches).not.toMatch(/downloadCSV\([\s\S]{0,400}m\.metadata/);
  });

  it("[9b] Outreach export only emits safe panel columns (no raw metadata)", () => {
    // The outreach exporter must not stringify a raw metadata blob.
    expect(outreach).not.toMatch(/JSON\.stringify\(\s*r\.metadata/);
  });

  it("[10] AdminAuditLogs records export audit BEFORE writing CSV", () => {
    // Batch U AUD-018: the panel routes through `auditedDownloadCSV` (wrapper
    // that re-asserts the prebuild CSV-audit guard). The audit MUST still be
    // emitted before the CSV is serialised/downloaded.
    expect(auditPanel).toContain("recordExportAudit");
    const idxAudit = auditPanel.indexOf("recordExportAudit(");
    const idxDownload = auditPanel.indexOf("auditedDownloadCSV(headers, rows");
    expect(idxAudit).toBeGreaterThan(-1);
    expect(idxDownload).toBeGreaterThan(idxAudit);
    // Guard against regression: the panel must NOT call the raw `downloadCSV(`
    // helper directly, which would bypass the audit wrapper.
    expect(auditPanel).not.toMatch(/(?<!audited)downloadCSV\(/);
  });

  it("[11] AAL2 rejection blocks the export and surfaces a toast", () => {
    expect(auditPanel).toContain("aal_required");
    expect(auditPanel).toMatch(/AAL2/);
  });
});

describe("Batch O — export-audit edge function", () => {
  const fn = read("supabase/functions/export-audit/index.ts");

  it("[22] sensitive targets require AAL2", () => {
    // Current contract (post-SEC-001): export-audit uses a fail-closed
    // allowlist (`NON_SENSITIVE_TARGETS`); anything not on it is treated as
    // sensitive and routed through the shared `assertAal2` helper, which
    // returns 403 `aal_required: true` / `code: "MFA_REQUIRED"` for aal1 JWTs.
    expect(fn).toContain("NON_SENSITIVE_TARGETS");
    expect(fn).toMatch(/!\s*NON_SENSITIVE_TARGETS\.has\(\s*input\.target_type\s*\)/);
    expect(fn).toMatch(/assertAal2\(/);
    expect(fn).toContain("aal_required: true");
    expect(fn).toMatch(/code:\s*["']MFA_REQUIRED["']/);
    // The underlying AAL detection lives in the shared helper. It reads the
    // `aal` claim off the JWT rather than calling GoTrue's
    // `getAuthenticatorAssuranceLevel`, so assert the helper surface that
    // export-audit actually depends on.
    const aalShared = read("supabase/functions/_shared/aal.ts");
    expect(aalShared).toMatch(/export\s+(async\s+)?function\s+assertAal2\b/);
    expect(aalShared).toMatch(/export\s+function\s+readAal\b/);
  });

  it("records export.csv in audit_logs with actor + filters_hash", () => {
    expect(fn).toMatch(/action:\s*`export\.\$\{input\.format\}`/);
    expect(fn).toContain("filters_hash");
    expect(fn).toContain("actor_user_id: user.id");
  });

  it("captures actor_ip and user_agent in metadata", () => {
    expect(fn).toContain("actor_ip");
    expect(fn).toContain("user_agent");
  });
});

describe("Batch O — delete-account PII scrub", () => {
  const fn = read("supabase/functions/delete-account/index.ts");
  const migration = findMigration("scrub_user_pii");

  it("[12] delete-account invokes scrub_user_pii RPC", () => {
    expect(fn).toContain("scrub_user_pii");
    expect(fn).toMatch(/rpc\(["']scrub_user_pii["']/);
  });

  it("[13] scrub_user_pii SQL anonymises email_send_log.recipient_email", () => {
    expect(migration).toContain("scrub_user_pii");
    expect(migration).toMatch(/UPDATE\s+public\.email_send_log[\s\S]+recipient_email\s*=/);
  });

  it("[14] scrub_user_pii SQL scrubs notification title/body/link", () => {
    expect(migration).toMatch(/UPDATE\s+public\.notifications[\s\S]+title\s*=\s*'\[scrubbed\]'/);
    expect(migration).toMatch(/body\s*=\s*NULL/);
    expect(migration).toMatch(/link\s*=\s*NULL/);
  });

  it("scrub writes admin audit row 'account.pii_scrubbed'", () => {
    expect(migration).toContain("account.pii_scrubbed");
  });

  it("[9-via-delete-account] delete-account includes user_agent in admin audit", () => {
    expect(fn).toMatch(/user_agent:/);
  });
});

describe("Batch O — account-deletion-sweeper auth user anonymisation", () => {
  const fn = read("supabase/functions/account-deletion-sweeper/index.ts");

  it("[15] sweeper anonymises auth.users.email before hard-delete", () => {
    expect(fn).toMatch(/updateUserById\(userId,\s*\{[\s\S]+email:/);
    expect(fn).toContain("hard-deleted+");
  });

  it("[15b] sweeper re-runs scrub_user_pii at hard-delete time", () => {
    expect(fn).toContain("scrub_user_pii");
  });
});

describe("Batch O — email_send_log TTL anonymisation", () => {
  const migration = findMigration("anonymise_old_email_send_log");
  const fn = read("supabase/functions/email-log-anonymise/index.ts");

  it("[16] anonymise_old_email_send_log SQL function exists", () => {
    expect(migration).toContain("anonymise_old_email_send_log");
    expect(migration).toMatch(/UPDATE\s+public\.email_send_log[\s\S]+'scrubbed-aged@/);
  });

  it("[16b] email-log-anonymise edge function exists and calls the RPC", () => {
    expect(fn).toContain("anonymise_old_email_send_log");
    expect(fn).toMatch(/x-internal-key|service_role/);
  });

  it("[17] TTL job writes run-summary admin audit row", () => {
    expect(migration).toContain("email_log.ttl_anonymised");
  });

  it("function supports dry-run mode", () => {
    expect(migration).toMatch(/p_dry_run\s+boolean\s+DEFAULT\s+false/);
    expect(fn).toContain("p_dry_run");
  });
});

describe("Batch O — enqueue-storage-cleanup active-evidence guard", () => {
  const fn = read("supabase/functions/enqueue-storage-cleanup/index.ts");

  it("[18] rejects active match_documents reference with ACTIVE_EVIDENCE_PROTECTED", () => {
    expect(fn).toContain("ACTIVE_EVIDENCE_PROTECTED");
    expect(fn).toContain("match_documents");
  });

  it("[18b] also checks governance_documents", () => {
    expect(fn).toContain("governance_documents");
  });

  it("[19] rejects active WaD evidence_bundle reference", () => {
    expect(fn).toMatch(/from\(["']wads["']\)/);
    expect(fn).toContain("evidence_bundle");
  });

  it("[20] blocked cleanup writes ACTIVE_EVIDENCE_PROTECTED admin audit row", () => {
    expect(fn).toMatch(/storage\.cleanup_blocked/);
    expect(fn).toMatch(/code:\s*["']ACTIVE_EVIDENCE_PROTECTED["']/);
  });

  it("returns 409 status when active evidence found", () => {
    expect(fn).toMatch(/status:\s*409/);
  });
});

describe("Batch O — data-retention dry-run + admin audit user_agent", () => {
  it("[21] data-retention is conservative (status flips only, no physical delete)", () => {
    const fn = read("supabase/functions/data-retention/index.ts");
    // No DELETE FROM in the retention job body — it must only soft-archive.
    expect(fn).not.toMatch(/\.delete\(\)\.eq\(/);
  });

  it("[23] admin_audit_logs schema carries user_agent column (migration)", () => {
    const migration = findMigration("admin_audit_logs\n  ADD COLUMN IF NOT EXISTS user_agent");
    expect(migration).toContain("user_agent");
  });

  it("[23b] delete-account writes user_agent in admin_audit_logs insert", () => {
    const fn = read("supabase/functions/delete-account/index.ts");
    expect(fn).toMatch(/user_agent:[^,]+slice\(0,\s*500\)/);
  });
});
