import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isActorLegalNameMissing } from "./legal-name-guard.ts";

Deno.test("rejects null profile", () => {
  assertEquals(isActorLegalNameMissing(null), true);
});

Deno.test("rejects undefined profile", () => {
  assertEquals(isActorLegalNameMissing(undefined), true);
});

Deno.test("rejects null full_name", () => {
  assertEquals(
    isActorLegalNameMissing({ full_name: null, email: "user@example.com" }),
    true,
  );
});

Deno.test("rejects empty full_name", () => {
  assertEquals(
    isActorLegalNameMissing({ full_name: "", email: "user@example.com" }),
    true,
  );
});

Deno.test("rejects whitespace-only full_name", () => {
  assertEquals(
    isActorLegalNameMissing({ full_name: "   ", email: "user@example.com" }),
    true,
  );
});

Deno.test("rejects full_name that looks like an email", () => {
  assertEquals(
    isActorLegalNameMissing({
      full_name: "someone.else@other.com",
      email: "user@example.com",
    }),
    true,
  );
});

Deno.test("rejects full_name equal to email (case-insensitive)", () => {
  assertEquals(
    isActorLegalNameMissing({
      full_name: "User@Example.com",
      email: "user@example.com",
    }),
    true,
  );
});

Deno.test("rejects full_name equal to email with surrounding whitespace", () => {
  assertEquals(
    isActorLegalNameMissing({
      full_name: "  user@example.com  ",
      email: "user@example.com",
    }),
    true,
  );
});

Deno.test("accepts a real legal name", () => {
  assertEquals(
    isActorLegalNameMissing({
      full_name: "Jane Smith",
      email: "user@example.com",
    }),
    false,
  );
});

Deno.test("accepts a real legal name with hyphens, apostrophes and accents", () => {
  assertEquals(
    isActorLegalNameMissing({
      full_name: "Mary-Jane O'Connor-Müller",
      email: "user@example.com",
    }),
    false,
  );
});

Deno.test("accepts a real legal name when email is null", () => {
  assertEquals(
    isActorLegalNameMissing({ full_name: "Jane Smith", email: null }),
    false,
  );
});

Deno.test("accepts a real legal name even when it contains the local-part of the email but is not the email itself", () => {
  assertEquals(
    isActorLegalNameMissing({
      full_name: "Jane User Smith",
      email: "user@example.com",
    }),
    false,
  );
});
