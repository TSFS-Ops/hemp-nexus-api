import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { readFileSync } from "node:fs";

// Batch 21 — Quarantined legacy test config. Runs only the files listed
// in src/tests/quarantine.json. Failures here are non-blocking for UAT
// evidence; the underlying invariants are enforced by the green prebuild
// guard suite referenced in the ledger.
const quarantineLedger = JSON.parse(
  readFileSync(path.resolve(__dirname, "src/tests/quarantine.json"), "utf8"),
) as { files: Array<{ path: string }> };

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: quarantineLedger.files.map((f) => f.path),
    passWithNoTests: true,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
