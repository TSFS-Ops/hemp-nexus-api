import { describe, expect, it } from "vitest";
import { sanitizeStorageFilename } from "@/lib/storage-filenames";

describe("sanitizeStorageFilename", () => {
  it("removes URL fragment/query/control characters from upload paths", () => {
    expect(sanitizeStorageFilename("James Davies - Curriculum Vitae #1.pdf")).toBe(
      "James Davies - Curriculum Vitae _1.pdf",
    );
    expect(sanitizeStorageFilename("poa?draft%20&v=1.pdf")).toBe("poa_draft_20_v_1.pdf");
  });

  it("keeps readable safe filenames and supplies a fallback", () => {
    expect(sanitizeStorageFilename("Izenzo Logo (Enlarged).jpg")).toBe("Izenzo Logo (Enlarged).jpg");
    expect(sanitizeStorageFilename("###")).toBe("___");
    expect(sanitizeStorageFilename("   ")).toBe("document");
  });
});