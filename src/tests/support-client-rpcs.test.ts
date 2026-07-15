/**
 * Enterprise Support Centre — client wiring tests (Batch 1).
 *
 * Verifies that the src/lib/support/client.ts helpers dispatch the
 * correct Supabase RPC names / table queries with the argument shape
 * the Batch 1 backend expects. If anyone renames an RPC or drops an
 * argument, these tests fail before the runtime does.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

type RpcCall = { fn: string; args: Record<string, unknown> | undefined };
const rpcCalls: RpcCall[] = [];
const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
  rpcCalls.push({ fn, args });
  return { data: rpcReturn[fn] ?? null, error: null };
});
const rpcReturn: Record<string, unknown> = {};

type FromCall = {
  table: string;
  op?: string;
  values?: unknown;
  filters: Array<[string, string, unknown]>;
};
const fromCalls: FromCall[] = [];
function makeBuilder(table: string) {
  const state: FromCall = { table, filters: [] };
  fromCalls.push(state);
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    insert: vi.fn((v: unknown) => {
      state.op = "insert";
      state.values = v;
      return chain;
    }),
    update: vi.fn((v: unknown) => {
      state.op = "update";
      state.values = v;
      return chain;
    }),
    delete: vi.fn(() => {
      state.op = "delete";
      return chain;
    }),
    eq: vi.fn((c: string, v: unknown) => {
      state.filters.push(["eq", c, v]);
      return chain;
    }),
    ilike: vi.fn((c: string, v: unknown) => {
      state.filters.push(["ilike", c, v]);
      return chain;
    }),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    single: vi.fn(async () => ({ data: { id: "row-1" }, error: null })),
    // Thenable so `await q` resolves like a PostgREST builder.
    then: (r: (v: { data: unknown[]; error: null }) => unknown) =>
      r({ data: [], error: null }),
  };
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => rpc(fn, args),
    from: (t: string) => makeBuilder(t),
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ data: null, error: null }),
        createSignedUrl: vi
          .fn()
          .mockResolvedValue({ data: { signedUrl: "u" }, error: null }),
      }),
    },
  },
}));

import * as client from "@/lib/support/client";

beforeEach(() => {
  rpcCalls.length = 0;
  fromCalls.length = 0;
  for (const k of Object.keys(rpcReturn)) delete rpcReturn[k];
});

describe("support client — ticket lifecycle RPCs", () => {
  it("createTicket dispatches create_support_ticket with underscore args", async () => {
    rpcReturn.create_support_ticket = "ticket-1";
    const id = await client.createTicket({
      category_key: "billing",
      subcategory_key: "invoice",
      customer_impact: "affects_organisation",
      subject: "Bad invoice",
      contact_email: "a@b.co",
    });
    expect(id).toBe("ticket-1");
    const call = rpcCalls.find((c) => c.fn === "create_support_ticket");
    expect(call).toBeTruthy();
    expect(call!.args).toMatchObject({
      _category_key: "billing",
      _subcategory_key: "invoice",
      _customer_impact: "affects_organisation",
      _subject: "Bad invoice",
      _contact_email: "a@b.co",
      _on_behalf_of_user_id: null,
      _on_behalf_of_reason: null,
    });
    // Every non-provided optional field must be forwarded as null.
    for (const k of [
      "_intended_action",
      "_actual_result",
      "_occurred_at",
      "_affected_users_count",
      "_workaround_available",
      "_safe_context",
      "_contact_name",
    ]) {
      expect(call!.args).toHaveProperty(k, null);
    }
  });

  it("listOwnTickets and listOrgTickets call the correct RPCs (no args)", async () => {
    rpcReturn.list_own_support_tickets = [];
    rpcReturn.list_org_support_tickets = [];
    await client.listOwnTickets();
    await client.listOrgTickets();
    expect(rpcCalls.map((c) => c.fn)).toEqual([
      "list_own_support_tickets",
      "list_org_support_tickets",
    ]);
    expect(rpcCalls[0].args).toBeUndefined();
    expect(rpcCalls[1].args).toBeUndefined();
  });

  it("getTicket unwraps the single-row RPC response", async () => {
    rpcReturn.get_support_ticket = [{ id: "t", subject: "s" }];
    const t = await client.getTicket("t");
    expect(t.id).toBe("t");
    expect(rpcCalls[0]).toEqual({
      fn: "get_support_ticket",
      args: { _ticket_id: "t" },
    });
  });

  it("getTicket throws when the RPC returns an empty array", async () => {
    rpcReturn.get_support_ticket = [];
    await expect(client.getTicket("missing")).rejects.toThrow(/not found/i);
  });

  it("postCustomerMessage and postInternalNote use the correct RPCs", async () => {
    rpcReturn.post_support_ticket_customer_message = "m1";
    rpcReturn.post_support_ticket_internal_note = "m2";
    await client.postCustomerMessage("t", "hi");
    await client.postInternalNote("t", "note");
    expect(rpcCalls).toEqual([
      {
        fn: "post_support_ticket_customer_message",
        args: { _ticket_id: "t", _body: "hi" },
      },
      {
        fn: "post_support_ticket_internal_note",
        args: { _ticket_id: "t", _body: "note" },
      },
    ]);
  });

  it("updateStatus / assignTicket / escalateTicket forward reason strings", async () => {
    rpcReturn.assign_support_ticket = "ok";
    await client.updateStatus("t", "resolved", "fixed the thing");
    await client.assignTicket("t", "u-2", "billing", "reassigning");
    await client.escalateTicket("t", "urgent", "customer VIP");
    expect(rpcCalls.map((c) => c.fn)).toEqual([
      "update_support_ticket_status",
      "assign_support_ticket",
      "escalate_support_ticket",
    ]);
    expect(rpcCalls[0].args).toEqual({
      _ticket_id: "t",
      _new_status: "resolved",
      _reason: "fixed the thing",
    });
    expect(rpcCalls[1].args).toEqual({
      _ticket_id: "t",
      _assignee: "u-2",
      _team_key: "billing",
      _reason: "reassigning",
    });
    expect(rpcCalls[2].args).toEqual({
      _ticket_id: "t",
      _new_priority: "urgent",
      _reason: "customer VIP",
    });
  });

  it("getTicketInternal requires a reason (audit gate)", async () => {
    rpcReturn.get_support_ticket_internal = [{ id: "t" }];
    await client.getTicketInternal("t", "investigation X");
    expect(rpcCalls[0]).toEqual({
      fn: "get_support_ticket_internal",
      args: { _ticket_id: "t", _reason: "investigation X" },
    });
  });
});

describe("support client — attachments", () => {
  it("uploadAttachment rejects oversize files", async () => {
    const f = new File([new Uint8Array(21 * 1024 * 1024)], "big.pdf", {
      type: "application/pdf",
    });
    await expect(client.uploadAttachment("t", f)).rejects.toThrow(/20 MB/);
  });
  it("uploadAttachment rejects disallowed MIME types", async () => {
    const f = new File(["x"], "bad.exe", { type: "application/x-msdownload" });
    await expect(client.uploadAttachment("t", f)).rejects.toThrow(/not permitted/);
  });
});

describe("support client — admin queue filters", () => {
  it("adminListTickets scopes filters to the correct columns", async () => {
    await client.adminListTickets({
      status: "in_progress",
      priority: "high",
      team: "billing",
      q: "invoice",
    });
    const call = fromCalls.find((c) => c.table === "support_tickets");
    expect(call).toBeTruthy();
    const eqs = call!.filters.filter((f) => f[0] === "eq");
    const ilikes = call!.filters.filter((f) => f[0] === "ilike");
    expect(eqs).toEqual(
      expect.arrayContaining([
        ["eq", "status", "in_progress"],
        ["eq", "priority", "high"],
        ["eq", "current_team_key", "billing"],
      ])
    );
    expect(ilikes).toEqual([["ilike", "subject", "%invoice%"]]);
  });

  it("adminListTickets omits filters when set to 'all'", async () => {
    await client.adminListTickets({
      status: "all",
      priority: "all",
      team: "all",
    });
    const call = fromCalls.find((c) => c.table === "support_tickets")!;
    expect(call.filters).toEqual([]);
  });
});

describe("support client — knowledge base helpers", () => {
  it("slugify produces url-safe slugs", () => {
    expect(client.slugify("How do I reset my POI?")).toBe("how-do-i-reset-my-poi");
    expect(client.slugify("  --Multiple   spaces!!  ")).toBe("multiple-spaces");
    expect(client.slugify("é&#*")).toBe("");
  });

  it("adminCreateKb defaults slug from title and stamps published_at only when published", async () => {
    await client.adminCreateKb({
      title: "Reset POI Flow",
      body_md: "# hi",
      audience: "public",
      is_published: true,
    });
    const call = fromCalls.find((c) => c.table === "support_knowledge_articles")!;
    const vals = call.values as Record<string, unknown>;
    expect(vals.slug).toBe("reset-poi-flow");
    expect(vals.is_published).toBe(true);
    expect(vals.published_at).toBeTypeOf("string");

    fromCalls.length = 0;
    await client.adminCreateKb({
      title: "Draft only",
      body_md: "x",
      audience: "internal",
      is_published: false,
    });
    const draft = fromCalls.find(
      (c) => c.table === "support_knowledge_articles"
    )!;
    const dv = draft.values as Record<string, unknown>;
    expect(dv.is_published).toBe(false);
    expect(dv.published_at).toBeNull();
  });
});
