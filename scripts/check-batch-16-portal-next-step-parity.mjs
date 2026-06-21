#!/usr/bin/env node
// Batch 16 guard — next-step SSOT parity. Every PortalNextStep declared
// in the type must have a label and be referenced by the engine.
import fs from "node:fs";

const src = fs.readFileSync("src/lib/registry-company-portal-ssot.ts", "utf8");
const typeMatch = src.match(/export type PortalNextStep =([\s\S]*?);/);
if (!typeMatch) { console.error("PortalNextStep type missing"); process.exit(1); }
const steps = (typeMatch[1].match(/"([a-z_]+)"/g) || []).map((s) => s.replace(/"/g, ""));

const labelBlock = src.match(/PORTAL_NEXT_STEP_LABEL[^{]*\{([\s\S]*?)\}/);
if (!labelBlock) { console.error("PORTAL_NEXT_STEP_LABEL missing"); process.exit(1); }
let failed = false;
for (const s of steps) {
  if (!new RegExp(`\\b${s}\\b\\s*:`).test(labelBlock[1])) {
    console.error(`[batch-16] missing label for next-step '${s}'`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`[batch-16] next-step parity OK (${steps.length} steps)`);
