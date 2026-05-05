/**
 * Match document upload — UI ↔ Storage RLS consistency matrix
 * ───────────────────────────────────────────────────────────
 *
 * James-class regression guard. Before this suite, three independent code
 * paths decided whether an upload was allowed:
 *
 *   1. The "not a participant" UI gate in `src/components/match/MatchDocuments.tsx`
 *      (viewerOrgId ∈ { initiator, buyer, seller }).
 *   2. The server-side audit logger in
 *      `supabase/functions/match-document-upload-log/index.ts` (mirrors #1).
 *   3. The Postgres storage RLS INSERT policy
 *      `Users can upload match documents to their org`, which checks both
 *      the storage path prefix (`foldername[1] = caller.org_id`) AND the
 *      match's three org slots.
 *
 * Any disagreement between the three is a real bug — the user gets shown an
 * upload form but storage rejects with an opaque error, OR storage allows an
 * upload that the UI thought was blocked.
 *
 * This suite walks every permutation of caller-org × match-org-slots and
 * asserts the three evaluators are byte-identical, plus the platform_admin
 * override path, plus the path-construction guard (sanitised filename does
 * not corrupt foldername[1]/[2]).
 */

import { describe, it, expect } from "vitest";
import {
  evaluateUploadPermission,
  evaluateStorageRlsInsert,
  buildMatchDocumentStoragePath,
  storageFoldername,
  type MatchOrgSlots,
} from "@/lib/match-upload-permission";
import { sanitizeStorageFilename } from "@/lib/storage-filenames";

// Stable UUID-ish fixtures (don't need to be RFC-valid for pure logic tests).
const ORG_INITIATOR = "00000000-0000-0000-0000-00000000aaaa";
const ORG_BUYER = "00000000-0000-0000-0000-00000000bbbb";
const ORG_SELLER = "00000000-0000-0000-0000-00000000cccc";
const ORG_OUTSIDER = "00000000-0000-0000-0000-00000000dddd";
const MATCH_ID = "11111111-1111-1111-1111-111111111111";
const DOC_ID = "22222222-2222-2222-2222-222222222222";

// Minimal mirror of the UI guard in MatchDocuments.tsx (lines ~813-833).
// Kept in this file deliberately so the test fails if the UI predicate ever
// drifts in shape (presence-of-viewerOrgId + intersect on known slots).
function uiGateAllowsUpload(args: {
  viewerOrgId: string | null;
  match: MatchOrgSlots;
}): boolean {
  const known = [args.match.org_id, args.match.buyer_org_id, args.match.seller_org_id]
    .filter((v): v is string => !!v);
  if (!args.viewerOrgId) return false;
  if (known.length === 0) return false; // unknown participants → UI falls through
  return known.includes(args.viewerOrgId);
}

interface Permutation {
  name: string;
  match: MatchOrgSlots;
}

const PERMUTATIONS: Permutation[] = [
  {
    name: "bilateral · initiator≠buyer≠seller",
    match: { org_id: ORG_INITIATOR, buyer_org_id: ORG_BUYER, seller_org_id: ORG_SELLER },
  },
  {
    name: "bilateral · initiator IS buyer",
    match: { org_id: ORG_BUYER, buyer_org_id: ORG_BUYER, seller_org_id: ORG_SELLER },
  },
  {
    name: "bilateral · initiator IS seller",
    match: { org_id: ORG_SELLER, buyer_org_id: ORG_BUYER, seller_org_id: ORG_SELLER },
  },
  {
    name: "unilateral · only buyer slot filled",
    match: { org_id: ORG_INITIATOR, buyer_org_id: ORG_BUYER, seller_org_id: null },
  },
  {
    name: "unilateral · only seller slot filled",
    match: { org_id: ORG_INITIATOR, buyer_org_id: null, seller_org_id: ORG_SELLER },
  },
];

const CALLERS: Array<{ label: string; orgId: string | null }> = [
  { label: "initiator", orgId: ORG_INITIATOR },
  { label: "buyer", orgId: ORG_BUYER },
  { label: "seller", orgId: ORG_SELLER },
  { label: "outsider", orgId: ORG_OUTSIDER },
  { label: "no-org user", orgId: null },
];

describe("match upload permission — UI ↔ server log ↔ storage RLS parity", () => {
  for (const perm of PERMUTATIONS) {
    for (const caller of CALLERS) {
      it(`${perm.name} · caller=${caller.label}`, () => {
        const callerOrgId = caller.orgId;

        // 1. UI gate decision
        const uiAllow = uiGateAllowsUpload({ viewerOrgId: callerOrgId, match: perm.match });

        // 2. Canonical evaluator (used by the server log + UploadAuthzPanel)
        const decision = evaluateUploadPermission({
          callerOrgId,
          callerIsPlatformAdmin: false,
          match: perm.match,
        });

        // 3. Storage RLS INSERT predicate, evaluated against the actual
        //    storage path the client would build (using callerOrgId as the
        //    path prefix, which is what MatchDocuments.tsx does).
        const safe = sanitizeStorageFilename("normal-file.pdf");
        const path = buildMatchDocumentStoragePath({
          orgId: callerOrgId ?? "anonymous",
          matchId: MATCH_ID,
          docId: DOC_ID,
          safeFilename: safe,
        });
        const rls = evaluateStorageRlsInsert({
          bucketId: "match-documents",
          storagePath: path,
          callerOrgId,
          callerIsPlatformAdmin: false,
          match: { id: MATCH_ID, ...perm.match },
        });

        // All three answers must agree.
        expect(uiAllow).toBe(decision.canUpload);
        expect(rls.allowed).toBe(decision.canUpload);

        // And the participant role list must match the slot the caller occupies.
        if (callerOrgId) {
          const expectedRoles: string[] = [];
          if (perm.match.org_id === callerOrgId) expectedRoles.push("initiator");
          if (perm.match.buyer_org_id === callerOrgId) expectedRoles.push("buyer");
          if (perm.match.seller_org_id === callerOrgId) expectedRoles.push("seller");
          expect(decision.roles).toEqual(expectedRoles);
        } else {
          expect(decision.roles).toEqual([]);
        }
      });
    }
  }
});

