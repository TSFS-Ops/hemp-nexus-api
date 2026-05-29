#!/usr/bin/env node
/**
 * run-smoke-a-d — local CLI wrapper for the Smoke A–D pack.
 *
 * What it does, in order:
 *   1. Verifies the current git HEAD matches the recorded Batch 1 baseline
 *      stored at `.lovable/batch-1-manifest.json`, and that the working tree
 *      is clean (or only contains files explicitly whitelisted in the
 *      manifest's `allowed_dirty_paths`). Blocks the run on mismatch unless
 *      `--force-commit-mismatch` is passed.
 *   2. Prompts (TTY) for any missing SMOKE_* staging variables. Non-secret
 *      values can be persisted to `.lovable/smoke-config.local.json` for
 *      re-use; passwords and TOTP secrets are NEVER persisted.
 *   3. Spawns `npm run smoke:daniel:evidence` with the assembled env.
 *
 * Subcommands:
 *   node scripts/run-smoke-a-d.mjs                  # verify + prompt + run
 *   node scripts/run-smoke-a-d.mjs --record         # record current HEAD as Batch 1
 *   node scripts/run-smoke-a-d.mjs --verify-only    # just check git state
 *   node scripts/run-smoke-a-d.mjs --print-env      # print resolved env, no run
 *
 * Flags:
 *   --force-commit-mismatch   proceed even if HEAD ≠ recorded commit
 *   --no-prompt               fail instead of prompting for missing vars
 *   --no-persist              don't write resolved non-secrets back to disk
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve, join } from "node:path";

const ROOT = resolve(process.cwd());
const MANIFEST_PATH = join(ROOT, ".lovable", "batch-1-manifest.json");
const LOCAL_CONFIG_PATH = join(ROOT, ".lovable", "smoke-config.local.json");

const args = new Set(process.argv.slice(2));
const RECORD = args.has("--record");
const VERIFY_ONLY = args.has("--verify-only");
const PRINT_ENV = args.has("--print-env");
const FORCE = args.has("--force-commit-mismatch");
const NO_PROMPT = args.has("--no-prompt");
const NO_PERSIST = args.has("--no-persist");

// ----- helpers --------------------------------------------------------------

function sh(cmd, argv) {
  const r = spawnSync(cmd, argv, { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(" ")} → ${r.status}\n${r.stderr}`);
  return r.stdout.trim();
}

function gitHead() {
  try { return sh("git", ["rev-parse", "HEAD"]); }
  catch (e) { throw new Error(`git not available or not a repo: ${e.message}`); }
}

function gitDirty() {
  // Returns array of `XY path` lines (porcelain v1).
  const out = sh("git", ["status", "--porcelain"]);
  return out ? out.split("\n").map((l) => l.trim()).filter(Boolean) : [];
}

async function readJson(p) {
  if (!existsSync(p)) return null;
  return JSON.parse(await readFile(p, "utf8"));
}

async function writeJson(p, data) {
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, JSON.stringify(data, null, 2) + "\n");
}

function prompt(question, { silent = false } = {}) {
  if (!process.stdin.isTTY) {
    return Promise.reject(new Error(`stdin not a TTY — cannot prompt for "${question.trim()}". Re-run with the var exported, or pass --no-prompt to see what's missing.`));
  }
  return new Promise((res, rej) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (!silent) {
      rl.question(question, (a) => { rl.close(); res(a); });
      return;
    }
    // Silent mode for passwords/secrets — mute echo.
    process.stdout.write(question);
    const onData = (ch) => {
      const s = ch.toString("utf8");
      if (s === "\n" || s === "\r" || s === "\r\n" || s === "\u0004") {
        process.stdin.removeListener("data", onData);
        process.stdout.write("\n");
        rl.close();
      }
    };
    // @ts-ignore — Writable.write signature
    rl._writeToOutput = () => {};
    process.stdin.on("data", onData);
    rl.question("", (a) => { res(a); });
  });
}

// ----- step 1: git baseline -------------------------------------------------

async function recordBaseline() {
  const head = gitHead();
  const dirty = gitDirty();
  if (dirty.length) {
    console.error("Refusing to record baseline: working tree is dirty:");
    dirty.forEach((l) => console.error("  " + l));
    process.exit(2);
  }
  const manifest = {
    label: "batch-1",
    commit: head,
    recorded_at: new Date().toISOString(),
    note: "Baseline commit for the Smoke A–D pack. Update with --record after a sanctioned Batch 1 change.",
    allowed_dirty_paths: [],
  };
  await writeJson(MANIFEST_PATH, manifest);
  console.log(`Recorded Batch 1 baseline: ${head}`);
  console.log(`  → ${MANIFEST_PATH}`);
}

async function verifyGit() {
  const manifest = await readJson(MANIFEST_PATH);
  if (!manifest) {
    console.error(`No Batch 1 manifest at ${MANIFEST_PATH}.`);
    console.error(`Run once on the approved commit:  node scripts/run-smoke-a-d.mjs --record`);
    process.exit(3);
  }
  const head = gitHead();
  const allowed = new Set(manifest.allowed_dirty_paths ?? []);
  const dirty = gitDirty().filter((line) => {
    const p = line.replace(/^.{1,3}/, "").trim().replace(/^"|"$/g, "");
    return !allowed.has(p);
  });

  const commitOk = head === manifest.commit;
  const cleanOk = dirty.length === 0;

  console.log(`Git baseline check:`);
  console.log(`  recorded: ${manifest.commit}  (${manifest.recorded_at})`);
  console.log(`  current:  ${head}  ${commitOk ? "✓" : "✗ MISMATCH"}`);
  console.log(`  worktree: ${cleanOk ? "clean ✓" : `${dirty.length} unexpected change(s) ✗`}`);
  if (!cleanOk) dirty.slice(0, 20).forEach((l) => console.log("    " + l));

  if ((!commitOk || !cleanOk) && !FORCE) {
    console.error(`\nBlocked: working state does not match the recorded Batch 1 baseline.`);
    console.error(`Either check out the baseline commit, update the manifest with --record,`);
    console.error(`or re-run with --force-commit-mismatch (NOT recommended for an evidence run).`);
    process.exit(4);
  }
  if (!commitOk || !cleanOk) {
    console.warn(`\n⚠  Proceeding under --force-commit-mismatch. Evidence will be annotated as off-baseline.`);
  }
  return { manifest, head, forced: !commitOk || !cleanOk };
}

// ----- step 2: prompt for SMOKE_* vars --------------------------------------

/**
 * The contract here mirrors `playwright.config.ts` and `e2e/smoke-a-d.spec.ts`.
 * `persist` controls whether the value is saved to `.lovable/smoke-config.local.json`
 * after the run — never set this true for passwords or TOTP seeds.
 */
