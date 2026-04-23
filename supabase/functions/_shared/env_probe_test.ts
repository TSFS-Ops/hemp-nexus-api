import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("env probe — list available env keys", () => {
  const keys = Object.keys(Deno.env.toObject()).sort();
  console.log("AVAILABLE ENV KEYS:", keys.join(", "));
  console.log("SUPABASE_URL present:", !!Deno.env.get("SUPABASE_URL"));
  console.log("SUPABASE_SERVICE_ROLE_KEY present:", !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  console.log("SB_URL present:", !!Deno.env.get("SB_URL"));
  console.log("SB_SERVICE_ROLE_KEY present:", !!Deno.env.get("SB_SERVICE_ROLE_KEY"));
  assert(true);
});
