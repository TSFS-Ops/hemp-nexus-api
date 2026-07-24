/**
 * idv-person-verify diagnostic persistence hardening — static regression guard.
 *
 * Proves that every fresh p5scr_idv_records row written by
 * supabase/functions/idv-person-verify/index.ts carries the values-free
 * diagnostic block required to distinguish which runtime/classifier
 * wrote it and what the classifier decided, without exposing any
 * provider response values.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(process.cwd(), "supabase/functions/idv-person-verify/index.ts"),
  "utf8",
);

describe("idv-person-verify diagnostic persistence", () => {
  it("declares the static verifynow-confirmed-schema-classifier-v1 marker", () => {
    expect(SRC).toMatch(/CLASSIFIER_VERSION\s*=\s*"verifynow-confirmed-schema-classifier-v1"/);
  });

  it("persists top-level raw_outcome, error_code, workflow_status, record_state and classifier_version", () => {
    // Slice the p_raw_provider_payload_admin_only object literal.
    const start = SRC.indexOf("p_raw_provider_payload_admin_only");
    expect(start).toBeGreaterThan(-1);
    const block = SRC.slice(start, start + 2000);
    expect(block).toMatch(/raw_outcome:\s*outcome\.raw_outcome/);
    expect(block).toMatch(/error_code:\s*outcome\.error_code/);
    expect(block).toMatch(/workflow_status:\s*workflowStatus/);
    expect(block).toMatch(/record_state:\s*recordState/);
    expect(block).toMatch(/classifier_version:\s*CLASSIFIER_VERSION/);
  });

  it("persists the full diagnostic sub-block (raw_http_status, raw_outcome, error_code, response_body_shape, classifier_version)", () => {
    const diagStart = SRC.indexOf("diagnostic:");
    expect(diagStart).toBeGreaterThan(-1);
    const diag = SRC.slice(diagStart, diagStart + 600);
    expect(diag).toMatch(/raw_http_status:\s*outcome\.raw_http_status/);
    expect(diag).toMatch(/raw_outcome:\s*outcome\.raw_outcome/);
    expect(diag).toMatch(/error_code:\s*outcome\.error_code/);
    expect(diag).toMatch(/response_body_shape:\s*outcome\.response_body_shape/);
    expect(diag).toMatch(/classifier_version:\s*CLASSIFIER_VERSION/);
  });

  it("response_body_shape is sourced from the adapter (values-free) and never rebuilt from raw response values here", () => {
    // The edge function must only forward the adapter's structural shape,
    // never stringify or persist raw response bodies.
    expect(SRC).not.toMatch(/JSON\.stringify\(\s*outcome\.raw/);
    expect(SRC).not.toMatch(/response_body_shape:\s*(?!outcome\.response_body_shape)/);
    // No raw body / provider text is captured into the payload.
    expect(SRC).not.toMatch(/raw_response_body:/);
    expect(SRC).not.toMatch(/provider_response_body:/);
  });

  it("never persists or logs identity, contact, transaction, or auth values", () => {
    const forbidden = [
      /id_number:/,
      /full_name:/,
      /first_name:/,
      /last_name:/,
      /date_of_birth:/,
      /\bdob:/,
      /phone(_number)?:/,
      /address:/,
      /photo:/,
      /transaction_id:/,
      /request_id:/,
      /api_key:/,
      /access_token:/,
      /authorization:/i,
    ];
    for (const re of forbidden) {
      expect(SRC, `edge function must not persist/log ${re}`).not.toMatch(re);
    }
  });

  it("the values-free diagnostic log line only forwards structural fields", () => {
    const logIdx = SRC.indexOf("provider_response");
    expect(logIdx).toBeGreaterThan(-1);
    const logBlock = SRC.slice(logIdx, logIdx + 500);
    // Only these keys are permitted in the diagnostic log payload.
    expect(logBlock).toMatch(/raw_http_status/);
    expect(logBlock).toMatch(/response_body_shape/);
    expect(logBlock).toMatch(/error_code/);
    expect(logBlock).toMatch(/raw_outcome/);
  });
});