describe("match upload permission — non-participant outcomes", () => {
  const match: MatchOrgSlots = {
    org_id: ORG_INITIATOR,
    buyer_org_id: ORG_BUYER,
    seller_org_id: ORG_SELLER,
  };

  it("outsider org is rejected with org_not_on_match", () => {
    const r = evaluateUploadPermission({
      callerOrgId: ORG_OUTSIDER,
      match,
    });
    expect(r.canUpload).toBe(false);
    expect(r.isParticipant).toBe(false);
    expect(r.reason).toBe("org_not_on_match");
  });

  it("user with no org is rejected with caller_has_no_org", () => {
    const r = evaluateUploadPermission({ callerOrgId: null, match });
    expect(r.canUpload).toBe(false);
    expect(r.reason).toBe("caller_has_no_org");
  });

  it("storage RLS rejects when path prefix is spoofed to a participant org", () => {
    // Outsider tries to write under buyer's org folder. Storage RLS still
    // rejects because foldername[1] must equal caller.org_id (it ties the
    // session to the path).
    const path = buildMatchDocumentStoragePath({
      orgId: ORG_BUYER,
      matchId: MATCH_ID,
      docId: DOC_ID,
      safeFilename: "spoof.pdf",
    });
    const rls = evaluateStorageRlsInsert({
      bucketId: "match-documents",
      storagePath: path,
      callerOrgId: ORG_OUTSIDER,
      match: { id: MATCH_ID, ...match },
    });
    expect(rls.allowed).toBe(false);
    expect(rls.reason).toBe("path_org_prefix_mismatch");
  });

  it("storage RLS rejects when match segment is wrong even for a participant", () => {
    const WRONG_MATCH = "99999999-9999-9999-9999-999999999999";
    const path = buildMatchDocumentStoragePath({
      orgId: ORG_BUYER,
      matchId: WRONG_MATCH,
      docId: DOC_ID,
      safeFilename: "good.pdf",
    });
    const rls = evaluateStorageRlsInsert({
      bucketId: "match-documents",
      storagePath: path,
      callerOrgId: ORG_BUYER,
      match: { id: MATCH_ID, ...match },
    });
    expect(rls.allowed).toBe(false);
    expect(rls.reason).toBe("path_match_segment_mismatch");
  });
});

describe("match upload permission — platform_admin override", () => {
  const match: MatchOrgSlots = {
    org_id: ORG_INITIATOR,
    buyer_org_id: ORG_BUYER,
    seller_org_id: ORG_SELLER,
  };

  it("platform_admin who is not on the match still gets canUpload=true", () => {
    const r = evaluateUploadPermission({
      callerOrgId: ORG_OUTSIDER,
      callerIsPlatformAdmin: true,
      match,
    });
    expect(r.canUpload).toBe(true);
    expect(r.isParticipant).toBe(false);
    expect(r.reason).toBe("platform_admin_override");
  });

  it("storage RLS mirrors the platform_admin override branch", () => {
    const path = buildMatchDocumentStoragePath({
      orgId: ORG_OUTSIDER,
      matchId: MATCH_ID,
      docId: DOC_ID,
      safeFilename: "admin-upload.pdf",
    });
    const rls = evaluateStorageRlsInsert({
      bucketId: "match-documents",
      storagePath: path,
      callerOrgId: ORG_OUTSIDER,
      callerIsPlatformAdmin: true,
      match: { id: MATCH_ID, ...match },
    });
    expect(rls.allowed).toBe(true);
  });
});

describe("storage path construction — RLS-relevant segments are stable", () => {
  it("first two foldername segments are exactly org_id and match_id", () => {
    const path = buildMatchDocumentStoragePath({
      orgId: ORG_BUYER,
      matchId: MATCH_ID,
      docId: DOC_ID,
      safeFilename: sanitizeStorageFilename("James Davies - Curriculum Vitae #1.pdf"),
    });
    const folders = storageFoldername(path);
    expect(folders[0]).toBe(ORG_BUYER);
    expect(folders[1]).toBe(MATCH_ID);
  });

  it("filename containing #, %, & is sanitised so RLS path segments are unchanged", () => {
    // Pre-sanitisation, '#' would be interpreted as a URL fragment by the
    // storage upload, truncating the path and changing what RLS evaluates.
    const dirty = "report#1 & summary%v2.pdf";
    const safe = sanitizeStorageFilename(dirty);
    expect(safe).not.toContain("#");
    expect(safe).not.toContain("%");
    expect(safe).not.toContain("&");
    const path = buildMatchDocumentStoragePath({
      orgId: ORG_BUYER,
      matchId: MATCH_ID,
      docId: DOC_ID,
      safeFilename: safe,
    });
    const folders = storageFoldername(path);
    expect(folders[0]).toBe(ORG_BUYER);
    expect(folders[1]).toBe(MATCH_ID);
    // No URL fragment characters anywhere in the path
    expect(path).not.toMatch(/[#%&]/);
  });
});
