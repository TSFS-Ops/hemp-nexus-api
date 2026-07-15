/**
 * Enterprise Support Centre — Batch 1 migration structural guard.
 *
 * Verifies that the Batch 1 migration files define every table, RPC and
 * safety primitive the client library and edge functions depend on.
 * A missing GRANT or RLS statement here fails CI before the API breaks.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIG_DIR = resolve(__dirname, "../../supabase/migrations");
const sql = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(resolve(MIG_DIR, f), "utf8"))
  .join("\n\n");

describe("Batch 1 support migrations — tables", () => {
  it.each([
    "support_tickets",
    "support_ticket_messages",
    "support_ticket_events",
    "support_ticket_attachments",
    "support_categories",
    "support_subcategories",
    "support_teams",
    "support_team_members",
    "support_incidents",
    "support_incident_updates",
    "support_knowledge_articles",
    "support_sla_targets",
    "support_priority_rules",
    "support_category_routing",
  ])("declares %s", (t) => {
    expect(sql).toMatch(new RegExp(`create\\s+table[^;]*\\b${t}\\b`, "i"));
  });

  it("enables RLS on support_tickets", () => {
    expect(sql).toMatch(
      /alter\s+table[^;]*support_tickets[^;]*enable\s+row\s+level\s+security/i
    );
  });

  it("grants execute or table access to authenticated on support_tickets", () => {
    expect(sql).toMatch(/grant[^;]*on[^;]*support_tickets[^;]*to\s+authenticated/i);
    expect(sql).toMatch(/grant[^;]*on[^;]*support_tickets[^;]*to\s+service_role/i);
  });
});

describe("Batch 1 support migrations — RPCs used by the client", () => {
  it.each([
    "create_support_ticket",
    "list_own_support_tickets",
    "list_org_support_tickets",
    "get_support_ticket",
    "get_support_ticket_internal",
    "list_support_ticket_customer_messages",
    "list_support_ticket_internal_notes",
    "post_support_ticket_customer_message",
    "post_support_ticket_internal_note",
    "update_support_ticket_status",
    "assign_support_ticket",
    "escalate_support_ticket",
    "register_support_ticket_attachment",
    "list_support_ticket_attachments",
    "list_public_incidents",
    "list_public_incident_updates",
    "list_published_kb_articles",
    "get_published_kb_article",
  ])("defines %s", (fn) => {
    expect(sql).toMatch(
      new RegExp(`create\\s+or\\s+replace\\s+function[^;]*\\b${fn}\\b`, "i")
    );
  });

  it("guarded SECURITY DEFINER functions pin search_path", () => {
    // A SECURITY DEFINER function without `set search_path` is a search-path
    // hijack risk. Every support function we ship must set it.
    const fnBlocks = sql.split(/create\s+or\s+replace\s+function/i).slice(1);
    const supportBlocks = fnBlocks.filter((b) =>
      /support_(ticket|incident|knowledge|categor|team|sla|priority)/i.test(
        b.split(/language/i)[0] ?? ""
      )
    );
    expect(supportBlocks.length).toBeGreaterThan(0);
    for (const b of supportBlocks) {
      const header = b.split(/\$\$/)[0] ?? "";
      if (!/security\s+definer/i.test(header)) continue;
      expect(header).toMatch(/set\s+search_path\s*=\s*public/i);
    }
  });
});

describe("Batch 1 — SLA escalation cron primitives", () => {
  it("defines escalate_overdue_support_tickets", () => {
    expect(sql).toMatch(/escalate_overdue_support_tickets/);
  });
  it("adds the SLA-escalation tracking columns", () => {
    expect(sql).toMatch(/sla_first_response_escalated_at/);
    expect(sql).toMatch(/sla_resolution_escalated_at/);
  });
});
