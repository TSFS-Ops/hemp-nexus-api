/**
 * Safety tests for extractSourceLocation() — confirms the sanitiser
 * never leaks absolute paths, URL prefixes, query strings, or arbitrary
 * tokens through the generic 500 response envelope.
 */
import { describe, it, expect } from "vitest";
import { extractSourceLocation } from "./errors.ts";

function err(stack: string): Error {
  const e = new Error("x");
  e.stack = stack;
  return e;
}

describe("extractSourceLocation()", () => {
  it("strips file:// scheme + absolute path", () => {
    const e = err(
      "Error: x\n    at handler (file:///tmp/user_fn_abc/source/supabase/functions/poi-engagements/index.ts:441:15)",
    );
    expect(extractSourceLocation(e)).toBe("index.ts:441:15");
  });

  it("strips https:// scheme + deploy host", () => {
    const e = err(
      "Error: x\n    at f (https://deno.land/x/zod@v3.22.4/types.ts:1234:9)",
    );
    expect(extractSourceLocation(e)).toBe("types.ts:1234:9");
  });

  it("strips query strings", () => {
    const e = err(
      "Error: x\n    at f (file:///app/foo.ts?v=abc123&token=secret:42:7)",
    );
    const out = extractSourceLocation(e)!;
    expect(out).toBe("foo.ts:42:7");
    expect(out).not.toMatch(/token|secret|\?/);
  });

  it("returns filename:line when col missing", () => {
    const e = err("Error: x\n    at file:///a/b/c/index.ts:99");
    expect(extractSourceLocation(e)).toBe("index.ts:99");
  });

  it("never includes absolute path separators", () => {
    const e = err(
      "Error: x\n    at h (file:///root/secret-deploy/super/secret/index.ts:1:1)",
    );
    const out = extractSourceLocation(e)!;
    expect(out).toBe("index.ts:1:1");
    expect(out).not.toContain("/");
    expect(out).not.toContain("root");
    expect(out).not.toContain("secret");
  });

  it("never leaks JWT-like tokens or emails from the stack", () => {
    const e = err(
      "Error: x\n    at f (file:///app/h.ts:1:1)\nuser@example.com eyJhbGciOi.payload.sig",
    );
    const out = extractSourceLocation(e)!;
    expect(out).toBe("h.ts:1:1");
    expect(out).not.toMatch(/@|eyJ/);
  });

  it("returns null when stack has no parsable frame", () => {
    expect(extractSourceLocation(err("no frames here"))).toBeNull();
  });

  it("returns null for missing/undefined error", () => {
    expect(extractSourceLocation(undefined)).toBeNull();
    expect(extractSourceLocation(null)).toBeNull();
  });

  it("returns null when stack is not a string", () => {
    const e = new Error("x");
    // @ts-expect-error force non-string
    e.stack = undefined;
    expect(extractSourceLocation(e)).toBeNull();
  });
});
