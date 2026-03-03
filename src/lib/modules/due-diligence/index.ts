/**
 * Due Diligence Workspace — Layer 1 (Who)
 * 
 * Module client for counterparty enablement and eligibility.
 * Provides typed API calls to the due-diligence edge function.
 */

export interface Director {
  full_name: string;
  role?: string;
  nationality?: string;
  id_number?: string;
  ownership_percentage?: number;
  is_pep?: boolean;
}

export interface KycUploadParams {
  org_id?: string;
  doc_type: string;
  filename: string;
  storage_path: string;
  sha256_hash: string;
  issuing_country?: string;
  expiry_date?: string;
  mime_type?: string;
  file_size?: number;
  id_number?: string;
}

export interface RiskFactor {
  factor: string;
  weight: number;
  value: number;
  contribution: number;
  reason: string;
}

export interface RiskScore {
  id: string;
  org_id: string;
  score: number;
  risk_band: string;
  weights: Record<string, number>;
  factors: RiskFactor[];
  computed_at: string;
}

export interface ApprovalRequest {
  id: string;
  target_org_id: string;
  requesting_org_id: string;
  status: string;
  required_roles: string[];
  completed_roles: string[];
  created_at: string;
}

export interface TradeStatus {
  org_id: string;
  approved_to_trade: boolean;
  trade_status: string;
  approved_at: string | null;
  risk_band: string | null;
  valid_until: string | null;
}

export interface Dossier {
  org_id: string;
  directors: any[];
  kyc_documents: any[];
  kyc_status: { status: string; completeness_percentage: number };
  screening_results: any[];
  risk_scores: RiskScore[];
  approval_requests: any[];
  trade_approval: { status: string };
}

async function ddRequest(action: string, body: Record<string, any>, token: string) {
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/due-diligence`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, ...body }),
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

export async function registerDirectors(orgId: string, directors: Director[], token: string) {
  return ddRequest("register_directors", { org_id: orgId, directors }, token);
}

export async function uploadKycDocument(params: KycUploadParams, token: string) {
  return ddRequest("upload_kyc", params, token);
}

export async function runScreening(orgId: string, token: string) {
  return ddRequest("run_screening", { org_id: orgId }, token);
}

export async function computeRiskScore(orgId: string, token: string, customWeights?: Record<string, number>) {
  return ddRequest("compute_score", { org_id: orgId, custom_weights: customWeights }, token);
}

export async function submitForApproval(targetOrgId: string, token: string, riskScoreId?: string) {
  return ddRequest("submit_approval", { target_org_id: targetOrgId, risk_score_id: riskScoreId }, token);
}

export async function approveOrReject(approvalRequestId: string, decision: "approve" | "reject", token: string, reason?: string) {
  return ddRequest("approve_reject", { approval_request_id: approvalRequestId, decision, reason }, token);
}

export async function getDossier(orgId: string, token: string): Promise<Dossier> {
  return ddRequest("get_dossier", { org_id: orgId }, token);
}

export async function getTradeStatus(orgId: string, token: string): Promise<TradeStatus> {
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trade-status?org_id=${orgId}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

export async function assignDdRole(targetUserId: string, role: string, token: string, orgId?: string) {
  return ddRequest("assign_dd_role", { target_user_id: targetUserId, role, org_id: orgId }, token);
}

export async function updateThresholds(lowThreshold: number, highThreshold: number, token: string) {
  return ddRequest("update_thresholds", { low_threshold: lowThreshold, high_threshold: highThreshold }, token);
}

export function isDueDiligenceComplete(dossier: Dossier): boolean {
  return (
    dossier.kyc_status.completeness_percentage >= 100 &&
    dossier.screening_results.length > 0 &&
    dossier.risk_scores.length > 0
  );
}

export function getRequiredChecks(): string[] {
  return ["company_registration", "proof_of_address", "director_id", "tax_certificate"];
}
