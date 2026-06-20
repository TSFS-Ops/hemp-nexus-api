#!/usr/bin/env node
/**
 * Batch 6 — AI draft body builder must include the AI-draft label and must
 * not contain any forbidden verification/live wording phrases. Validates the
 * deterministic draft builder template in registry-ai-outreach-draft.
 */
import { readFileSync } from "node:fs";

const src = readFileSync("supabase/functions/registry-ai-outreach-draft/index.ts", "utf8");
const ts = readFileSync("src/lib/registry-outreach.ts", "utf8");

let failed = false;

// Must reference the canonical AI-draft label constant or its content.
if (!src.includes("REGISTRY_OUTREACH_AI_DRAFT_LABEL")) {
  console.error("✗ registry-ai-outreach-draft: missing REGISTRY_OUTREACH_AI_DRAFT_LABEL reference");
  failed = true;
}

// Must run wording safety check before persisting.
if (!src.includes("isDraftWordingSafe")) {
  console.error("✗ registry-ai-outreach-draft: missing isDraftWordingSafe call");
  failed = true;
}

// SSOT must contain the forbidden list.
if (!ts.includes("REGISTRY_OUTREACH_FORBIDDEN_DRAFT_PHRASES")) {
  console.error("✗ SSOT missing REGISTRY_OUTREACH_FORBIDDEN_DRAFT_PHRASES");
  failed = true;
}

if (failed) process.exit(1);
console.log("✓ Batch 6 outreach forbidden-wording guard passed");
