#!/usr/bin/env node
// P-5 Batch 2 — versioning guard: replacement reasons SSOT must include
// the lifecycle reasons that the notification engine emits.
import { readFileSync } from "node:fs";
const c = readFileSync("src/lib/p5-batch2/constants.ts", "utf8");
const required = ["expired","rejected","updated","correction","better_quality"];
let bad = required.filter((r) => !c.includes(`"${r}"`));
if (bad.length) { console.error("versioning: missing replacement reasons", bad); process.exit(1); }
console.log("versioning: OK");
