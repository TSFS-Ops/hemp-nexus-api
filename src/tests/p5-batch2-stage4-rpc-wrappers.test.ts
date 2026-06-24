import { describe, expect, it, vi, beforeEach } from "vitest";

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: { ok: true }, error: null };
    }),
  },
}));

import {
  p5b2CreateKycRecord,
  p5b2LinkRecords,
  p5b2GenerateChecklist,
  p5b2UploadEvidenceVersion,
  p5b2ReviewEvidence,
  p5b2SetProviderState,
  p5b2WaiveEvidence,
  p5b2WithdrawEvidence,
  p5b2SuspendRelease,
  p5b2SnapshotFinalityPack,
  p5b2LogSensitiveAccess,
  P5B2_RPC_WRAPPER_NAMES,
} from "@/lib/p5-batch2/rpc";

beforeEach(() => { rpcCalls.length = 0; });

describe("p5-batch2 stage 4 — RPC wrappers", () => {
  it("registers all 11 wrappers", () => {
    expect(P5B2_RPC_WRAPPER_NAMES.length).toBe(11);
  });

  it("p5b2CreateKycRecord calls p5b2_create_kyc_record", async () => {
    await p5b2CreateKycRecord({ record_type: "company", display_name: "Acme Ltd" });
    expect(rpcCalls[0].name).toBe("p5b2_create_kyc_record");
    expect(rpcCalls[0].args.p_display_name).toBe("Acme Ltd");
    expect(rpcCalls[0].args.p_record_type).toBe("company");
  });

  it("p5b2LinkRecords calls p5b2_link_records", async () => {
    await p5b2LinkRecords({ parent_record_id: "a", child_record_id: "b", link_type: "controls" });
    expect(rpcCalls[0].name).toBe("p5b2_link_records");
    expect(rpcCalls[0].args.p_link_type).toBe("controls");
  });

  it("p5b2GenerateChecklist calls p5b2_generate_checklist", async () => {
    await p5b2GenerateChecklist("rec-1");
    expect(rpcCalls[0].name).toBe("p5b2_generate_checklist");
    expect(rpcCalls[0].args.p_record_id).toBe("rec-1");
  });

  it("p5b2UploadEvidenceVersion calls p5b2_upload_evidence_version", async () => {
    await p5b2UploadEvidenceVersion({
      evidence_item_id: "ev-1", file_storage_path: "s/x", file_hash: "h",
    });
    expect(rpcCalls[0].name).toBe("p5b2_upload_evidence_version");
  });

  it("p5b2ReviewEvidence calls p5b2_review_evidence", async () => {
    await p5b2ReviewEvidence({
      evidence_item_id: "ev-1", action: "accept", new_status: "accepted",
    });
    expect(rpcCalls[0].name).toBe("p5b2_review_evidence");
    expect(rpcCalls[0].args.p_action).toBe("accept");
  });

  it("p5b2SetProviderState calls p5b2_set_provider_state", async () => {
    await p5b2SetProviderState({
      evidence_item_id: "ev-1",
      provider_status: "provider_result_pending",
      provider_live: false,
    });
    expect(rpcCalls[0].name).toBe("p5b2_set_provider_state");
    expect(rpcCalls[0].args.p_provider_live).toBe(false);
  });

  it("p5b2WaiveEvidence calls p5b2_waive_evidence", async () => {
    await p5b2WaiveEvidence({ evidence_item_id: "ev-1", scope: "execution", reason_text: "x" });
    expect(rpcCalls[0].name).toBe("p5b2_waive_evidence");
    expect(rpcCalls[0].args.p_scope).toBe("execution");
  });

  it("p5b2WithdrawEvidence calls p5b2_withdraw_evidence", async () => {
    await p5b2WithdrawEvidence({ evidence_item_id: "ev-1", reason_text: "x" });
    expect(rpcCalls[0].name).toBe("p5b2_withdraw_evidence");
  });

  it("p5b2SuspendRelease calls p5b2_suspend_release", async () => {
    await p5b2SuspendRelease({ evidence_item_id: "ev-1", mode: "suspend", reason_text: "x" });
    expect(rpcCalls[0].name).toBe("p5b2_suspend_release");
    expect(rpcCalls[0].args.p_mode).toBe("suspend");
  });

  it("p5b2SnapshotFinalityPack calls p5b2_snapshot_finality_pack", async () => {
    await p5b2SnapshotFinalityPack({
      pack_reason: "finality_pack", evidence_item_ids: ["ev-1"],
    });
    expect(rpcCalls[0].name).toBe("p5b2_snapshot_finality_pack");
  });

  it("p5b2LogSensitiveAccess calls p5b2_log_sensitive_access", async () => {
    await p5b2LogSensitiveAccess({
      field: "bank_account_number", reason_text: "Approve payout", action: "unmask",
    });
    expect(rpcCalls[0].name).toBe("p5b2_log_sensitive_access");
    expect(rpcCalls[0].args.p_action).toBe("unmask");
  });

  it("surfaces RPC errors as ok:false", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: null, error: { message: "actor_not_authorised" },
    });
    const res = await p5b2WaiveEvidence({ evidence_item_id: "ev-1", scope: "execution", reason_text: "x" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/actor_not_authorised/);
  });
});
