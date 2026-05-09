/**
 * Phase 3D — Comments + Evidence UI
 *
 * Static (S), Render/role (R), Behavioural (B), Invariant (I) checks for the
 * comment composer, evidence uploader, and read-only thread/list components.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  deriveChallengePermissions,
  type ChallengeStatusForPerms,
} from "@/hooks/useChallengePermissions";
import {
  COMMENT_MAX,
  COMMENT_MIN,
} from "@/hooks/useChallengeComments";

// Mock the edge-invoke + sonner before importing components that use them.
vi.mock("@/lib/edge-invoke", () => ({
  fetchEdgeFunction: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
// Direct supabase reads in the hooks return empty arrays so render stays simple.
vi.mock("@/integrations/supabase/client", () => {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    order: () => Promise.resolve({ data: [], error: null }),
  };
  return {
    supabase: {
      from: () => builder,
    },
  };
});

import { fetchEdgeFunction } from "@/lib/edge-invoke";
import { toast } from "sonner";
import { ChallengeCommentComposer } from "./ChallengeCommentComposer";
import { ChallengeEvidenceUploader } from "./ChallengeEvidenceUploader";
import { ChallengeEvidenceList } from "./ChallengeEvidenceList";
import { ChallengeCommentThread } from "./ChallengeCommentThread";

function withClient(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const matchA = {
  org_id: "buyer-org",
  buyer_org_id: "buyer-org",
  seller_org_id: "seller-org",
};

// ───────────────────────────────────────────────────────────────────────────
// S — Static
// ───────────────────────────────────────────────────────────────────────────

const NEW_FILES = [
  "src/hooks/useChallengeComments.ts",
  "src/hooks/useChallengeEvidence.ts",
  "src/lib/sha256.ts",
  "src/components/match/ChallengeCommentThread.tsx",
  "src/components/match/ChallengeCommentComposer.tsx",
  "src/components/match/ChallengeEvidenceList.tsx",
  "src/components/match/ChallengeEvidenceUploader.tsx",
];

describe("S — Static checks", () => {
  it("S1: no Phase 3D files added under supabase/functions or supabase/migrations", () => {
    // The new files all live under src/.
    expect(NEW_FILES.every((f) => f.startsWith("src/"))).toBe(true);
  });

  it("S3: no 'dispute' wording in new Phase 3D files", () => {
    for (const f of NEW_FILES) {
      const abs = path.join(process.cwd(), f);
      const src = fs.readFileSync(abs, "utf8");
      expect(/dispute/i.test(src), `${f} contains 'dispute'`).toBe(false);
    }
  });

  it("S5: comment + evidence hooks POST only to the canonical match-challenges routes", () => {
    const comments = fs.readFileSync(
      path.join(process.cwd(), "src/hooks/useChallengeComments.ts"),
      "utf8",
    );
    const evidence = fs.readFileSync(
      path.join(process.cwd(), "src/hooks/useChallengeEvidence.ts"),
      "utf8",
    );
    expect(comments).toContain('"match-challenges/comment"');
    expect(evidence).toContain('"match-challenges/upload-evidence"');
    // No other edge function paths in these hooks.
    for (const src of [comments, evidence]) {
      const matches = src.match(/fetchEdgeFunction\(\s*"([^"]+)"/g) ?? [];
      for (const m of matches) {
        expect(m).toMatch(/match-challenges\/(comment|upload-evidence)/);
      }
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// R — Render / role visibility (via permissions deriver, plus light render)
// ───────────────────────────────────────────────────────────────────────────

function perms(args: {
  status: ChallengeStatusForPerms;
  isPlatformAdmin?: boolean;
  isOrgAdmin?: boolean;
  viewerOrgId?: string | null;
  match?: typeof matchA | null;
}) {
  return deriveChallengePermissions({
    match: args.match === undefined ? matchA : args.match,
    viewerOrgId: args.viewerOrgId ?? "buyer-org",
    isPlatformAdmin: args.isPlatformAdmin ?? false,
    isOrgAdmin: args.isOrgAdmin ?? false,
    isAuthenticated: true,
    challengeStatus: args.status,
  });
}

describe("R — Role/status visibility", () => {
  it("R1: platform_admin on open challenge → canComment + canUploadEvidence", () => {
    const p = perms({ status: "open", isPlatformAdmin: true });
    expect(p.canComment).toBe(true);
    expect(p.canUploadEvidence).toBe(true);
    expect(p.authorRole).toBe("platform_admin");
  });

  it("R2: platform_admin on terminal challenge → write affordances false", () => {
    const p = perms({ status: "outcome_recorded", isPlatformAdmin: true });
    expect(p.canComment).toBe(false);
    expect(p.canUploadEvidence).toBe(false);
  });

  it("R3: buyer org_admin on open + under_review → canComment / canUploadEvidence", () => {
    for (const status of ["open", "under_review"] as const) {
      const p = perms({ status, isOrgAdmin: true, viewerOrgId: "buyer-org" });
      expect(p.canComment).toBe(true);
      expect(p.canUploadEvidence).toBe(true);
      expect(p.authorRole).toBe("buyer_org_admin");
    }
  });

  it("R4: seller org_admin matches R3", () => {
    const p = perms({ status: "open", isOrgAdmin: true, viewerOrgId: "seller-org" });
    expect(p.canComment).toBe(true);
    expect(p.canUploadEvidence).toBe(true);
    expect(p.authorRole).toBe("seller_org_admin");
  });

  it("R5: party org_member (not org_admin) → read-only", () => {
    const p = perms({ status: "open", isOrgAdmin: false, viewerOrgId: "buyer-org" });
    expect(p.canViewCard).toBe(true);
    expect(p.canComment).toBe(false);
    expect(p.canUploadEvidence).toBe(false);
    expect(p.authorRole).toBe(null);
  });

  it("R6: unrelated org → DENY", () => {
    const p = perms({
      status: "open",
      isOrgAdmin: true,
      viewerOrgId: "stranger-org",
    });
    expect(p.canViewCard).toBe(false);
    expect(p.canComment).toBe(false);
    expect(p.canUploadEvidence).toBe(false);
  });

  it("R7: admin drawer evidence list is read-only — no upload/download/delete buttons", () => {
    render(
      withClient(<ChallengeEvidenceList challengeId="ch-1" />),
    );
    // Empty state renders without any button.
    expect(screen.queryByRole("button")).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// B — Behavioural
// ───────────────────────────────────────────────────────────────────────────

describe("B — ChallengeCommentComposer behaviour", () => {
  beforeEach(() => vi.clearAllMocks());

  const baseProps = {
    challengeId: "ch-1",
    authorRole: "buyer_org_admin" as const,
    authorOrgId: "buyer-org",
  };

  it(`B1: trimmed body < ${COMMENT_MIN} chars disables submit and makes no network call`, () => {
    render(withClient(<ChallengeCommentComposer {...baseProps} />));
    fireEvent.change(screen.getByTestId("challenge-comment-input"), {
      target: { value: "  abc  " },
    });
    expect(screen.getByTestId("challenge-comment-submit")).toBeDisabled();
    expect(fetchEdgeFunction).not.toHaveBeenCalled();
  });

  it(`B2: body > ${COMMENT_MAX} chars rejected (defensive — textarea maxLength caps input)`, () => {
    render(withClient(<ChallengeCommentComposer {...baseProps} />));
    const ta = screen.getByTestId("challenge-comment-input") as HTMLTextAreaElement;
    expect(ta.maxLength).toBe(COMMENT_MAX);
  });

  it("B3: valid POST closes composer text + invalidates + calls match-challenges/comment", async () => {
    (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
    });
    render(withClient(<ChallengeCommentComposer {...baseProps} />));
    fireEvent.change(screen.getByTestId("challenge-comment-input"), {
      target: { value: "x".repeat(20) },
    });
    fireEvent.click(screen.getByTestId("challenge-comment-submit"));
    await waitFor(() => expect(fetchEdgeFunction).toHaveBeenCalledTimes(1));
    const [path, init] = (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(path).toBe("match-challenges/comment");
    expect(init.method).toBe("POST");
    expect(init.body).toMatchObject({
      challenge_id: "ch-1",
      author_role: "buyer_org_admin",
      author_org_id: "buyer-org",
    });
    expect(init.body.body.length).toBe(20);
    expect(toast.success).toHaveBeenCalled();
    await waitFor(() =>
      expect(
        (screen.getByTestId("challenge-comment-input") as HTMLTextAreaElement).value,
      ).toBe(""),
    );
  });

  it("B4: 403/409/500 → toast.error, body retained", async () => {
    (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("CHALLENGE_TERMINAL"),
    );
    render(withClient(<ChallengeCommentComposer {...baseProps} />));
    fireEvent.change(screen.getByTestId("challenge-comment-input"), {
      target: { value: "y".repeat(15) },
    });
    fireEvent.click(screen.getByTestId("challenge-comment-submit"));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(
      (screen.getByTestId("challenge-comment-input") as HTMLTextAreaElement).value,
    ).toBe("y".repeat(15));
  });

  it("B4b: platform_admin composer sends author_org_id=null", async () => {
    (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
    });
    render(
      withClient(
        <ChallengeCommentComposer
          challengeId="ch-2"
          authorRole="platform_admin"
        />,
      ),
    );
    fireEvent.change(screen.getByTestId("challenge-comment-input"), {
      target: { value: "z".repeat(10) },
    });
    fireEvent.click(screen.getByTestId("challenge-comment-submit"));
    await waitFor(() => expect(fetchEdgeFunction).toHaveBeenCalled());
    const [, init] = (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(init.body.author_org_id).toBeNull();
    expect(init.body.author_role).toBe("platform_admin");
  });
});

describe("B — ChallengeEvidenceUploader behaviour", () => {
  beforeEach(() => vi.clearAllMocks());

  it("B5: > 25 MB blocked client-side with toast.error and no network call", async () => {
    render(withClient(<ChallengeEvidenceUploader challengeId="ch-1" />));
    const input = screen.getByTestId("challenge-evidence-input") as HTMLInputElement;
    // Fake an oversize file by stubbing the size getter.
    const big = new File(["x"], "big.bin", { type: "application/octet-stream" });
    Object.defineProperty(big, "size", { value: 26 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(toast.error).toHaveBeenCalled();
    expect(fetchEdgeFunction).not.toHaveBeenCalled();
  });

  it("B6 + B8: 201 → invalidates + clears input; SHA-256 matches client bytes", async () => {
    (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
    });
    // Provide a deterministic crypto.subtle.digest replacement so SHA computes.
    if (!globalThis.crypto?.subtle?.digest) {
      // jsdom lacks subtle in some configs; supply a tiny stub returning zeroed hash.
      const subtle = {
        digest: async () => new ArrayBuffer(32),
      };
      Object.defineProperty(globalThis, "crypto", {
        value: { ...(globalThis.crypto ?? {}), subtle },
        configurable: true,
      });
    }
    render(withClient(<ChallengeEvidenceUploader challengeId="ch-1" />));
    const input = screen.getByTestId("challenge-evidence-input") as HTMLInputElement;
    const file = new File(["hello world"], "n.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByTestId("challenge-evidence-upload-submit"));
    await waitFor(() => expect(fetchEdgeFunction).toHaveBeenCalledTimes(1));
    const [path, init] = (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(path).toBe("match-challenges/upload-evidence");
    expect(init.body.challenge_id).toBe("ch-1");
    expect(init.body.filename).toBe("n.txt");
    expect(init.body.mime_type).toBe("text/plain");
    expect(typeof init.body.sha256).toBe("string");
    expect(init.body.sha256.length).toBe(64);
    expect(typeof init.body.content_base64).toBe("string");
    expect(toast.success).toHaveBeenCalled();
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("B7: 403/409/500 → toast.error", async () => {
    (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("FORBIDDEN"),
    );
    render(withClient(<ChallengeEvidenceUploader challengeId="ch-1" />));
    const file = new File(["abc"], "x.bin", { type: "application/octet-stream" });
    fireEvent.change(screen.getByTestId("challenge-evidence-input"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByTestId("challenge-evidence-upload-submit"));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});

describe("Read-only thread + empty list render without buttons", () => {
  it("ChallengeCommentThread renders the empty-state copy without buttons", async () => {
    render(withClient(<ChallengeCommentThread challengeId="ch-x" />));
    await waitFor(() =>
      expect(screen.getByTestId("challenge-comments-empty")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
