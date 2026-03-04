/**
 * V3 Deal Pipeline — Integration Tests (Sprint 8)
 *
 * Validates the end-to-end flow:
 *   Entities → ATB/UBO → Due Diligence → Trade Approval → PoD → Compliance
 *
 * These are structural/contract tests — they validate SDK types,
 * request shapes, and response parsing without hitting live endpoints.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { IzenzoClient } from "@/lib/izenzo-sdk";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

function envelopeResponse(data: unknown, status = 200) {
  return jsonResponse(
    { status: "SUCCESS", timestamp: new Date().toISOString(), correlation_id: "test-123", data },
    status,
  );
}

describe("V3 SDK — Entities Resource", () => {
  let client: IzenzoClient;
  beforeEach(() => {
    client = new IzenzoClient("sk_test_key");
    mockFetch.mockReset();
  });

  it("creates an entity", async () => {
    const entity = { id: "e1", org_id: "o1", legal_name: "Acme Ltd", entity_type: "company", jurisdiction_code: "ZA", status: "active", created_at: "2026-03-04T00:00:00Z" };
    mockFetch.mockReturnValueOnce(jsonResponse(entity, 201));

    const result = await client.entities.create({ legal_name: "Acme Ltd", entity_type: "company", jurisdiction_code: "ZA" });
    expect(result).toEqual(entity);
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe("POST");
    expect(url).toContain("/entities");
  });

  it("lists entities with filters", async () => {
    mockFetch.mockReturnValueOnce(envelopeResponse([]));

    const result = await client.entities.list({ status: "active" });
    expect(result).toEqual([]);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("status=active");
  });
});

describe("V3 SDK — Authority Resource", () => {
  let client: IzenzoClient;
  beforeEach(() => {
    client = new IzenzoClient("sk_test_key");
    mockFetch.mockReset();
  });

  it("creates a UBO link", async () => {
    const ubo = { id: "u1", person_entity_id: "p1", company_entity_id: "c1", ownership_percentage: 51, status: "verified" };
    mockFetch.mockReturnValueOnce(envelopeResponse(ubo, 201));

    const result = await client.authority.createUbo("p1", "c1", 51);
    expect(result.ownership_percentage).toBe(51);

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.action).toBe("ubo_create");
  });

  it("checks ATB/UBO gates", async () => {
    const gates = { ubo_passed: true, atb_passed: false, total_ownership: 100, verified_ubo_count: 2, active_atb_count: 0 };
    mockFetch.mockReturnValueOnce(envelopeResponse(gates));

    const result = await client.authority.checkGates("p1", "c1");
    expect(result.ubo_passed).toBe(true);
    expect(result.atb_passed).toBe(false);
  });
});

describe("V3 SDK — Trade Approvals Resource", () => {
  let client: IzenzoClient;
  beforeEach(() => {
    client = new IzenzoClient("sk_test_key");
    mockFetch.mockReset();
  });

  it("gets trade status", async () => {
    const status = { org_id: "o1", approved_to_trade: true, trade_status: "approved", approved_at: "2026-03-01T00:00:00Z", risk_band: "low", valid_until: "2027-03-01T00:00:00Z" };
    mockFetch.mockReturnValueOnce(jsonResponse(status));

    const result = await client.tradeApprovals.getStatus("o1");
    expect(result.approved_to_trade).toBe(true);
    expect(result.risk_band).toBe("low");
  });

  it("issues a trade approval", async () => {
    const approval = { org_id: "o1", approved_to_trade: true, trade_status: "approved", approved_at: "2026-03-04T00:00:00Z", risk_band: "medium", valid_until: "2027-03-04T00:00:00Z" };
    mockFetch.mockReturnValueOnce(envelopeResponse(approval, 201));

    const result = await client.tradeApprovals.issue("o1", 365);
    expect(result.trade_status).toBe("approved");
  });
});

describe("V3 SDK — PoDs Resource", () => {
  let client: IzenzoClient;
  beforeEach(() => {
    client = new IzenzoClient("sk_test_key");
    mockFetch.mockReset();
  });

  it("creates a PoD with milestones", async () => {
    const pod = { id: "pod1", org_id: "o1", wad_id: "w1", state: "IN_PROGRESS", created_at: "2026-03-04T00:00:00Z", finalised_at: null };
    mockFetch.mockReturnValueOnce(envelopeResponse(pod, 201));

    const result = await client.pods.create(
      { wad_id: "w1", milestones: [{ name: "Deliver goods", due_at: "2026-04-01T00:00:00Z" }] },
      "idem-key-1",
    );
    expect(result.state).toBe("IN_PROGRESS");

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["Idempotency-Key"]).toBe("idem-key-1");
  });

  it("lists PoDs", async () => {
    mockFetch.mockReturnValueOnce(envelopeResponse([]));

    const result = await client.pods.list();
    expect(result).toEqual([]);
  });
});

describe("V3 SDK — Compliance Cases Resource", () => {
  let client: IzenzoClient;
  beforeEach(() => {
    client = new IzenzoClient("sk_test_key");
    mockFetch.mockReset();
  });

  it("opens a compliance case", async () => {
    const cc = { id: "cc1", org_id: "o1", entity_id: "e1", status: "open", decided_at: null, decision_notes: null, created_at: "2026-03-04T00:00:00Z" };
    mockFetch.mockReturnValueOnce(envelopeResponse(cc, 201));

    const result = await client.complianceCases.open("e1");
    expect(result.status).toBe("open");
  });

  it("decides a compliance case", async () => {
    const cc = { id: "cc1", org_id: "o1", entity_id: "e1", status: "cleared", decided_at: "2026-03-04T12:00:00Z", decision_notes: "All clear", created_at: "2026-03-04T00:00:00Z" };
    mockFetch.mockReturnValueOnce(envelopeResponse(cc));

    const result = await client.complianceCases.decide("cc1", "cleared", "All clear");
    expect(result.status).toBe("cleared");

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe("PATCH");
  });
});

describe("V3 SDK — Client instantiation", () => {
  it("exposes all V3 resources", () => {
    const client = new IzenzoClient("sk_test");
    expect(client.entities).toBeDefined();
    expect(client.authority).toBeDefined();
    expect(client.tradeApprovals).toBeDefined();
    expect(client.pods).toBeDefined();
    expect(client.complianceCases).toBeDefined();
  });
});
