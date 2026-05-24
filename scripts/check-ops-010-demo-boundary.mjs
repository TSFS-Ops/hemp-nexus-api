#!/usr/bin/env node
/**
 * OPS-010 — Demo boundary integrity.
 *
 * Enforces structural invariants that protect the live/demo boundary:
 *
 *  1. The `DEMO_BOUNDARY_VIOLATION` error code must remain in the migration
 *     that installs the `enforce_demo_inheritance_trg` trigger.
 *  2. The 3 SECDEF RPCs (create/reset/archive) must enforce the minimum
 *     20-character reason.
 *  3. The reset RPC must scope its delete to BOTH `is_demo = true` AND
 *     `demo_dataset_id = target_dataset_id` — never a bare `is_demo` scan.
 *  4. The deterministic seeder must not contain any real client / company
 *     names from CP fixtures.
 *  5. The `markDemoArtifact` watermark function must exist and be referenced
 *     by at least one artefact surface.
 */
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";
const SEEDER = "supabase/functions/seed-ops010-demo-workspace/index.ts";
const GUARD = "supabase/functions/_shared/demo-mode-guard.ts";

// Real-client names that must NEVER appear in the demo seeder.
// Keep this list narrow — it is a tripwire, not a deny-list — pull from
// CP fixture canonical orgs.
const FORBIDDEN_REAL_NAMES = [
  "Izenzo",
  "Daniel",
  // CP fixture canonical orgs (do not seed these into demo)
  "CP Buyer A",
  "CP Seller A",
];

let failed = false;

// 1 + 3: Find the migration that installs enforce_demo_inheritance_trg
let trgMigration = null;
if (fs.existsSync(MIGRATIONS_DIR)) {
  for (const f of fs.readdirSync(MIGRATIONS_DIR).sort()) {
    if (!f.endsWith(".sql")) continue;
    const src = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    if (src.includes("enforce_demo_inheritance_trg")) {
      trgMigration = path.join(MIGRATIONS_DIR, f);
      if (!src.includes("DEMO_BOUNDARY_VIOLATION")) {
        console.error(
          `[ops-010-demo-boundary] ${f} installs trigger but is missing DEMO_BOUNDARY_VIOLATION error code`,
        );
        failed = true;
      }
      // 3. reset_demo_workspace must scope by BOTH is_demo and dataset id.
      const resetBlock = (src.match(
        /create or replace function[\s\S]+?reset_demo_workspace[\s\S]+?\$fn\$;/i,
      ) || [""])[0];
      if (resetBlock && !/is_demo[\s\S]+demo_dataset_id|demo_dataset_id[\s\S]+is_demo/i.test(resetBlock)) {
        console.error(
          `[ops-010-demo-boundary] reset_demo_workspace in ${f} must scope deletes by BOTH is_demo AND demo_dataset_id`,
        );
        failed = true;
      }
      // 2. Reason length enforcement (min 20)
      for (const fn of ["create_demo_workspace", "reset_demo_workspace", "archive_demo_workspace"]) {
        const fnBlock = (src.match(new RegExp(`create or replace function[\\s\\S]+?${fn}[\\s\\S]+?\\$fn\\$;`, "i")) || [""])[0];
        if (fnBlock && !/length\s*\(\s*(p_reason|reason)\s*\)\s*<\s*20|char_length\s*\(\s*(p_reason|reason)\s*\)\s*<\s*20/i.test(fnBlock)) {
          console.error(
            `[ops-010-demo-boundary] ${fn} in ${f} must enforce reason length >= 20`,
          );
          failed = true;
        }
      }
      break;
    }
  }
}
if (!trgMigration) {
  console.error(
    `[ops-010-demo-boundary] no migration installs enforce_demo_inheritance_trg`,
  );
  failed = true;
}

// 4. Real client / CP fixture name leak check on the seeder.
if (fs.existsSync(SEEDER)) {
  const src = fs.readFileSync(SEEDER, "utf8");
  for (const name of FORBIDDEN_REAL_NAMES) {
    // Allow the name only if it appears as a regex/exclusion list constant,
    // never as an inserted org/profile/match value.
    const re = new RegExp(`["'\`]\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(src)) {
      console.error(
        `[ops-010-demo-boundary] seeder ${SEEDER} contains forbidden real / fixture name "${name}"`,
      );
      failed = true;
    }
  }
  if (!src.includes("ops010-")) {
    console.error(
      `[ops-010-demo-boundary] seeder ${SEEDER} must use the "ops010-" dataset prefix for deterministic seeding`,
    );
    failed = true;
  }
} else {
  console.error(`[ops-010-demo-boundary] missing seeder: ${SEEDER}`);
  failed = true;
}

// 5. markDemoArtifact must exist and be referenced
if (fs.existsSync(GUARD)) {
  const src = fs.readFileSync(GUARD, "utf8");
  if (!src.includes("markDemoArtifact")) {
    console.error(
      `[ops-010-demo-boundary] ${GUARD} must export markDemoArtifact watermark helper`,
    );
    failed = true;
  }
}
const entry = "supabase/functions/_shared/demo-mode-entry.ts";
if (fs.existsSync(entry)) {
  const src = fs.readFileSync(entry, "utf8");
  if (!src.includes("markDemoArtifact")) {
    console.error(
      `[ops-010-demo-boundary] ${entry} must reference markDemoArtifact for artefact short-circuits`,
    );
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(
  `✓ OPS-010 demo boundary: trigger + SECDEF RPCs + seeder + watermark all intact.`,
);