const SMOKE_VARS = [
  { key: "SMOKE_BASE_URL",              label: "Staging base URL (https://…lovable.app)", required: true,  persist: true },
  { key: "SMOKE_ADMIN_EMAIL",           label: "Row A — platform_admin (no TOTP) email",  required: true,  persist: true },
  { key: "SMOKE_ADMIN_PASSWORD",        label: "Row A — password",                         required: true,  persist: false, silent: true },
  { key: "SMOKE_ADMIN_AAL2_EMAIL",      label: "Row B — platform_admin (AAL2) email",     required: true,  persist: true },
  { key: "SMOKE_ADMIN_AAL2_PASSWORD",   label: "Row B — password",                         required: true,  persist: false, silent: true },
  { key: "SMOKE_ADMIN_AAL2_TOTP_SECRET",label: "Row B — base32 TOTP secret",               required: true,  persist: false, silent: true },
  { key: "SMOKE_ORG_EMAIL",             label: "Rows C/D — org account email",            required: true,  persist: true },
  { key: "SMOKE_ORG_PASSWORD",          label: "Rows C/D — password",                      required: true,  persist: false, silent: true },
  { key: "SMOKE_LEGAL_HOLD_SCOPE_ID",   label: "Row B — legal-hold scope UUID",            required: true,  persist: true },
];

