import { describe, it, expect } from "vitest";
import { deriveChallengePermissions } from "@/hooks/useChallengePermissions";

const MATCH = {
  org_id: "00000000-0000-0000-0000-000000000001",
  buyer_org_id: "00000000-0000-0000-0000-000000000001",
  seller_org_id: "00000000-0000-0000-0000-000000000002",
};

describe("deriveChallengePermissions (Phase 3B)", () => {
  it("R1+R6: party org_admin sees card+banner+raise", () => {
    const p = deriveChallengePermissions({
      match: MATCH,
      viewerOrgId: MATCH.buyer_org_id,
      isPlatformAdmin: false,
      isOrgAdmin: true,
      isAuthenticated: true,
    });
    expect(p).toMatchObject({ canViewCard: true, canRaise: true, canSeeBanner: true });
  });

  it("R5: party org_member sees card+banner but cannot raise", () => {
    const p = deriveChallengePermissions({
      match: MATCH,
      viewerOrgId: MATCH.seller_org_id,
      isPlatformAdmin: false,
      isOrgAdmin: false,
      isAuthenticated: true,
    });
    expect(p).toMatchObject({ canViewCard: true, canRaise: false, canSeeBanner: true });
  });

  it("R6/R7: platform_admin sees everything regardless of org match", () => {
    const p = deriveChallengePermissions({
      match: MATCH,
      viewerOrgId: "00000000-0000-0000-0000-000000000999",
      isPlatformAdmin: true,
      isOrgAdmin: false,
      isAuthenticated: true,
    });
    expect(p).toMatchObject({ canViewCard: true, canRaise: true, canSeeBanner: true });
  });

  it("R8: unrelated org sees nothing", () => {
    const p = deriveChallengePermissions({
      match: MATCH,
      viewerOrgId: "00000000-0000-0000-0000-000000000999",
      isPlatformAdmin: false,
      isOrgAdmin: true,
      isAuthenticated: true,
    });
    expect(p).toMatchObject({ canViewCard: false, canRaise: false, canSeeBanner: false });
  });

  it("R9: unauthenticated sees nothing", () => {
    const p = deriveChallengePermissions({
      match: MATCH,
      viewerOrgId: MATCH.buyer_org_id,
      isPlatformAdmin: true,
      isOrgAdmin: true,
      isAuthenticated: false,
    });
    expect(p).toMatchObject({ canViewCard: false, canRaise: false, canSeeBanner: false });
  });
});
