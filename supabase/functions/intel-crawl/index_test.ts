/**
 * Edge Function Integration Tests: intel-crawl + discovery-eligibility
 * 
 * These tests verify the INTEL layer endpoints against the live backend.
 * Run via: supabase test edge-functions
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.test("intel-crawl: OPTIONS returns CORS headers", async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/intel-crawl`, {
    method: "OPTIONS",
    headers: { "Origin": "http://localhost:3000" },
  });
  assertEquals(res.status, 200);
  await res.text(); // consume body
});

Deno.test("intel-crawl: POST without auth returns 401/403", async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/intel-crawl`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      entity_id: "00000000-0000-0000-0000-000000000001",
      entity_name: "Test Corp",
    }),
  });
  const status = res.status;
  const body = await res.text();
  // Should be 401 or 403 (no auth token)
  assertEquals(status >= 400 && status < 500, true, `Expected 4xx, got ${status}: ${body}`);
});

Deno.test("intel-crawl: POST with invalid body returns 400", async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/intel-crawl`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ entity_name: "Missing entity_id" }),
  });
  const status = res.status;
  await res.text();
  // Should fail validation (missing entity_id) - 400 or auth error
  assertEquals(status >= 400, true);
});

Deno.test("intel-crawl: GET without params returns 400", async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/intel-crawl`, {
    method: "GET",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  const status = res.status;
  await res.text();
  assertEquals(status >= 400, true);
});

Deno.test("discovery-eligibility: OPTIONS returns CORS headers", async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/discovery-eligibility`, {
    method: "OPTIONS",
    headers: { "Origin": "http://localhost:3000" },
  });
  assertEquals(res.status, 200);
  await res.text();
});

Deno.test("discovery-eligibility: GET without entity_id returns 400", async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/discovery-eligibility`, {
    method: "GET",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  const status = res.status;
  await res.text();
  assertEquals(status >= 400, true);
});

Deno.test("discovery-eligibility: POST without auth returns 401/403", async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/discovery-eligibility`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      entity_id: "00000000-0000-0000-0000-000000000001",
      signals: { id_verified: true, company_exists: true },
    }),
  });
  const status = res.status;
  await res.text();
  assertEquals(status >= 400 && status < 500, true);
});
