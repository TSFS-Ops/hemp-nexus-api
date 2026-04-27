// Probe what env vars are available in the test runner's environment.
import "https://deno.land/std@0.224.0/dotenv/load.ts";

Deno.test("probe: env vars visible to test runner", () => {
  const interesting = [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_DB_URL",
  ];
  for (const k of interesting) {
    const v = Deno.env.get(k);
    console.log(`${k}=${v ? `[set len=${v.length}]` : "[unset]"}`);
  }
});