async function resolveSmokeEnv() {
  const saved = (await readJson(LOCAL_CONFIG_PATH)) ?? {};
  const env = { ...process.env };
  const resolved = {};
  const missing = [];

  for (const v of SMOKE_VARS) {
    let val = env[v.key] ?? saved[v.key] ?? "";
    if (!val && v.required) missing.push(v);
    else resolved[v.key] = val;
  }

  if (missing.length && NO_PROMPT) {
    console.error("Missing required SMOKE_* vars (re-run without --no-prompt to enter them):");
    missing.forEach((v) => console.error(`  - ${v.key}  (${v.label})`));
    process.exit(5);
  }

  if (missing.length) {
    console.log("\nEnter staging variables (Ctrl-C to abort):");
    for (const v of missing) {
      // eslint-disable-next-line no-await-in-loop
      const ans = (await prompt(`  ${v.key} — ${v.label}: `, { silent: v.silent })).trim();
      if (!ans) {
        console.error(`  ${v.key} is required.`);
        process.exit(6);
      }
      resolved[v.key] = ans;
    }
  }

  // Light validation — these are cheap and catch finger-fumbles before a 90s test run.
  if (!/^https?:\/\//.test(resolved.SMOKE_BASE_URL ?? "")) {
    console.error(`SMOKE_BASE_URL must start with http(s)://`);
    process.exit(7);
  }
  for (const k of ["SMOKE_ADMIN_PASSWORD", "SMOKE_ADMIN_AAL2_PASSWORD", "SMOKE_ORG_PASSWORD"]) {
    if ((resolved[k] ?? "").length < 12) {
      console.error(`${k} must be ≥12 chars.`);
      process.exit(7);
    }
  }
  if (!/^[A-Z2-7]{16,}=*$/.test(resolved.SMOKE_ADMIN_AAL2_TOTP_SECRET ?? "")) {
    console.error(`SMOKE_ADMIN_AAL2_TOTP_SECRET does not look like base32.`);
    process.exit(7);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolved.SMOKE_LEGAL_HOLD_SCOPE_ID ?? "")) {
    console.error(`SMOKE_LEGAL_HOLD_SCOPE_ID must be a UUID.`);
    process.exit(7);
  }

  if (!NO_PERSIST) {
    const toSave = { ...saved };
    for (const v of SMOKE_VARS) if (v.persist && resolved[v.key]) toSave[v.key] = resolved[v.key];
    await writeJson(LOCAL_CONFIG_PATH, toSave);
  }
  return resolved;
}

// ----- step 3: run the pack -------------------------------------------------

async function runPack(smokeEnv, gitInfo) {
  const child = spawn("npm", ["run", "smoke:daniel:evidence"], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      ...smokeEnv,
      SMOKE_BATCH_1_COMMIT: gitInfo.manifest.commit,
      SMOKE_BATCH_1_HEAD: gitInfo.head,
      SMOKE_BATCH_1_OFF_BASELINE: gitInfo.forced ? "1" : "0",
    },
  });
  await new Promise((res) => child.on("exit", (code) => {
    process.exitCode = code ?? 1;
    res(undefined);
  }));
}

// ----- entrypoint -----------------------------------------------------------

(async () => {
  if (RECORD) { await recordBaseline(); return; }
  const gitInfo = await verifyGit();
  if (VERIFY_ONLY) return;

  const smokeEnv = await resolveSmokeEnv();

  if (PRINT_ENV) {
    const redacted = {};
    for (const v of SMOKE_VARS) {
      redacted[v.key] = v.silent ? (smokeEnv[v.key] ? "***" : "") : smokeEnv[v.key] ?? "";
    }
    console.log(JSON.stringify(redacted, null, 2));
    return;
  }

  console.log(`\nLaunching Smoke A–D against ${smokeEnv.SMOKE_BASE_URL} …`);
  await runPack(smokeEnv, gitInfo);
})().catch((e) => {
  console.error(`\nrun-smoke-a-d failed: ${e.message}`);
  process.exit(1);
});
