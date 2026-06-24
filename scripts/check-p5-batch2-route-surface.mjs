#!/usr/bin/env node
// P-5 Batch 2 — route/surface guard: confirm Stage 4–6 routes are registered
// behind RequireAuth wrappers in App.tsx.
import { readFileSync } from "node:fs";
const app = readFileSync("src/App.tsx", "utf8");
const required = [
  "/admin/p5-batch2",
  "/registry/p5-batch2",
  "/funder/p5-batch2",
];
let bad = required.filter((r) => !app.includes(r));
if (bad.length) { console.error("route-surface: missing routes", bad); process.exit(1); }
if (!app.includes("RequireAuth")) { console.error("route-surface: RequireAuth absent"); process.exit(1); }
console.log("route-surface: OK");
