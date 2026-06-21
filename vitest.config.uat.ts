import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Batch 21 — CI-only UAT journey config. Runs the live-backend journey
// suite under src/tests/uat/**. Requires the UAT provisioning secret to
// be present (UAT_PROVISIONING_ENABLED=1). When absent, the journey
// describe blocks skip themselves cleanly via describe.skipIf so the
// suite emits "Skipped locally: requires CI provisioning secret." rather
// than reporting failures.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/tests/uat/**/*.{test,spec}.ts"],
    testTimeout: 30_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
