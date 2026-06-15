/**
 * Phase 5 — outreach hardening tests.
 *
 * Pure-function tests for the first-outreach validator and the
 * approved-outcome vocabulary. These cover the forbidden-content
 * rejection matrix and the V1 outcome enum exactly. The edge function
 * is a thin wrapper around these helpers (see ./index.ts).
 */
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  validateFirstOutreach,
  isApprovedOutcome,
  APPROVED_OUTCOMES,
  SEND_CONFIRMATION_TEXT,
} from "../_shared/outreach-validator.ts";

const SAFE_SUBJECT = "Izenzo trade introduction";
const SAFE_BODY = `Hello,

We are Izenzo. We help organisations find verified counterparties for cross-border trade. We are reaching out because your organisation may be commercially relevant to a current request.

This message is not a binding proof of intent, contract, offer or commitment. It is an introduction only.

Please reply if you would like to confirm interest. Our support team can guide you through onboarding.

Kind regards,
Izenzo Trade Desk
support@izenzo.example`;

Deno.test("1. first outreach with buyer identity is rejected", () => {
  const r = validateFirstOutreach(SAFE_SUBJECT, "Buyer name: Acme Holdings Ltd is on the request.");
  assert(r.includes("buyer_identity"), `got ${JSON.stringify(r)}`);
});

Deno.test("2. first outreach with seller identity is rejected", () => {
  const r = validateFirstOutreach(SAFE_SUBJECT, "Seller is BHP Mining Corp.");
  assert(r.includes("seller_identity"));
});

Deno.test("3. first outreach with price is rejected", () => {
  const r = validateFirstOutreach(SAFE_SUBJECT, "Indicative price USD 1,250 per mt.");
  assert(r.includes("price"));
});

Deno.test("4. first outreach with volume is rejected", () => {
  const r = validateFirstOutreach(SAFE_SUBJECT, "We have 5,000 mt available immediately.");
  assert(r.includes("volume"));
});

Deno.test("5. first outreach with bank details is rejected", () => {
  const r = validateFirstOutreach(SAFE_SUBJECT, "Please wire to IBAN GB29 NWBK 6016 1331 9268 19, SWIFT NWBKGB2L.");
  assert(r.includes("bank_details"));
});

Deno.test("6. first outreach with document references is rejected", () => {
  const r = validateFirstOutreach(SAFE_SUBJECT, "Please find attached the SPA and bill of lading.");
  assert(r.includes("documents"));
});

Deno.test("7. first outreach with personal phone number is rejected", () => {
  const r = validateFirstOutreach(SAFE_SUBJECT, "Call me on +27 82 555 1234 today.");
  assert(r.includes("personal_phone"));
});

Deno.test("8. first outreach with AI confidence/risk comment is rejected", () => {
  const r1 = validateFirstOutreach(SAFE_SUBJECT, "Our AI confidence on this match is 87%.");
  assert(r1.includes("ai_confidence_score"));
  const r2 = validateFirstOutreach(SAFE_SUBJECT, "Counterparty is bank-verified and KYB pass.");
  assert(r2.includes("unapproved_risk_comments"));
});

Deno.test("9. valid safe first outreach passes", () => {
  const r = validateFirstOutreach(SAFE_SUBJECT, SAFE_BODY);
  assertEquals(r, []);
});

Deno.test("10. approval does not send outreach (state contract)", () => {
  // The edge function's 'approve' branch sets draft_status='approved_for_send'
  // and never sets sent_at / sent_by_user_id. This test pins that contract by
  // reading index.ts and asserting the approve branch contains no send-state writes.
  const src = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
  // Locate the approve block
  const approveIdx = src.indexOf('action === "approve"');
  const sentIdx = src.indexOf('action === "mark_sent_by_human"', approveIdx);
  assert(approveIdx > 0 && sentIdx > approveIdx);
  const approveBlock = src.slice(approveIdx, sentIdx);
  assert(!/patch\.sent_at\s*=/.test(approveBlock), "approve must not set sent_at");
  assert(!/patch\.sent_by_user_id\s*=/.test(approveBlock), "approve must not set sent_by_user_id");
  assert(approveBlock.includes("approval_means_send"));
});

Deno.test("11. manual send requires final confirmation flag in edge function", () => {
  const src = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
  // The mark_sent_by_human branch must reject when confirmation_acknowledged !== true.
  assert(src.includes("confirmation_acknowledged_required"));
  assert(src.includes("body?.confirmation_acknowledged !== true"));
  assert(src.includes("send_confirmation_text"));
  assert(SEND_CONFIRMATION_TEXT.length > 50);
});

Deno.test("12. outcome enum accepts only approved V1 values", () => {
  const expected = [
    "no_response",
    "bounced",
    "interested",
    "not_interested",
    "wrong_contact",
    "call_booked",
    "onboarded",
    "converted_to_match",
    "converted_to_POI",
    "closed",
  ];
  assertEquals([...APPROVED_OUTCOMES], expected);
  for (const v of expected) assert(isApprovedOutcome(v));
  for (const v of ["replied", "ghosted", "won", "lost", "", "UNKNOWN", null, undefined, 1]) {
    assert(!isApprovedOutcome(v as unknown), `should reject ${String(v)}`);
  }
});

Deno.test("13. outreach send must not mutate match/POI/WaD/KYB/compliance/verification state", () => {
  const src = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
  const forbidden = [
    /\.from\(["']matches["']\)\s*\.update/,
    /\.from\(["']pois["']\)\s*\.update/,
    /\.from\(["']wads["']\)\s*\.update/,
    /\.from\(["']kyc_status["']\)\s*\.update/,
    /\.from\(["']compliance_cases["']\)\s*\.update/,
    /\.from\(["']operator_verification_requests["']\)\s*\.update/,
    /atomic_generate_poi/,
    /atomic_token_burn/,
  ];
  for (const re of forbidden) {
    assert(!re.test(src), `edge function must not touch ${re}`);
  }
});

Deno.test("14. non-admin/external user cannot send outreach (role gate present)", () => {
  const src = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
  assert(src.includes('requireRole(ctx, "platform_admin")'));
  // Ensure no path skips authentication
  const authCalls = (src.match(/authenticateRequest\(/g) ?? []).length;
  const roleCalls = (src.match(/requireRole\(/g) ?? []).length;
  assert(authCalls >= 1 && roleCalls >= 1);
});
