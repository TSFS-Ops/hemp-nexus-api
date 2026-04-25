import { describe, it, expect, beforeEach } from "vitest";
import {
  loadAttestError,
  saveAttestError,
  clearAttestError,
} from "./attest-error-storage";

beforeEach(() => sessionStorage.clear());

describe("attest-error-storage", () => {
  it("round-trips an error with requestId and kind", () => {
    saveAttestError("wad-1", { message: "boom", requestId: "req-1", kind: "server_error" });
    const loaded = loadAttestError("wad-1");
    expect(loaded?.message).toBe("boom");
    expect(loaded?.requestId).toBe("req-1");
    expect(loaded?.kind).toBe("server_error");
    expect(typeof loaded?.savedAt).toBe("number");
  });

  it("scopes entries per wadId", () => {
    saveAttestError("wad-A", { message: "A failed" });
    saveAttestError("wad-B", { message: "B failed", requestId: "req-B" });
    expect(loadAttestError("wad-A")?.message).toBe("A failed");
    expect(loadAttestError("wad-B")?.requestId).toBe("req-B");
  });

  it("clearAttestError removes the entry", () => {
    saveAttestError("wad-1", { message: "boom" });
    clearAttestError("wad-1");
    expect(loadAttestError("wad-1")).toBeNull();
  });

  it("ignores entries older than 24h and removes them", () => {
    const stale = { message: "old", savedAt: Date.now() - 25 * 60 * 60 * 1000 };
    sessionStorage.setItem("wad:attestError:wad-1", JSON.stringify(stale));
    expect(loadAttestError("wad-1")).toBeNull();
    expect(sessionStorage.getItem("wad:attestError:wad-1")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    sessionStorage.setItem("wad:attestError:wad-1", "{not json");
    expect(loadAttestError("wad-1")).toBeNull();
  });
});
