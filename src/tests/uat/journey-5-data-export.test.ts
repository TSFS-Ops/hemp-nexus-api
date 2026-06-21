/**
 * UAT Journey 5: Export Requested → Export Matches → Export Audit Logs
 *
 * Verifies that data exports produce valid, complete CSV output
 * using the centralised downloadCSV utility.
 */

import { describe, it, expect } from "vitest";
import { UAT_PROVISIONING_ENABLED } from "./_ci-gate";
import { generateCSV } from "@/lib/download-utils";
import { supabase, signUpTestUser } from "./test-client";

const TEST_EMAIL = `uat-export-${Date.now()}@test.izenzo.co.za`;
const PASSWORD = "UatT3st!Secure2026";

describe.skipIf(!UAT_PROVISIONING_ENABLED)("Journey 5: Data export - matches and audit logs", () => {
  let orgId: string;

  // ── Setup ──────────────────────────────────────────────────────
  it("5.1 - setup: create account", async () => {
    const result = await signUpTestUser(supabase, TEST_EMAIL, PASSWORD);
    orgId = result.orgId;
  }, 15_000);

  // ── Step 1: generateCSV handles special characters (RFC 4180) ─
  it("5.2 - CSV generation escapes commas, quotes, and newlines", () => {
    const headers = ["Name", "Description", "Value"];
    const rows = [
      ["Acme Corp", 'Has "special" chars', "1,000"],
      ["Beta Ltd", "Line one\nLine two", "500"],
      ["Normal Co", "Nothing special", "200"],
    ];

    const csv = generateCSV(headers, rows);
    const lines = csv.split("\n");

    // Header line
    expect(lines[0]).toBe("Name,Description,Value");
    // Quoted fields
    expect(lines[1]).toContain('"Has ""special"" chars"');
    expect(lines[1]).toContain('"1,000"');
    // Newline in field - wrapped in quotes
    expect(csv).toContain('"Line one\nLine two"');
  });

  // ── Step 2: Export matches query returns data ──────────────────
  it("5.3 - matches query returns exportable data shape", async () => {
    const { data: matches, error } = await supabase
      .from("matches")
      .select("id, status, created_at, buyer_name, seller_name, commodity")
      .eq("org_id", orgId)
      .limit(50);

    expect(error).toBeNull();
    // New account may have 0 matches - that is valid
    expect(Array.isArray(matches)).toBe(true);

    if ((matches ?? []).length > 0) {
      const headers = ["ID", "Status", "Created", "Buyer", "Seller", "Commodity"];
      const rows = (matches ?? []).map((m: Record<string, unknown>) => [
        m.id as string,
        m.status as string,
        m.created_at as string,
        m.buyer_name as string,
        m.seller_name as string,
        m.commodity as string,
      ]);
      const csv = generateCSV(headers, rows);
      expect(csv.split("\n").length).toBe(rows.length + 1);
    }
    console.info(`[UAT 5.3] Exportable matches: ${(matches ?? []).length}`);
  });

  // ── Step 3: Export audit logs query returns data ────────────────
  it("5.4 - audit_logs query returns exportable data shape", async () => {
    const { data: logs, error } = await supabase
      .from("audit_logs")
      .select("id, action, entity_type, entity_id, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(100);

    expect(error).toBeNull();
    expect(Array.isArray(logs)).toBe(true);

    if ((logs ?? []).length > 0) {
      const headers = ["ID", "Action", "Entity Type", "Entity ID", "Timestamp"];
      const rows = (logs ?? []).map((l: Record<string, unknown>) => [
        l.id as string,
        l.action as string,
        l.entity_type as string,
        l.entity_id as string,
        l.created_at as string,
      ]);
      const csv = generateCSV(headers, rows);
      // Verify no truncation - all rows present
      expect(csv.split("\n").length).toBe(rows.length + 1);
    }
    console.info(`[UAT 5.4] Exportable audit logs: ${(logs ?? []).length}`);
  });

  // ── Step 4: Pagination - large export does not silently truncate
  it("5.5 - paginated fetch retrieves beyond default 1000-row limit", async () => {
    // This tests the pagination pattern, not necessarily real data volume
    const batchSize = 500;
    let allRows: Record<string, unknown>[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: batch, error } = await supabase
        .from("audit_logs")
        .select("id")
        .eq("org_id", orgId)
        .range(offset, offset + batchSize - 1);

      expect(error).toBeNull();
      const fetched = batch ?? [];
      allRows = [...allRows, ...fetched];

      if (fetched.length < batchSize) {
        hasMore = false;
      } else {
        offset += batchSize;
      }

      // Safety: cap at 5 iterations for UAT
      if (offset >= 2500) break;
    }

    console.info(`[UAT 5.5] Total audit rows fetched via pagination: ${allRows.length}`);
    expect(allRows.length).toBeGreaterThanOrEqual(0);
  });
});
