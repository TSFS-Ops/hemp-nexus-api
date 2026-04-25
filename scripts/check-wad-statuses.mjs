#!/usr/bin/env node

/**
 * WaD Status Drift Guard
 *
 * Validates that the `WAD_STATUSES` array exported from
 * `src/lib/wad-state.ts` is in lock-step with the database
 * `wads_status_check` CHECK constraint on `public.wads.status`.
 *
 * Why: A mismatch causes the UI state machine to silently reject a
 * legitimate persisted status. Incident 2026-04-24: `awaiting_attestations`
 * was missing from the TS list, breaking seller attestations.
 *
 * Run:
 *   node scripts/check-wad-statuses.mjs
 *   npm run check:wad-statuses
 *
 * Sources of truth (in order):
 *   1. Live DB via $PGHOST/psql (when available — preferred).
 *   2. Committed snapshot at supabase/snapshots/wads_status_check.json
 *      (the build-time fallback so this works without DB access).
 *
 * Exits 1 on drift; 0 on match.
 */

import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const WAD_STATE_FILE = resolve(ROOT, "src/lib/wad-state.ts");
const SNAPSHOT_FILE = resolve(ROOT, "supabase/snapshots/wads_status_check.json");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function fail(msg) {
  console.error(`${RED}✖ ${msg}${RESET}`);
  process.exit(1);
}

function info(msg) {
  console.log(`  ${msg}`);
}

// ─── 1. Parse WAD_STATUSES from the TS file ───────────────────────────────

function parseWadStatuses() {
  if (!existsSync(WAD_STATE_FILE)) {
    fail(`Cannot find ${WAD_STATE_FILE}`);
  }
  const src = readFileSync(WAD_STATE_FILE, "utf-8");
  const match = src.match(
    /export\s+const\s+WAD_STATUSES\s*=\s*\[([\s\S]*?)\]\s*as\s+const/
  );
  if (!match) {
    fail(
      "Could not locate `export const WAD_STATUSES = [...] as const` in src/lib/wad-state.ts"
    );
  }
  const body = match[1];
  const values = [...body.matchAll(/["'`]([a-z_]+)["'`]/g)].map((m) => m[1]);
  if (values.length === 0) {
    fail("WAD_STATUSES appears to be empty in src/lib/wad-state.ts");
  }
  return values;
}

// ─── 2. Resolve expected statuses from DB or snapshot ─────────────────────

function readSnapshot() {
  if (!existsSync(SNAPSHOT_FILE)) {
    fail(
      `Snapshot missing at ${SNAPSHOT_FILE}. Regenerate it from the DB before continuing.`
    );
  }
  const json = JSON.parse(readFileSync(SNAPSHOT_FILE, "utf-8"));
  if (!Array.isArray(json.values) || json.values.length === 0) {
    fail(`Snapshot ${SNAPSHOT_FILE} has no \`values\` array.`);
  }
  return json.values;
}

function tryReadFromDb() {
  if (!process.env.PGHOST) return null;
  try {
    const out = execSync(
      `psql -At -c "SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE c.conname='wads_status_check' AND n.nspname='public' AND t.relname='wads';"`,
      { stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" }
    ).trim();
    if (!out) return null;
    // Example: CHECK ((status = ANY (ARRAY['draft'::text, 'awaiting_attestations'::text, ...])))
    const values = [...out.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
    if (values.length === 0) return null;
    return values;
  } catch (err) {
    info(
      `${YELLOW}⚠ Could not query live DB (${err.message.split("\n")[0]}); falling back to snapshot.${RESET}`
    );
    return null;
  }
}

// ─── 3. Compare ───────────────────────────────────────────────────────────

function diff(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  return {
    onlyInA: [...setA].filter((x) => !setB.has(x)),
    onlyInB: [...setB].filter((x) => !setA.has(x)),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────

function main() {
  console.log("🔎 Checking WaD status alignment (TS ↔ DB)…");

  const tsStatuses = parseWadStatuses();
  info(`TS  WAD_STATUSES        → [${tsStatuses.join(", ")}]`);

  const dbStatuses = tryReadFromDb();
  const snapshotStatuses = readSnapshot();

  // Sub-check A: TS vs snapshot (always runs, build-time guard).
  const tsVsSnap = diff(tsStatuses, snapshotStatuses);
  info(`Snap wads_status_check  → [${snapshotStatuses.join(", ")}]`);

  if (tsVsSnap.onlyInA.length || tsVsSnap.onlyInB.length) {
    console.error("");
    console.error(`${RED}✖ Drift between WAD_STATUSES and snapshot.${RESET}`);
    if (tsVsSnap.onlyInA.length) {
      console.error(
        `  In TS but not in DB snapshot: [${tsVsSnap.onlyInA.join(", ")}]`
      );
    }
    if (tsVsSnap.onlyInB.length) {
      console.error(
        `  In DB snapshot but not in TS: [${tsVsSnap.onlyInB.join(", ")}]`
      );
    }
    console.error(
      "\n  Fix: update src/lib/wad-state.ts (WAD_STATUSES, ALLOWED_ACTIONS,"
    );
    console.error(
      "       VALID_TRANSITIONS, statusLabel) AND/OR regenerate the snapshot at"
    );
    console.error(`       ${SNAPSHOT_FILE}.`);
    process.exit(1);
  }

  // Sub-check B: snapshot vs live DB (only when DB available).
  if (dbStatuses) {
    info(`DB   wads_status_check  → [${dbStatuses.join(", ")}]`);
    const snapVsDb = diff(snapshotStatuses, dbStatuses);
    if (snapVsDb.onlyInA.length || snapVsDb.onlyInB.length) {
      console.error("");
      console.error(
        `${RED}✖ Drift between committed snapshot and live DB.${RESET}`
      );
      if (snapVsDb.onlyInA.length) {
        console.error(
          `  In snapshot but not in DB: [${snapVsDb.onlyInA.join(", ")}]`
        );
      }
      if (snapVsDb.onlyInB.length) {
        console.error(
          `  In DB but not in snapshot: [${snapVsDb.onlyInB.join(", ")}]`
        );
      }
      console.error(
        `\n  Fix: regenerate ${SNAPSHOT_FILE} from the live DB and re-run.`
      );
      process.exit(1);
    }
  } else {
    info(
      `${YELLOW}ℹ No PGHOST — skipped live DB cross-check (snapshot used).${RESET}`
    );
  }

  console.log(`${GREEN}✓ WaD statuses are in sync.${RESET}`);
  process.exit(0);
}

main();
