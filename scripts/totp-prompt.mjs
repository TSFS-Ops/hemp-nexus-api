#!/usr/bin/env node
/**
 * totp-prompt — manual, staging-only TOTP code helper.
 *
 * Usage:
 *   SMOKE_ENV=staging node scripts/totp-prompt.mjs
 *
 * Prompts for a base32 TOTP secret with terminal echo SUPPRESSED, prints
 * the current 6-digit code to stdout ONCE, and exits. Nothing is written
 * to disk, no shell history is touched (because the secret is typed into
 * a hidden prompt, not passed as an argv), and the code itself is the
 * only thing printed — never the secret.
 *
 * Refuses to run unless SMOKE_ENV ∈ {staging, test} so production TOTP
 * secrets cannot accidentally be entered here.
 *
 * Intended for the rare case where a tester needs a code interactively
 * (e.g. driving the app by hand against a staging account). For
 * Playwright runs, use e2e/helpers/totp.ts which reads from env.
 */

import { createInterface } from "node:readline";
import { stdin, stdout, exit } from "node:process";

const env = (process.env.SMOKE_ENV ?? "").toLowerCase();
if (!["staging", "test"].includes(env)) {
  console.error("Refused: set SMOKE_ENV=staging (or test) before running.");
  exit(2);
}

async function readSecretHidden(promptText) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    // Suppress echo: intercept the internal _writeToOutput hook so each
    // keystroke renders as nothing. Backspace still works because
    // readline maintains its own buffer.
    const origWrite = rl._writeToOutput?.bind(rl);
    rl._writeToOutput = (str) => {
      if (str?.includes(promptText)) origWrite?.(str);
      // else: drop — never echo secret chars or the buffer
    };
    stdout.write(promptText);
    rl.question("", (answer) => {
      rl.close();
      stdout.write("\n");
      if (!answer || !answer.trim()) reject(new Error("empty secret"));
      else resolve(answer.trim());
    });
    rl.on("SIGINT", () => { rl.close(); stdout.write("\n"); reject(new Error("cancelled")); });
  });
}

let secret;
try {
  secret = await readSecretHidden("TOTP secret (base32, hidden): ");
} catch (e) {
  console.error(`Aborted: ${e.message}`);
  exit(1);
}

let TOTP, Secret;
try {
  ({ TOTP, Secret } = await import("otpauth"));
} catch {
  console.error("Install otpauth first: npm i -D otpauth");
  exit(3);
}

try {
  const code = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate();
  // Print the code only. Do NOT echo the secret back. Do NOT log to a file.
  stdout.write(code + "\n");
} catch {
  console.error("Could not generate code (check secret format).");
  exit(4);
} finally {
  // Best-effort scrub of the local reference.
  secret = null;
}
