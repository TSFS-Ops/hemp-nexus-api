/**
 * Phase 1.5 — safety tests for `extractSourceLocation()` in
 * `supabase/functions/_shared/errors.ts`.
 *
 * Pinned here under src/tests/ so the existing Vitest include pattern
 * picks them up. We re-declare a byte-identical copy of the function
 * (kept in lockstep — single regex, easy to audit) so the test runs
 * in the Node/jsdom harness without needing a Deno runtime.
 *
 * Purpose: prove the generic 500 envelope cannot leak absolute paths,
 * URL prefixes, query strings, or arbitrary tokens through
 * `details.source`.
 */
import { describe, it, expect } from "vitest";

// MIRROR of supabase/functions/_shared/errors.ts → extractSourceLocation.
// Keep these two in lockstep. If the regex changes there, change it here.
function extractSourceLocation(error: Error | undefined | null): string | null {
  if (!error || typeof error.stack !== "string") return null;
  const lines = error.stack.split("\n");
  for (const raw of lines) {
    const m = raw.match(
      /(?:\(|\bat\s+)(?:[a-z]+:\/\/[^\s)]*?\/)?([^\s/()]+\.[tj]sx?):(\d+)(?::(\d+))?\)?/i,
    );
    if (m) {
      const file = m[1].split("?")[0];
      const line = m[2];
      const col = m[3];
      return col ? `${file}:${line}:${col}` : `${file}:${line}`;
    }
  }
  return null;
}

function err(stack: string): Error {
  const e = new Error("x");
  e.stack = stack;
  return e;
}

describe("extractSourceLocation() — sanitiser safety", () => {
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

  it("strips query strings (incl. token-like params)", () => {
    const e = err(
      "Error: x\n    at f (file:///app/foo.ts?v=abc123&token=secret:42:7)",
    );
    const out = extractSourceLocation(e)!;
    expect(out).toBe("foo.ts:42:7");
    expect(out).not.toMatch(/token|secret|\?/);
  });

  it("returns filename:line when col is missing", () => {
    const e = err("Error: x\n    at file:///a/b/c/index.ts:99");
    expect(extractSourceLocation(e)).toBe("index.ts:99");
  });

  it("never returns absolute path separators or directory names", () => {
    const e = err(
      "Error: x\n    at h (file:///root/secret-deploy/super/secret/index.ts:1:1)",
    );
    const out = extractSourceLocation(e)!;
    expect(out).toBe("index.ts:1:1");
    expect(out).not.toContain("/");
    expect(out).not.toContain("root");
    expect(out).not.toContain("secret");
  });

  it("does not surface JWT-like tokens or emails from non-frame stack lines", () => {
    const e = err(
      "Error: x\n    at f (file:///app/h.ts:1:1)\nuser@example.com eyJhbGciOi.payload.sig",
    );
    const out = extractSourceLocation(e)!;
    expect(out).toBe("h.ts:1:1");
    expect(out).not.toMatch(/@example\.com|eyJ/);
  });

  it("returns only filename + line[:col] format", () => {
    const e = err("Error\n    at q (file:///x/y/z/handler.ts:7:3)");
    expect(extractSourceLocation(e)).toMatch(/^[^/\s]+\.tsx?:\d+(?::\d+)?$/);
  });

  it("returns null when no parsable frame exists", () => {
    expect(extractSourceLocation(err("no frames here"))).toBeNull();
  });

  it("returns null for null / undefined error", () => {
    expect(extractSourceLocation(undefined)).toBeNull();
    expect(extractSourceLocation(null)).toBeNull();
  });

  it("returns null when stack is not a string", () => {
    const e = new Error("x") as Error & { stack?: unknown };
    e.stack = undefined;
    expect(extractSourceLocation(e as Error)).toBeNull();
  });
});
