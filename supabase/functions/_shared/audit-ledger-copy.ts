/**
 * Deno-safe twin of the SAFE_LEDGER_COPY primitives used by edge-function
 * surfaces (email templates, webhook responses) that cannot import from
 * `src/`. Keep these strings byte-identical to the browser SSOT in
 * `src/lib/policy/audit-ledger-capability.ts`. A drift guard in
 * `src/tests/audit-ledger-copy-capability-guard.test.ts` asserts equality.
 *
 * Copy-only. No runtime side effects.
 */

export const ACCEPTANCE_RECEIPT_CLAUSE =
  "The acceptance has been recorded as a hash-sealed, cryptographically signed receipt in the tamper-evident audit trail.";

export const WAD_AWAITING_SIGNATURE_LABEL =
  "AWAITING YOUR HASH-SEALED SIGNATURE";
