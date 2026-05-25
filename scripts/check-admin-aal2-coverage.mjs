#!/usr/bin/env node
/**
 * Batch E — MFA / AAL2 drift guard for sensitive admin endpoints.
 *
 * Cross-checks that every endpoint in SENSITIVE_ENDPOINTS:
 *   1. exists on disk;
 *   2. imports or calls `assertAal2` (directly or via aal-preflight); and
 *   3. emits a governance / audit event via one of the accepted writer
 *      surfaces (canonical writer, admin_audit_logs / audit_logs insert,
 *      or a shared helper that itself wraps the canonical writer).
 *
 * Failure modes (exit 1):
 *   - sensitive endpoint exists but never references `assertAal2`;
 *   - sensitive endpoint exists but never references any approved
 *     governance / audit writer surface.
 *
 * Soft modes (exit 0):
 *   - sensitive endpoint is not present on disk → reported as NOT PRESENT;
 *   - extra `admin-*` endpoints not on the sensitive list → reported as
 *     INFO so reviewers can decide whether to promote them.
 *
 * Out of scope (will NOT be flagged):
 *   - payment webhook endpoints (`paystack-webhook` etc.) — signed by the
 *     provider, not subject to interactive AAL2;
 *   - read-only/dev admin helpers (`admin-engagement-delivery-status`,
 *     `admin-user-journey`, `admin-notification-preferences`,
 *     `admin-demo-workspace-*`, `admin-org-reconciliation`,
 *     `admin-match-legacy-*`, `admin-users`) — exempted by name below.
 *
 * Wiring: invoked via `npm run check:admin-aal2` and added to `prebuild`.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FUNCTIONS_DIR = join(ROOT, "supabase", "functions");

/** Endpoints that MUST have AAL2 + a governance/audit writer. */
const SENSITIVE_ENDPOINTS = [
  // Money / refund
  "admin-refund-approve",
  "admin-refund-decline",
  "admin-payment-dispute-record",
  "admin-payment-dispute-resolve-won",
  "admin-payment-dispute-resolve-lost",
  // Billing holds
  "admin-billing-hold-apply",
  "admin-billing-hold-release",
  // Compliance / residency holds
  "admin-compliance-hold-release",
  "admin-compliance-hold-close",
  "admin-residency-review-approve",
  "admin-residency-review-decline",
  // Credits
  "admin-credit-org",
  // Trade-request exceptions
  "admin-trade-request-exception-hold-release",
  "admin-trade-request-archive-override",
  // Corrections / overrides
  "admin-counterparty-corrections",
  "admin-match-corrections",
  "admin-manual-overrides",
  // Legal hold
  "admin-legal-hold",
  // Governance Record privileged writes
  "governance-waiver-grant",
  "hq-note-add",
  // Export / data lifecycle
  "export-audit",
  "export-download",
  "admin-export-approve",
  "admin-export-request",
  // Account self-deletion (privileged path: hits auth.admin)
  "delete-account",
];

/**
 * Admin-* functions explicitly exempted from this guard (read-only or
 * developer / fixture surfaces). Anything not listed here and not on the
 * sensitive list is reported as INFO so reviewers can decide.
 */
const EXEMPT_ADMIN_FUNCTIONS = new Set([
  "admin-engagement-delivery-status", // read-only Resend status mapper
  "admin-user-journey",               // read-only diagnostics
  "admin-notification-preferences",   // self-serve user prefs proxy
  "admin-org-reconciliation",         // read-only reconciliation report
  "admin-run-lifecycle",              // cron trigger; writes audit log; no UI surface
  "admin-users",                      // read-only user list
  "admin-demo-workspace-create",
  "admin-demo-workspace-reset",
  "admin-demo-workspace-archive",
  "admin-match-legacy-archive",
  "admin-match-legacy-record-detections",
  "admin-match-legacy-repair",
]);

/** Regexes that count as "imports or calls assertAal2". */
const AAL_PATTERNS = [
  /\bassertAal2\b/,
  /\baal-preflight\b/,
  /from\s+["'][^"']*\/aal\.ts["']/,
];

/**
 * Regexes that count as a governance/audit writer surface. Any one match
 * inside the endpoint folder is enough — we are checking for *presence*
 * of an audit trail, not its semantic correctness (that is covered by the
 * canonical-writer and policy-version tests).
 */
