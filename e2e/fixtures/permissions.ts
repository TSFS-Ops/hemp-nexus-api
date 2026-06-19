/**
 * Wrong-action matrix — sensitive mutations and the roles allowed to
 * perform them. Drives e2e/role-negative/wrong-actions.spec.ts.
 *
 * Each entry pairs an action with the RPC/edge function that performs it
 * so the spec can hit the BACKEND directly (not just hidden UI) and prove
 * the gate. Side-effect checks list which fields/tables must remain
 * unchanged after a denied attempt.
 */

import type { Role } from "./users";
import type { RecordKey } from "./records";

export type SideEffectCheck =
  | "status"
  | "owner"
  | "tenant"
  | "ledger"
  | "seal"
  | "quota"
  | "docFields"
  | "notifications"
  | "providerCalls";

export type ActionEntry = {
  id: string;
  description: string;
  allowedRoles: ReadonlyArray<Role>;
  /** Edge function or RPC name. Prefix `rpc:` for PostgREST RPC, `fn:` for edge function. */
  target: `rpc:${string}` | `fn:${string}`;
  recordKey?: RecordKey;
  sideEffectChecks: ReadonlyArray<SideEffectCheck>;
};

export const ACTION_MATRIX: ReadonlyArray<ActionEntry> = [
  { id: "approve_refund",        description: "Approve refund request",            allowedRoles: ["platform_admin"],                       target: "rpc:approve_refund_request",       recordKey: "refundRequestId", sideEffectChecks: ["status", "ledger", "notifications", "providerCalls"] },
  { id: "decline_refund",        description: "Decline refund request",            allowedRoles: ["platform_admin"],                       target: "rpc:decline_refund_request",       recordKey: "refundRequestId", sideEffectChecks: ["status", "notifications"] },
  { id: "generate_poi",          description: "Generate restricted POI",           allowedRoles: ["platform_admin", "requester_trader"],   target: "rpc:atomic_generate_poi_v2",       recordKey: "matchId",         sideEffectChecks: ["status", "owner", "tenant", "ledger", "seal"] },
  { id: "complete_poi",          description: "Complete POI",                      allowedRoles: ["platform_admin", "requester_trader"],   target: "rpc:complete_poi",                 recordKey: "poiId",           sideEffectChecks: ["status", "seal"] },
  { id: "reject_poi",            description: "Reject POI",                        allowedRoles: ["platform_admin", "counterparty_user"],  target: "rpc:reject_poi",                   recordKey: "poiId",           sideEffectChecks: ["status"] },
  { id: "annul_poi",             description: "Annul POI",                         allowedRoles: ["platform_admin"],                       target: "rpc:annul_poi",                    recordKey: "poiId",           sideEffectChecks: ["status", "seal"] },
  { id: "issue_wad",             description: "Issue WaD",                         allowedRoles: ["platform_admin"],                       target: "rpc:issue_wad",                    recordKey: "matchId",         sideEffectChecks: ["status", "seal"] },
  { id: "seal_wad",              description: "Seal WaD",                          allowedRoles: ["platform_admin"],                       target: "rpc:seal_wad",                     recordKey: "wadId",           sideEffectChecks: ["status", "seal"] },
  { id: "submit_wad_attestation",description: "Submit required WaD attestation",   allowedRoles: ["platform_admin", "requester_trader", "counterparty_user"], target: "rpc:submit_wad_attestation",  recordKey: "wadId",           sideEffectChecks: ["status"] },
  { id: "clear_compliance_hold", description: "Clear a compliance hold",           allowedRoles: ["platform_admin", "compliance_analyst"], target: "fn:admin-compliance-hold-release", sideEffectChecks: ["status", "notifications"] },
  { id: "override_evidence",     description: "Override evidence requirement",     allowedRoles: ["platform_admin"],                       target: "rpc:override_evidence_requirement", recordKey: "poiId",          sideEffectChecks: ["status", "seal"] },
  { id: "download_export",       description: "Download governance export",        allowedRoles: ["platform_admin"],                       target: "fn:admin-governance-export-preview", recordKey: "governanceExportId", sideEffectChecks: ["docFields"] },
  { id: "download_protected_doc",description: "Download protected document",       allowedRoles: ["platform_admin", "requester_trader", "counterparty_user", "compliance_analyst"], target: "fn:document-download", recordKey: "documentId", sideEffectChecks: ["docFields"] },
  { id: "create_prod_api_key",   description: "Create production API key",         allowedRoles: ["platform_admin"],                       target: "fn:admin-api-production-approve",                                 sideEffectChecks: ["quota", "notifications"] },
  { id: "revoke_api_key",        description: "Revoke API key",                    allowedRoles: ["platform_admin"],                       target: "fn:admin-api-key-revoke",          recordKey: "apiKeyId",        sideEffectChecks: ["status", "notifications"] },
  { id: "rotate_api_key",        description: "Rotate API key",                    allowedRoles: ["platform_admin"],                       target: "fn:admin-api-key-rotate",          recordKey: "apiKeyId",        sideEffectChecks: ["status"] },
  { id: "change_usage_limit",    description: "Change API usage limit",            allowedRoles: ["platform_admin"],                       target: "rpc:set_api_usage_override",                                      sideEffectChecks: ["quota"] },
  { id: "grant_prod_access",     description: "Grant production API access",       allowedRoles: ["platform_admin"],                       target: "fn:admin-api-production-approve",                                 sideEffectChecks: ["status", "notifications"] },
  { id: "accept_unrelated_match",description: "Accept a match owned by another org",allowedRoles: [],                                       target: "rpc:accept_match",                 recordKey: "matchId",         sideEffectChecks: ["status", "owner", "tenant"] },
  { id: "decline_unrelated_match",description: "Decline a match owned by another org",allowedRoles: [],                                    target: "rpc:decline_match",                recordKey: "matchId",         sideEffectChecks: ["status", "owner", "tenant"] },
  { id: "mutate_other_tenant",   description: "Mutate another tenant's trade",     allowedRoles: [],                                       target: "rpc:update_trade_request",         recordKey: "tradeRequestId",  sideEffectChecks: ["status", "owner", "tenant", "docFields"] },
  { id: "view_internal_notes",   description: "View internal notes on a record",   allowedRoles: ["platform_admin", "compliance_analyst"], target: "rpc:get_internal_notes",           recordKey: "matchId",         sideEffectChecks: [] },
  { id: "change_commercial",     description: "Change commercial / pricing",       allowedRoles: ["platform_admin"],                       target: "rpc:set_commercial_terms",                                        sideEffectChecks: ["quota", "notifications"] },
];
