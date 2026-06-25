#!/usr/bin/env node
/**
 * P-5 Batch 4 — Stage 7 isolation guard.
 *
 * Stage 7 legitimately adds:
 *   - src/lib/p5-batch4/notifications.ts        (pure router)
 *   - src/lib/p5-batch4/reports.ts              (pure projections)
 *   - src/lib/p5-batch4/finality-bridge.ts      (pure opt-in gate)
 *   - src/lib/p5-batch4/memory-bridge.ts        (pure opt-in gate)
 *   - supabase/functions/p5-batch4-sla-monitor  (internal-key gated cron)
 *
 * Stage 7 must NOT add:
 *   - any public funder API,
 *   - any new Batch 4 UI page or component,
 *   - any direct supabase.from('p5_batch4_*') in these new lib modules,
 *   - any RPC wrappers — those live only in lib/p5-batch4/rpc.ts.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const V = [];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (["node_modules", ".git", "dist"].includes(name)) continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

// --- 1. New lib modules must exist and be pure. ----------------------
const NEW_LIB = [
  "src/lib/p5-batch4/notifications.ts",
  "src/lib/p5-batch4/reports.ts",
  "src/lib/p5-batch4/finality-bridge.ts",
  "src/lib/p5-batch4/memory-bridge.ts",
];
for (const rel of NEW_LIB) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) {
    V.push(`Stage 7 guard: missing ${rel}`);
    continue;
  }
  const text = readFileSync(p, "utf8");
  if (/supabase\s*\.\s*from\(/.test(text)) {
    V.push(`Stage 7 leak: ${rel} calls supabase.from(...) directly`);
  }
  if (/supabase\s*\.\s*rpc\(/.test(text)) {
    V.push(`Stage 7 leak: ${rel} calls supabase.rpc(...) directly`);
  }
  if (/functions\.invoke/.test(text)) {
    V.push(`Stage 7 leak: ${rel} performs an HTTP invoke (pure module expected)`);
  }
}

// --- 2. SLA monitor edge function: must be internal-key gated. -------
const monitor = join(ROOT, "supabase/functions/p5-batch4-sla-monitor/index.ts");
if (!existsSync(monitor)) {
  V.push("Stage 7 guard: missing supabase/functions/p5-batch4-sla-monitor/index.ts");
} else {
  const text = readFileSync(monitor, "utf8");
  if (!/INTERNAL_CRON_KEY/.test(text)) {
    V.push("Stage 7 guard: SLA monitor must use INTERNAL_CRON_KEY");
  }
  if (!/x-internal-cron-key/i.test(text)) {
    V.push("Stage 7 guard: SLA monitor must read x-internal-cron-key header");
  }
  if (!/403/.test(text)) {
    V.push("Stage 7 guard: SLA monitor must reject unauthorised callers with 403");
  }
  // Idempotency check signature.
  if (!/p5_batch4_audit_events/.test(text)) {
    V.push("Stage 7 guard: SLA monitor must consult p5_batch4_audit_events for idempotency");
  }
}

// --- 3. Only two Batch 4 edge functions allowed in Stage 7. ----------
const fnDir = join(ROOT, "supabase/functions");
const allowedFns = new Set([
  "p5-batch4-execution-summary",
  "p5-batch4-sla-monitor",
]);
if (existsSync(fnDir)) {
  for (const name of readdirSync(fnDir)) {
    if (/p5-?batch-?4/i.test(name) && !allowedFns.has(name)) {
      V.push(`Stage 7 leak: unexpected Batch 4 edge function "${name}"`);
    }
  }
}

// --- 4. No new UI surfaces in Stage 7. -------------------------------
// Stage 4/5/6 produced the only sanctioned Batch 4 UI. Stage 7 must
// not add new pages or components.
const uiDirs = [
  "src/pages/admin/p5-batch4",
  "src/pages/desk/p5-batch4",
  "src/pages/funder/p5-batch4",
  "src/pages/registry/p5-batch4",
];
// We just assert: no /reports, /notifications, /finality folders snuck in.
for (const dir of uiDirs) {
  const p = join(ROOT, dir);
  if (!existsSync(p)) continue;
  for (const f of walk(p)) {
    if (/\/reports\//.test(f) || /\/notifications\//.test(f) || /\/finality\//.test(f)) {
      V.push(`Stage 7 leak: new Batch 4 UI surface ${f}`);
    }
  }
}

// --- 5. Defensive: no funder-public API. -----------------------------
// Reject any new edge function whose path resembles a public funder API.
if (existsSync(fnDir)) {
  for (const name of readdirSync(fnDir)) {
    if (/p5-?batch-?4.*funder.*public/i.test(name)) {
      V.push(`Stage 7 leak: public funder API surface "${name}"`);
    }
  }
}

// --- 6. New libs must not import UI surfaces. ------------------------
for (const rel of NEW_LIB) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) continue;
  const text = readFileSync(p, "utf8");
  if (/from\s+['"]@\/pages\//.test(text)) {
    V.push(`Stage 7 leak: ${rel} imports from src/pages (UI)`);
  }
  if (/from\s+['"]@\/components\//.test(text)) {
    V.push(`Stage 7 leak: ${rel} imports from src/components (UI)`);
  }
}

if (V.length > 0) {
  console.error("❌ P5_BATCH_4_STAGE_7_ISOLATION_FAILED");
  for (const v of V) console.error("  - " + v);
  process.exit(1);
}

console.log("✅ P5_BATCH_4_STAGE_7_ISOLATION_OK");
