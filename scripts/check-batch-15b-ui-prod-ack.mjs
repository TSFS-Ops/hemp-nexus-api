#!/usr/bin/env node
/**
 * Batch 15B guard — production approval requires SSOT acknowledgement copy
 * and an explicit acknowledgement checkbox before approval can be submitted.
 */
import fs from "node:fs";
import path from "node:path";

const SSOT = "src/lib/registry-api-hardening.ts";
const UI_SSOT = "src/lib/registry-api-hardening-ui.ts";
const DETAIL = "src/pages/admin/registry/ApiClientDetail.tsx";

const CANONICAL = "I understand that production API access may allow an institutional client to rely on registry status responses. This does not permit raw bank-detail access unless a separate approved scope exists.";

let failed = false;

function read(p) {
  return fs.readFileSync(path.join(process.cwd(), p), "utf8");
}

if (!read(SSOT).includes(CANONICAL)) {
  console.error(`✗ ${SSOT} missing canonical acknowledgement`);
  failed = true;
}
if (!read(UI_SSOT).includes("productionAcknowledgement")) {
  console.error(`✗ ${UI_SSOT} missing productionAcknowledgement copy`);
  failed = true;
}

const detail = read(DETAIL);
if (!/productionAcknowledgement/.test(detail)) {
  console.error(`✗ ${DETAIL} must render REGISTRY_API_UI_COPY.productionAcknowledgement`);
  failed = true;
}
if (!/isProductionApprovalReady/.test(detail)) {
  console.error(`✗ ${DETAIL} must gate the submit button via isProductionApprovalReady`);
  failed = true;
}
if (!/disabled=\{!ready\}/.test(detail) && !/disabled=\{!productionApproved\}/.test(detail)) {
  console.error(`✗ ${DETAIL} submit-production-approval-btn must be disabled until ready`);
  failed = true;
}
if (!/data-testid="production-ack-checkbox"/.test(detail)) {
  console.error(`✗ ${DETAIL} must expose production-ack-checkbox`);
  failed = true;
}

if (failed) {
  console.error("Batch 15B UI production-acknowledgement guard FAILED.");
  process.exit(1);
}
console.log("✓ Batch 15B UI production-acknowledgement guard OK");
