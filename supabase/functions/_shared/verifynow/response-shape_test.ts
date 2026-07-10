/**
 * Batch V — Tests for the redacted response-shape summariser.
 *
 * Proves the summariser NEVER carries primitive values through, only
 * structure. Any leak of a raw ID number, name, DoB, token, etc. would
 * be caught here.
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { summariseResponseShape } from "./response-shape.ts";

const SENSITIVE_MARKERS = [
  "8001015009087",
  "9111060123086",
  "12345678901",
  "Tendai",
  "Tshamu",
  "tendaitshamu@icloud.com",
  "sk_live_",
  "Bearer ",
  "1980-01-01",
  "27821234567",
];

function assertNoSensitive(json: string) {
  for (const m of SENSITIVE_MARKERS) {
    assert(!json.includes(m), `leaked sensitive marker: ${m}`);
  }
}

Deno.test("summariser strips primitive values from a realistic body", () => {
  const body = {
    verified: true,
    reference: "REF-ABC-123",
    idNumber: "8001015009087",
    person: {
      first_names: "Tendai",
      surname: "Tshamu",
      date_of_birth: "1980-01-01",
      contact: { email: "tendaitshamu@icloud.com", phone: "27821234567" },
    },
    tokens: ["Bearer abcxyz", "sk_live_xyz"],
    score: 0.97,
  };
  const shape = summariseResponseShape(body);
  const j = JSON.stringify(shape);
  assertNoSensitive(j);
  // structure preserved
  assertEquals(shape.kind, "object");
  if (shape.kind === "object") {
    assertEquals(shape.keys.verified.kind, "primitive");
    assertEquals(shape.keys.reference.kind, "primitive");
    assertEquals(shape.keys.idNumber.kind, "primitive");
    assertEquals(shape.keys.person.kind, "object");
    assertEquals(shape.keys.tokens.kind, "array");
    assertEquals(shape.keys.score.kind, "primitive");
  }
});

Deno.test("summariser records primitive TYPES but never values", () => {
  const shape = summariseResponseShape({ s: "secret", n: 42, b: false, z: null });
  assertEquals(shape.kind, "object");
  if (shape.kind === "object") {
    assertEquals(shape.keys.s, { kind: "primitive", type: "string" });
    assertEquals(shape.keys.n, { kind: "primitive", type: "number" });
    assertEquals(shape.keys.b, { kind: "primitive", type: "boolean" });
    assertEquals(shape.keys.z, { kind: "null" });
  }
  const j = JSON.stringify(shape);
  assert(!j.includes("secret"));
  assert(!j.includes("42"));
  assert(!j.includes("false"));
});

Deno.test("summariser handles arrays without leaking element values", () => {
  const shape = summariseResponseShape(["8001015009087", "9111060123086", "12345678901"]);
  assertEquals(shape.kind, "array");
  if (shape.kind === "array") {
    assertEquals(shape.length, 3);
    assertEquals(shape.element_types, ["string"]);
  }
  assertNoSensitive(JSON.stringify(shape));
});

Deno.test("summariser marks arrays as truncated past the sample cap", () => {
  const big = new Array(50).fill("x");
  const shape = summariseResponseShape(big);
  if (shape.kind !== "array") throw new Error("expected array");
  assertEquals(shape.length, 50);
  assertEquals(shape.truncated, true);
});

Deno.test("summariser bounds recursion depth", () => {
  let nested: unknown = { leaf: "secret-value-8001015009087" };
  for (let i = 0; i < 10; i++) nested = { deeper: nested };
  const shape = summariseResponseShape(nested);
  assertNoSensitive(JSON.stringify(shape));
});

Deno.test("summariser handles null / non-object bodies safely", () => {
  assertEquals(summariseResponseShape(null), { kind: "null" });
  assertEquals(summariseResponseShape("raw-text"), { kind: "primitive", type: "string" });
  assertEquals(summariseResponseShape(undefined).kind, "non_json");
});

Deno.test("summariser tolerates non-JSON exotic values", () => {
  const shape = summariseResponseShape({ fn: () => 1, big: BigInt(1), sym: Symbol("x") });
  assertEquals(shape.kind, "object");
  if (shape.kind === "object") {
    assertEquals(shape.keys.fn.kind, "non_json");
    assertEquals(shape.keys.big.kind, "non_json");
    assertEquals(shape.keys.sym.kind, "non_json");
  }
});

Deno.test("summariser caps very wide objects", () => {
  const wide: Record<string, unknown> = {};
  for (let i = 0; i < 200; i++) wide["k" + i] = "v" + i;
  const shape = summariseResponseShape(wide);
  if (shape.kind !== "object") throw new Error("expected object");
  assertEquals(shape.truncated, true);
  assert(Object.keys(shape.keys).length <= 50);
  assertNoSensitive(JSON.stringify(shape));
});