const GOV_WRITER_PATTERNS = [
  /\bwriteCriticalEventWithPosture\b/,
  /\bwriteCriticalGovernanceEvent\b/,
  /\bwriteGovernanceEventBestEffort\b/,
  /\brecordAdminHqDecision\b/,
  /\bgrantGovernanceWaiver\b/,
  /\brenewGovernanceWaiver\b/,
  /\bconsumeGovernanceWaiver\b/,
  /\.from\(\s*["']audit_logs["']\s*\)\s*\.insert\b/,
  /\.from\(\s*["']admin_audit_logs["']\s*\)\s*\.insert\b/,
  /\.from\(\s*["']event_store["']\s*\)\s*\.insert\b/,
  // Shared audit helpers — any import from a `_shared/*audit*.ts` module
  // is treated as evidence the endpoint emits through a vetted writer.
  // The shared helper itself is responsible for the actual DB insert and
  // is independently covered by canonical-writer / policy-version tests.
  /from\s+["'][^"']*_shared\/[^"']*audit[^"']*["']/,
  /from\s+["'][^"']*_shared\/export-lifecycle-audit[^"']*["']/,
  /from\s+["'][^"']*_shared\/legal-hold[^"']*["']/,
  // Atomic RPC wrappers that perform the governance/audit write inside a
  // single SECURITY DEFINER transaction (Batch F atomicity series). The
  // underlying RPC writes to event_store; the edge function is satisfied
  // by invoking the *_with_governance wrapper.
  /\.rpc\(\s*["'][a-z0-9_]+_with_governance["']/,
];

function readAllSourceUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...readAllSourceUnder(full));
    } else if (
      (name.endsWith(".ts") || name.endsWith(".mjs") || name.endsWith(".js")) &&
      !/(?:_test|\.test)\.[tj]s$/.test(name)
    ) {
      out.push({ path: full, src: readFileSync(full, "utf8") });
    }
  }
  return out;
}

function matchesAny(src, patterns) {
  return patterns.some((p) => p.test(src));
}

function checkEndpoint(name) {
  const dir = join(FUNCTIONS_DIR, name);
  if (!existsSync(dir)) {
    return { name, present: false };
  }
  const files = readAllSourceUnder(dir);
  const combined = files.map((f) => f.src).join("\n");
  const hasAal = matchesAny(combined, AAL_PATTERNS);
  const hasGov = matchesAny(combined, GOV_WRITER_PATTERNS);
  return { name, present: true, hasAal, hasGov };
}

function listAdminFunctionsOnDisk() {
  return readdirSync(FUNCTIONS_DIR).filter((n) => {
    const full = join(FUNCTIONS_DIR, n);
    return statSync(full).isDirectory() && n.startsWith("admin-");
  });
}

function pad(s, n) {
  s = String(s);
  return s + " ".repeat(Math.max(0, n - s.length));
}

function main() {
  const results = SENSITIVE_ENDPOINTS.map(checkEndpoint);
  const failures = [];

  console.log("\nBatch E — MFA/AAL2 Drift Check (sensitive admin endpoints)\n");
  console.log(
    pad("ENDPOINT", 50) +
      pad("PRESENT", 10) +
      pad("AAL2", 8) +
      pad("GOV/AUDIT", 12),
  );
  console.log("-".repeat(80));
  for (const r of results) {
    if (!r.present) {
      console.log(
        pad(r.name, 50) + pad("no", 10) + pad("-", 8) + pad("-", 12) + "  (NOT PRESENT — skipped)",
      );
      continue;
    }
    const aalCell = r.hasAal ? "yes" : "MISSING";
    const govCell = r.hasGov ? "yes" : "MISSING";
    console.log(
      pad(r.name, 50) + pad("yes", 10) + pad(aalCell, 8) + pad(govCell, 12),
    );
    if (!r.hasAal) failures.push(`${r.name}: missing assertAal2`);
    if (!r.hasGov) failures.push(`${r.name}: missing governance/audit writer`);
  }

  // INFO: admin-* functions on disk that are neither sensitive nor exempted.
  const known = new Set([
    ...SENSITIVE_ENDPOINTS.filter((n) => n.startsWith("admin-")),
    ...EXEMPT_ADMIN_FUNCTIONS,
  ]);
  const unclassified = listAdminFunctionsOnDisk().filter((n) => !known.has(n));
  if (unclassified.length > 0) {
    console.log("\nINFO — unclassified admin-* functions (decide: sensitive or exempt):");
    for (const n of unclassified) console.log(`  - ${n}`);
  }

  if (failures.length > 0) {
    console.error("\nFAIL — MFA/AAL2 drift detected:");
    for (const f of failures) console.error(`  - ${f}`);
    console.error("\nFix: import { assertAal2 } from '../_shared/aal.ts' and add the relevant");
    console.error("action key in supabase/functions/aal-preflight/index.ts, and emit a canonical");
    console.error("governance event or audit_logs insert from the endpoint before returning 200.\n");
    process.exit(1);
  }

  console.log("\nOK — all sensitive admin endpoints present have assertAal2 + a governance/audit writer.\n");
}

main();
