#!/usr/bin/env node
/**
 * Facilitation Batch 10 — Evidence-Pack Seal Contract Guard.
 *
 * Fails if any of the following drift:
 *   1. The shared sealing helper file is missing.
 *   2. The helper no longer exports the expected symbols
 *      (canonicalJsonStringify, sha256OfCanonicalPack, sealEvidencePack,
 *       isEvidencePackSeal, SEAL_ALGO, SEAL_FUNCTION_VERSION).
 *   3. The export function no longer imports the sealer.
 *   4. The export function no longer wraps its response with `sealEvidencePack`.
 *   5. The export function returns the raw pack instead of the sealed envelope
 *      (heuristic: the success-path `json(req, ...)` returns a value other
 *      than `sealed`).
 *   6. The canonical audit name `facilitation_case.evidence_pack_sealed`
 *      is missing from either SSOT (Deno or browser mirror).
 *
 * This guard runs in the prebuild chain alongside the other facilitation
 * drift guards.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const errors = [];

// ── 1. helper file exists ────────────────────────────────────────────────
const HELPER = "supabase/functions/_shared/evidence-pack-seal.ts";
const helperPath = resolve(ROOT, HELPER);
if (!existsSync(helperPath)) {
  errors.push(`Missing shared sealing helper: ${HELPER}`);
} else {
  // ── 2. expected exports ────────────────────────────────────────────────
  const src = readFileSync(helperPath, "utf8");
  const required = [
    "export const SEAL_ALGO",
    "export const SEAL_FUNCTION_VERSION",
    "export function canonicalJsonStringify",
    "export async function sha256OfCanonicalPack",
    "export async function sealEvidencePack",
    "export function isEvidencePackSeal",
  ];
  for (const sig of required) {
    if (!src.includes(sig)) errors.push(`${HELPER}: missing export signature \`${sig}\``);
  }
  if (!src.includes('"sha-256"')) errors.push(`${HELPER}: SEAL_ALGO must be the literal "sha-256"`);
}

// ── 3+4+5. export function wiring ────────────────────────────────────────
const EXPORT_FN = "supabase/functions/facilitation-export-evidence-pack/index.ts";
const exportFnPath = resolve(ROOT, EXPORT_FN);
if (!existsSync(exportFnPath)) {
  errors.push(`Missing edge function: ${EXPORT_FN}`);
} else {
  const src = readFileSync(exportFnPath, "utf8");
  if (!src.includes('from "../_shared/evidence-pack-seal.ts"')) {
    errors.push(`${EXPORT_FN}: missing import of \`../_shared/evidence-pack-seal.ts\``);
  }
  if (!src.includes("sealEvidencePack(")) {
    errors.push(`${EXPORT_FN}: missing call to \`sealEvidencePack(...)\``);
  }
  // The success-path response MUST return the sealed envelope, not the raw pack.
  // We require a return-line of the form `return json(req, sealed, 200, ...)`.
  if (!/return json\(req,\s*sealed,\s*200/.test(src)) {
    errors.push(`${EXPORT_FN}: success-path response must be \`return json(req, sealed, 200, ...)\` — never the raw pack.`);
  }
  // Defensive: forbid the legacy raw-pack return signature.
  if (/return json\(req,\s*pack,\s*200/.test(src)) {
    errors.push(`${EXPORT_FN}: legacy unsealed return \`json(req, pack, 200, ...)\` is forbidden — wrap the pack with sealEvidencePack.`);
  }
  // Audit row must be written.
  if (!src.includes('"facilitation_case.evidence_pack_sealed"')) {
    errors.push(`${EXPORT_FN}: missing audit insert with action "facilitation_case.evidence_pack_sealed".`);
  }
}

// ── 6. canonical audit name pinned in both SSOTs ─────────────────────────
const SSOT_FILES = [
  "supabase/functions/_shared/facilitation-case-state.ts",
  "src/lib/facilitation-case-state.ts",
];
for (const f of SSOT_FILES) {
  const p = resolve(ROOT, f);
  if (!existsSync(p)) { errors.push(`Missing SSOT file: ${f}`); continue; }
  const src = readFileSync(p, "utf8");
  if (!src.includes('"facilitation_case.evidence_pack_sealed"')) {
    errors.push(`${f}: missing canonical audit name "facilitation_case.evidence_pack_sealed"`);
  }
}

if (errors.length) {
  console.error("[check-evidence-pack-seal-contract] FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("[check-evidence-pack-seal-contract] OK");
