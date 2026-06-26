#!/usr/bin/env node
/**
 * P-5 Screening — Phase 1 SSOT guard.
 * Pins registry literals so drift fails the build.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve("src/lib/p5-screening/registry.ts");
const src = readFileSync(file, "utf8");

const REQUIRED_CATEGORIES = [
  "company_aml_sanctions",
  "pep",
  "watchlist_name",
  "idv_person",
  "adverse_media_admin_triggered",
];

const REQUIRED_STATES = [
  "not_required",
  "not_started",
  "screening_pending",
  "idv_pending",
  "provider_pending",
  "manual_review_required",
  "screening_expired",
  "cleared",
  "cleared_with_conditions",
  "failed",
  "rejected",
];

const REQUIRED_GATES = [
  "poi_create",
  "poi_accept",
  "wad_create",
  "wad_seal",
  "trade_approval",
  "funder_visibility",
  "funder_ready",
  "finality",
  "api_ready_true",
];

const REQUIRED_ALLOWED_WORDING = [
  "Screening pending",
  "Provider pending",
  "Manual review required",
  "Action required",
  "Identity verification required",
  "Transaction blocked pending review",
  "Screening expired",
  "Not ready - counterparty checks pending",
  "WaD blocked pending verification",
  "Finality blocked pending verification",
];

const REQUIRED_BANNED_WORDING = [
  "sanctions hit",
  "sanctioned",
  "pep hit",
  "blacklisted",
  "fraud",
  "criminal",
  "high risk",
  "match confirmed",
  "blocked permanently",
  "illegal",
  "suspicious",
  "guilty",
  "raw provider result",
  "match score",
  "list name",
];

const REQUIRED_API_SAFE = [
  "ready",
  "readiness_status",
  "blockers",
  "affected_party",
  "affected_check",
  "last_checked_at",
  "expires_at",
  "admin_review_required",
  "provider_pending",
  "retry_pending",
];

const REQUIRED_MEMORY_BANNED = [
  "raw_provider_payload",
  "id_image",
  "selfie",
  "biometric",
  "unresolved_possible_match",
  "provider_pending_state",
  "raw_adverse_media",
];

const errors = [];
function expectAll(label, items) {
  for (const item of items) {
    if (!src.includes(`"${item}"`)) errors.push(`${label}: missing "${item}"`);
  }
}

expectAll("category", REQUIRED_CATEGORIES);
expectAll("state", REQUIRED_STATES);
expectAll("gate", REQUIRED_GATES);
expectAll("allowed-wording", REQUIRED_ALLOWED_WORDING);
expectAll("banned-wording", REQUIRED_BANNED_WORDING);
expectAll("api-safe-field", REQUIRED_API_SAFE);
expectAll("memory-banned-kind", REQUIRED_MEMORY_BANNED);

if (!src.includes("P5_SCR_SCREENING_REUSE_MAX_AGE_DAYS = 90")) {
  errors.push("reuse window must be pinned to 90 days");
}

if (errors.length) {
  console.error("P-5 Screening Phase 1 SSOT guard FAILED:");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log("P-5 Screening Phase 1 SSOT guard OK");
