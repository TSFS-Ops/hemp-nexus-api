/**
 * Audit Ledger — public-copy capability flag (SSOT).
 *
 * Strong immutability wording ("immutable", "tamper-proof", "append-only",
 * "audit-proof", "9-gate verified", "9/9 gates passed", "mathematically
 * provable", "eradicate fraud", live "hash-chained") may only appear in
 * public/product-facing copy when the backend actually enforces:
 *
 *   1. UPDATE/DELETE/TRUNCATE blocked on every claimed ledger table
 *      (audit_logs, admin_audit_logs, token_ledger, match_events,
 *       poi_events, wads.seal_hash, collapse_ledger, break_glass_actions, …)
 *      with no session-variable / GUC / owner-droppable bypass.
 *   2. An automated hash-chain verifier (cron) that proves the chain is
 *      intact and raises a risk item on mismatch.
 *   3. A capability surface that this flag is wired to so copy cannot drift
 *      from reality.
 *
 * Today none of (1)-(3) are fully in place, so this flag MUST be `false`.
 * Do not flip to `true` without a separate hardening programme that lands
 * the triggers, removes the `app.allow_audit_cleanup` GUC bypass, locks
 * trigger ownership, and ships the verifier cron + tests.
 *
 * This file is presentation/copy containment only. It does NOT change any
 * database, RLS, grant, trigger, payment, refund, POI, WaD, registry,
 * lifecycle, reconciliation, or infra alert behaviour.
 */

export const IMMUTABILITY_BACKEND_ENFORCED = false;

/**
 * Safe, accurate public-copy primitives. Use these instead of absolute
 * trust claims until `IMMUTABILITY_BACKEND_ENFORCED` is true.
 */
export const SAFE_LEDGER_COPY = {
  shortTagline: "Tamper-evident · Hash-sealed · Bank-ready exports",
  productHero: "Tamper-evident ledger for trade finance.",
  sealBadge: "Hash-sealed · 256-bit",
  productSummary:
    "Tamper-evident, hash-sealed deal records",
  financeSolutionSummary:
    "De-risk letters of credit with tamper-evident, hash-sealed proof.",
  sampleHashLabel: "Sample SHA-256 Seal",
  sampleVerifyLine: "Sample · Match A1B2C3D4 · evidence pack",
  sovereignsTagline:
    "Single approved production-region policy · Tamper-evident ledger · Macro telemetry",
  sovereignsEventStream: "Tamper-evident event stream",
  sovereignsProvenance: "Tamper-evident provenance",
  sovereignsFraudCopy:
    "Every disbursement is gated by milestone verification. Every signature is bound to a verified principal. Every event is hash-sealed, making tampering detectable.",
  sovereignsHashChainBullet: "Hash-sealed event store",
  tradersSealBadge: "SHA-256 Hash-Sealed Record",
  tradersBullets: [
    "Versioned commercial terms",
    "Bilateral signature collapse",
    "Tamper-evident audit trail",
    "SHA-256 sealed at issuance",
  ],
  wadModuleDescription: "Hash-sealed evidence bundle for this intent",
  wadModuleDescriptionCreate: "Create a hash-sealed evidence bundle for this intent",
  wadModuleBullets: [
    "Search query and match context",
    "Trade request timestamps and parties",
    "Document hashes and evidence bundle",
    "Multi-party attestations",
    "Tamper-evident seal",
  ],
  wadModuleIntro:
    "Signed Deal creates an auditable, tamper-evident record that packages the full evidence trail for this trade request. It includes:",
  wadStepperCertificateNote:
    "PDF certificate includes all attestations, evidence bundle hashes, seal verification data, and a tamper-evident verification section.",
  /**
   * Bind-accept confirmation clause. Replaces the prior overclaim
   * "The action is hash-sealed and recorded, and cannot be reversed."
   * which implied DB-enforced immutability the backend does not yet
   * provide on `wads`/`wad_attestations`. Uses the "governed correction
   * process" framing so the wording stays accurate without leaning on
   * any banned phrase (no "reversed", no "immutable").
   */
  wadAcceptBindIrreversibilityClause:
    "This action is recorded in the tamper-evident audit trail. Changes must follow the governed correction process.",
} as const;

/**
 * Banned phrases for the copy guard. Public/product surfaces under
 * src/pages and src/components must not contain these unless a future
 * capability flag is true.
 */
export const BANNED_TRUST_PHRASES = [
  "Immutable",
  "immutable",
  "Tamper-Proof",
  "tamper-proof",
  "tamper-proofally",
  "Append-only",
  "append-only",
  "audit-proof",
  "9-gate verified",
  "9/9 gates passed",
  "mathematically provable",
  "eradicate fraud",
] as const;
