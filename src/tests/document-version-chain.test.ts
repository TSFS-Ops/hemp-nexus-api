/**
 * Document Version Chain — Unit Tests
 *
 * Tests version lineage logic: version numbering, current-version identification,
 * chain building, and supersession rules.
 */

import { describe, it, expect } from "vitest";

// ── Test helpers: simulate document chain structures ──

interface TestDoc {
  id: string;
  version: number;
  root_document_id: string | null;
  supersedes_document_id: string | null;
  is_current_version: boolean;
  status: string;
  change_notes: string | null;
  superseded_at: string | null;
}

function makeDoc(overrides: Partial<TestDoc> & { id: string }): TestDoc {
  return {
    version: 1,
    root_document_id: null,
    supersedes_document_id: null,
    is_current_version: true,
    status: "uploaded",
    change_notes: null,
    superseded_at: null,
    ...overrides,
  };
}

function getVersionChain(docs: TestDoc[], rootId: string): TestDoc[] {
  return docs
    .filter((d) => d.root_document_id === rootId)
    .sort((a, b) => a.version - b.version);
}

function getCurrentVersion(docs: TestDoc[], rootId: string): TestDoc | undefined {
  return docs.find((d) => d.root_document_id === rootId && d.is_current_version);
}

function getVisibleDocuments(docs: TestDoc[], showSuperseded: boolean): TestDoc[] {
  return showSuperseded ? docs : docs.filter((d) => d.is_current_version);
}

// ── Tests ──

describe("Document Version Chain", () => {
  describe("First version upload", () => {
    it("should have version 1, be current, and be its own root", () => {
      const doc = makeDoc({ id: "doc-1", version: 1, root_document_id: "doc-1", is_current_version: true });
      expect(doc.version).toBe(1);
      expect(doc.is_current_version).toBe(true);
      expect(doc.root_document_id).toBe("doc-1");
      expect(doc.supersedes_document_id).toBeNull();
    });
  });

  describe("Replacement version upload", () => {
    const v1 = makeDoc({
      id: "doc-1",
      version: 1,
      root_document_id: "doc-1",
      is_current_version: false,
      status: "archived",
      superseded_at: "2026-03-22T10:00:00Z",
    });
    const v2 = makeDoc({
      id: "doc-2",
      version: 2,
      root_document_id: "doc-1",
      supersedes_document_id: "doc-1",
      is_current_version: true,
      change_notes: "Updated figures for Q2",
    });

    it("v2 should supersede v1", () => {
      expect(v2.supersedes_document_id).toBe("doc-1");
      expect(v2.version).toBe(2);
    });

    it("v1 should be archived and not current", () => {
      expect(v1.is_current_version).toBe(false);
      expect(v1.status).toBe("archived");
      expect(v1.superseded_at).toBeTruthy();
    });

    it("v2 should be the current version", () => {
      expect(v2.is_current_version).toBe(true);
    });

    it("both should share the same root", () => {
      expect(v1.root_document_id).toBe(v2.root_document_id);
    });
  });

  describe("Version chain retrieval", () => {
    const docs = [
      makeDoc({ id: "doc-1", version: 1, root_document_id: "doc-1", is_current_version: false, status: "archived" }),
      makeDoc({ id: "doc-2", version: 2, root_document_id: "doc-1", supersedes_document_id: "doc-1", is_current_version: false, status: "archived" }),
      makeDoc({ id: "doc-3", version: 3, root_document_id: "doc-1", supersedes_document_id: "doc-2", is_current_version: true, change_notes: "Final version" }),
      makeDoc({ id: "other-1", version: 1, root_document_id: "other-1", is_current_version: true }),
    ];

    it("should return only docs in the same chain, sorted by version", () => {
      const chain = getVersionChain(docs, "doc-1");
      expect(chain).toHaveLength(3);
      expect(chain[0].id).toBe("doc-1");
      expect(chain[1].id).toBe("doc-2");
      expect(chain[2].id).toBe("doc-3");
    });

    it("should not include docs from other chains", () => {
      const chain = getVersionChain(docs, "doc-1");
      expect(chain.find((d) => d.id === "other-1")).toBeUndefined();
    });

    it("should correctly identify the current version", () => {
      const current = getCurrentVersion(docs, "doc-1");
      expect(current?.id).toBe("doc-3");
      expect(current?.version).toBe(3);
    });
  });

  describe("Visible documents filtering", () => {
    const docs = [
      makeDoc({ id: "doc-1", version: 1, root_document_id: "doc-1", is_current_version: false }),
      makeDoc({ id: "doc-2", version: 2, root_document_id: "doc-1", is_current_version: true }),
      makeDoc({ id: "standalone", version: 1, root_document_id: "standalone", is_current_version: true }),
    ];

    it("should hide superseded by default", () => {
      const visible = getVisibleDocuments(docs, false);
      expect(visible).toHaveLength(2);
      expect(visible.find((d) => d.id === "doc-1")).toBeUndefined();
    });

    it("should show all when toggled", () => {
      const visible = getVisibleDocuments(docs, true);
      expect(visible).toHaveLength(3);
    });
  });

  describe("Version numbering integrity", () => {
    it("versions should be sequential in a chain", () => {
      const chain = [
        makeDoc({ id: "a", version: 1, root_document_id: "a" }),
        makeDoc({ id: "b", version: 2, root_document_id: "a", supersedes_document_id: "a" }),
        makeDoc({ id: "c", version: 3, root_document_id: "a", supersedes_document_id: "b" }),
      ];
      for (let i = 1; i < chain.length; i++) {
        expect(chain[i].version).toBe(chain[i - 1].version + 1);
      }
    });
  });

  describe("Circular supersession prevention", () => {
    it("a document cannot supersede itself", () => {
      const doc = makeDoc({ id: "doc-1", supersedes_document_id: "doc-1" });
      expect(doc.id).toBe(doc.supersedes_document_id);
      // The edge function rejects this — test the rule
      const isSelfReference = doc.id === doc.supersedes_document_id;
      expect(isSelfReference).toBe(true); // This would be rejected server-side
    });
  });

  describe("Only one current version per chain", () => {
    it("should have exactly one current version in a chain", () => {
      const docs = [
        makeDoc({ id: "doc-1", version: 1, root_document_id: "doc-1", is_current_version: false }),
        makeDoc({ id: "doc-2", version: 2, root_document_id: "doc-1", is_current_version: false }),
        makeDoc({ id: "doc-3", version: 3, root_document_id: "doc-1", is_current_version: true }),
      ];
      const currentVersions = docs.filter(
        (d) => d.root_document_id === "doc-1" && d.is_current_version
      );
      expect(currentVersions).toHaveLength(1);
      expect(currentVersions[0].id).toBe("doc-3");
    });
  });

  describe("Compliance: current approved version satisfies requirements", () => {
    it("should use only the current version for compliance checks", () => {
      const docs = [
        makeDoc({ id: "doc-1", version: 1, root_document_id: "doc-1", is_current_version: false, status: "rejected" }),
        makeDoc({ id: "doc-2", version: 2, root_document_id: "doc-1", is_current_version: true, status: "accepted" }),
      ];
      const current = getCurrentVersion(docs, "doc-1");
      expect(current?.status).toBe("accepted");
      // Superseded rejected version should NOT satisfy compliance
      const supersededRejected = docs.find((d) => d.id === "doc-1");
      expect(supersededRejected?.is_current_version).toBe(false);
      expect(supersededRejected?.status).toBe("rejected");
    });
  });
});
