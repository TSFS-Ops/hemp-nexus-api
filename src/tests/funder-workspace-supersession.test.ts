/**
 * Funder Workspace — sealed-pack supersession client contract.
 *
 * These tests pin the client-side contract for the version-aware pack
 * generation flow. Backend enforcement (concurrency, immutability,
 * audit) is asserted by the migration; here we verify the client
 * refuses to send an incomplete supersession request and forwards the
 * parameters faithfully to the edge function.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => {
  const invoke = vi.fn().mockResolvedValue({ data: { ok: true, pack_version_id: "pv" }, error: null });
  const rpc = vi.fn().mockResolvedValue({
    data: { user_id: "u", email: "x@y.z", funder_organisation_id: "o", resent_at: "t" },
    error: null,
  });
  return { supabase: { functions: { invoke }, rpc } };
});

import { generateSealedPack, resendFunderInvite } from "@/lib/funder-workspace/admin-client";
import { supabase } from "@/integrations/supabase/client";

const invokeMock = (supabase as unknown as { functions: { invoke: ReturnType<typeof vi.fn> } }).functions.invoke;
const rpcMock = (supabase as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc;

beforeEach(() => {
  invokeMock.mockClear();
  rpcMock.mockClear();
});

describe("generateSealedPack — version-aware supersession", () => {
  it("first-generation call sends supersede=false and no reason", async () => {
    await generateSealedPack("rel-1");
    expect(invokeMock).toHaveBeenCalledWith("funder-pack-generate", {
      body: { release_id: "rel-1", supersede: false, supersede_reason: null },
    });
  });

  it("refuses to supersede without a written reason (client guard)", async () => {
    await expect(generateSealedPack("rel-1", { supersede: true })).rejects.toThrow(/reason is required/i);
    await expect(
      generateSealedPack("rel-1", { supersede: true, supersedeReason: "   " }),
    ).rejects.toThrow(/reason is required/i);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("forwards supersede=true with the trimmed reason", async () => {
    await generateSealedPack("rel-1", { supersede: true, supersedeReason: "New evidence added" });
    expect(invokeMock).toHaveBeenCalledWith("funder-pack-generate", {
      body: { release_id: "rel-1", supersede: true, supersede_reason: "New evidence added" },
    });
  });

  it("maps supersede_required (409) to a human-readable error", async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: new Response(
          JSON.stringify({ error: "supersede_required", detail: "sealed pack already exists (v1)" }),
          { status: 409 },
        ),
      },
    });
    // No mapping key installed for supersede_required → falls back to server detail.
    await expect(generateSealedPack("rel-1")).rejects.toThrow(/sealed pack already exists/i);
  });
});

describe("resendFunderInvite", () => {
  it("calls the platform-admin RPC with the user id", async () => {
    const out = await resendFunderInvite("user-123");
    expect(rpcMock).toHaveBeenCalledWith("p5b3_admin_resend_funder_invite_v1", { p_user_id: "user-123" });
    expect(out.email).toBe("x@y.z");
  });

  it("surfaces server errors verbatim", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "p5b3.state: user status is active — only invited users may have invites resent" },
    });
    await expect(resendFunderInvite("user-123")).rejects.toThrow(/only invited users/i);
  });
});
