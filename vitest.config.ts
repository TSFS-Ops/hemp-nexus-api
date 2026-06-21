import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { readFileSync } from "node:fs";

// Batch 21 — UAT Test Hygiene: quarantined tests and CI-only UAT journey
// tests are excluded from the default vitest run so the local UAT evidence
// path is clean. Run quarantined tests with `npm run test:legacy` and the
// live-backend UAT journeys with `npm run test:uat:ci`.
const quarantineLedger = JSON.parse(
  readFileSync(path.resolve(__dirname, "src/tests/quarantine.json"), "utf8"),
) as { files: Array<{ path: string }> };

const QUARANTINED = quarantineLedger.files.map((f) => f.path);
const UAT_CI_ONLY = ["src/tests/uat/**"];

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "node_modules/**",
      "dist/**",
      ".idea/**",
      ".git/**",
      ".cache/**",
      ...UAT_CI_ONLY,
      ...QUARANTINED,
    ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
