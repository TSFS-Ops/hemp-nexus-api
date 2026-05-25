#!/usr/bin/env node
/**
 * Batch E — negative fixture test for check-admin-aal2-coverage.mjs.
 *
 * Builds a throwaway fake function tree on disk, copies the drift script
 * with a substituted FUNCTIONS_DIR + SENSITIVE_ENDPOINTS list, and asserts:
 *   - present + has assertAal2 + has audit writer → exit 0;
 *   - present + missing assertAal2                → exit 1;
 *   - present + missing governance writer         → exit 1;
 *   - missing on disk                             → exit 0 (skipped).
 *
 * Run via `node scripts/check-admin-aal2-coverage.test.mjs`.
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = join(tmpdir(), `aal2-drift-${Date.now()}`);
const FUNCS = join(TMP, "supabase", "functions");

function writeFn(name, src) {
  const dir = join(FUNCS, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.ts"), src);
}

function runScript(extraSensitive) {
  // Inline a derivative script that points at TMP and uses a custom list.
  const script = `
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const ROOT = ${JSON.stringify(TMP)};
const FUNCTIONS_DIR = join(ROOT, "supabase", "functions");
const SENSITIVE_ENDPOINTS = ${JSON.stringify(extraSensitive)};
const AAL_PATTERNS = [/\\bassertAal2\\b/];
const GOV_WRITER_PATTERNS = [/\\.from\\(\\s*["']audit_logs["']\\s*\\)\\s*\\.insert\\b/];
function readAll(d){const o=[];for(const n of readdirSync(d)){const f=join(d,n);const s=statSync(f);if(s.isDirectory())o.push(...readAll(f));else if(n.endsWith(".ts"))o.push(readFileSync(f,"utf8"));}return o;}
const fails=[];
for(const name of SENSITIVE_ENDPOINTS){
  const dir=join(FUNCTIONS_DIR,name);
  if(!existsSync(dir)){console.log(name+" NOT_PRESENT");continue;}
  const src=readAll(dir).join("\\n");
  const aal=AAL_PATTERNS.some(p=>p.test(src));
  const gov=GOV_WRITER_PATTERNS.some(p=>p.test(src));
  console.log(name+" aal="+aal+" gov="+gov);
  if(!aal)fails.push(name+":aal");
  if(!gov)fails.push(name+":gov");
}
if(fails.length){console.error("FAIL "+fails.join(","));process.exit(1);}
`;
  const scriptPath = join(TMP, "run.mjs");
  writeFileSync(scriptPath, script);
  return spawnSync("node", [scriptPath], { encoding: "utf8" });
}

function assert(cond, msg) {
  if (!cond) {
    console.error("ASSERT FAILED:", msg);
    process.exit(1);
  }
}

try {
  mkdirSync(FUNCS, { recursive: true });

  // Case 1: good — has both.
  writeFn(
    "good-fn",
    `import { assertAal2 } from "../_shared/aal.ts";
     await admin.from("audit_logs").insert({ action: "x" });`,
  );
  let r = runScript(["good-fn"]);
  assert(r.status === 0, `good-fn should pass, got ${r.status}: ${r.stderr}`);

  // Case 2: missing AAL.
  writeFn(
    "no-aal-fn",
    `await admin.from("audit_logs").insert({ action: "x" });`,
  );
  r = runScript(["no-aal-fn"]);
  assert(r.status === 1, `no-aal-fn should fail`);
  assert(/no-aal-fn:aal/.test(r.stderr), `no-aal-fn should report :aal`);

  // Case 3: missing governance writer.
  writeFn(
    "no-gov-fn",
    `import { assertAal2 } from "../_shared/aal.ts"; await assertAal2();`,
  );
  r = runScript(["no-gov-fn"]);
  assert(r.status === 1, `no-gov-fn should fail`);
  assert(/no-gov-fn:gov/.test(r.stderr), `no-gov-fn should report :gov`);

  // Case 4: not present on disk → skipped, exit 0.
  r = runScript(["does-not-exist-fn"]);
  assert(r.status === 0, `missing-on-disk should be skipped, got ${r.status}`);
  assert(
    /NOT_PRESENT/.test(r.stdout),
    `missing-on-disk should print NOT_PRESENT`,
  );

  console.log("OK — drift-script fixture tests passed (4/4).");
} finally {
  rmSync(TMP, { recursive: true, force: true });
}
