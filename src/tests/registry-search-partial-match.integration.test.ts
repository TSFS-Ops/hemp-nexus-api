/**
 * Integration test — registry-company-search edge function.
 *
 * Verifies that partial queries return the expected seeded companies
 * (Batch 21 UAT uploads) and that the country filter scopes results.
 *
 * Hits the live deployed edge function using the publishable anon key
 * from .env. Skipped if env vars are missing.
 */
import { describe, it, expect } from "vitest";

const SUPABASE_URL =
  (import.meta as any).env?.VITE_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY =
  (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const enabled = Boolean(SUPABASE_URL && ANON_KEY);
const d = enabled ? describe : describe.skip;

async function search(body: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/registry-company-search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY!,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

d("registry-company-search partial-match integration", () => {
  it("partial 'starf' returns Starfair 162", async () => {
    const { status, json } = await search({ query: "starf" });
    expect(status).toBe(200);
    const names = (json.results ?? []).map((r: any) => r.company_name);
    expect(names).toContain("Starfair 162");
  }, 20_000);

  it("partial 'harith' returns Harith Holdings", async () => {
    const { json } = await search({ query: "harith" });
    const names = (json.results ?? []).map((r: any) => r.company_name);
    expect(names).toContain("Harith Holdings");
  }, 20_000);

  it("partial 'dangote' returns Dangote Fertiliser Limited", async () => {
    const { json } = await search({ query: "dangote" });
    const names = (json.results ?? []).map((r: any) => r.company_name);
    expect(names).toContain("Dangote Fertiliser Limited");
  }, 20_000);

  it("country=NG filter excludes ZA companies", async () => {
    const { json } = await search({ query: "a", country_code: "NG" });
    const countries = new Set((json.results ?? []).map((r: any) => r.country_code));
    expect(countries.has("ZA")).toBe(false);
  }, 20_000);

  it("country=ZA filter excludes NG companies", async () => {
    const { json } = await search({ query: "a", country_code: "ZA" });
    const countries = new Set((json.results ?? []).map((r: any) => r.country_code));
    expect(countries.has("NG")).toBe(false);
  }, 20_000);

  it("match_reasons include field_label and value_raw", async () => {
    const { json } = await search({ query: "starfair" });
    const star = (json.results ?? []).find(
      (r: any) => r.company_name === "Starfair 162",
    );
    expect(star).toBeTruthy();
    expect(Array.isArray(star.match_reasons)).toBe(true);
    expect(star.match_reasons.length).toBeGreaterThan(0);
    for (const m of star.match_reasons) {
      expect(typeof m.field_label).toBe("string");
      expect(typeof m.value_raw).toBe("string");
    }
  }, 20_000);
});
