/**
 * PayFast Settlement-to-Bank Tracking -- Phase 1 backend foundation.
 * Static source-contract tests (no live Supabase project available in
 * this environment). Mirrors the established pattern used by
 * src/tests/api-usage-dashboard-batch-4-alerts-security-signals.test.ts.
 *
 * Verifies:
 * - payment_settlements table + RLS + five-status model
 * - reconciliation creator is idempotent and PayFast-completed-only
 * - admin update RPC enforces platform_admin + validation rules
 * - admin list RPC is platform_admin/auditor gated
 * - risk-item integration
 * - no coupling introduced into PayFast checkout/ITN/wallet code
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

function allMigrations(): string {
    const dir = path.join(ROOT, "supabase/migrations");
    let combined = "";
    for (const f of fs.readdirSync(dir)) {
          combined += "\n" + fs.readFileSync(path.join(dir, f), "utf-8");
    }
    return combined;
}
const MIG = allMigrations();

function fn(name: string): string {
    const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?\\$\\$;`, "g");
    const matches = MIG.match(re);
    expect(matches, `${name} not found`).not.toBeNull();
    return matches![matches!.length - 1];
}

describe("PayFast Settlement Tracking -- Phase 1", () => {
    it("payment_settlements table is created with the five-status model", () => {
          expect(MIG).toMatch(/CREATE TABLE IF NOT EXISTS public\.payment_settlements/);
          expect(MIG).toMatch(/CHECK \(status IN \('expected','confirmed','delayed','exception','cancelled'\)\)/);
          expect(MIG).not.toMatch(/'reconciled'/);
    });

           it("table has the required identity, amount, and lifecycle columns", () => {
                 expect(MIG).toMatch(/provider_reference text NOT NULL/);
                 expect(MIG).toMatch(/token_purchase_id uuid NOT NULL REFERENCES public\.token_purchases/);
                 expect(MIG).toMatch(/org_id uuid NOT NULL REFERENCES public\.organizations/);
                 expect(MIG).toMatch(/expected_settlement_at timestamptz NOT NULL/);
                 expect(MIG).toMatch(/bank_reference text NULL/);
                 expect(MIG).toMatch(/exception_reason text NULL/);
                 expect(MIG).toMatch(/notes jsonb NOT NULL DEFAULT '\[\]'::jsonb/);
                 expect(MIG).toMatch(/metadata jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
           });

           it("has unique constraints on (provider, provider_reference) and token_purchase_id", () => {
                 expect(MIG).toMatch(/payment_settlements_provider_reference_uidx UNIQUE \(provider, provider_reference\)/);
                 expect(MIG).toMatch(/payment_settlements_token_purchase_uidx UNIQUE \(token_purchase_id\)/);
           });

           it("confirmed status requires a bank reference at the table level as defense in depth", () => {
                 expect(MIG).toMatch(/payment_settlements_confirmed_requires_bank_ref/);
                 expect(MIG).toMatch(/CHECK \(status <> 'confirmed' OR bank_reference IS NOT NULL\)/);
           });

           it("has the required indexes for admin/reconciliation lookups", () => {
                 expect(MIG).toMatch(/idx_payment_settlements_provider_status/);
                 expect(MIG).toMatch(/idx_payment_settlements_org/);
                 expect(MIG).toMatch(/idx_payment_settlements_expected_at/);
           });

           it("RLS is enabled with a read-only platform_admin/auditor policy and no authenticated write policy", () => {
                 expect(MIG).toMatch(/ALTER TABLE public\.payment_settlements ENABLE ROW LEVEL SECURITY/);
                 expect(MIG).toMatch(/policy "platform admins and auditors read payment settlements"/i);
                 const forbidden = /create policy[\s\S]*?on public\.payment_settlements[\s\S]*?for (insert|update|delete)/i;
                 expect(forbidden.test(MIG)).toBe(false);
           });

           it("anon and authenticated have no default table privileges; service_role has full access", () => {
                 expect(MIG).toMatch(/REVOKE ALL ON public\.payment_settlements FROM anon, authenticated/);
                 expect(MIG).toMatch(/GRANT ALL ON public\.payment_settlements TO service_role/);
           });

           it("add_business_days is a conservative Mon-Fri calculator", () => {
                 const body = fn("add_business_days");
                 expect(body).toMatch(/IMMUTABLE/);
                 expect(body).toMatch(/ISODOW/);
           });

           it("create_missing_payfast_settlements_v1 only targets completed PayFast purchases and is idempotent", () => {
                 const body = fn("create_missing_payfast_settlements_v1");
                 expect(body).toMatch(/SECURITY DEFINER/);
                 expect(body).toMatch(/SET search_path = public/);
                 expect(body).toMatch(/tp\.provider = 'payfast'/);
                 expect(body).toMatch(/tp\.status = 'completed'/);
                 expect(body).toMatch(/NOT EXISTS \(/);
                 expect(body).toMatch(/ON CONFLICT \(token_purchase_id\) DO NOTHING/);
                 expect(body).toMatch(/'expected'/);
                 expect(body).toMatch(/public\.add_business_days/);
                 expect(body).not.toMatch(/token_ledger/);
                 expect(body).not.toMatch(/UPDATE public\.token_purchases/);
                 expect(body).not.toMatch(/atomic_paid_credit_purchase/);
           });

           it("payment_settlement_mark_v1 requires platform_admin and validates each action", () => {
                 const body = fn("payment_settlement_mark_v1");
                 expect(body).toMatch(/has_role\(v_uid, 'platform_admin'::public\.app_role\)/);
                 expect(body).toMatch(/bank_reference required to confirm settlement/);
                 expect(body).toMatch(/reason required to mark exception/);
                 expect(body).toMatch(/reason or note required to mark delayed/);
                 expect(body).toMatch(/note required/);
                 expect(body).toMatch(/notes \|\| jsonb_build_array/);
                 expect(body).toMatch(/admin_audit_logs/);
                 expect(body).toMatch(/payfast_settlement_exception/);
                 expect(body).not.toMatch(/token_ledger/);
                 expect(body).not.toMatch(/UPDATE public\.token_purchases/);
           });

           it("payment_settlements_list_v1 is gated to platform_admin or auditor", () => {
                 const body = fn("payment_settlements_list_v1");
                 expect(body).toMatch(/SECURITY DEFINER/);
                 expect(body).toMatch(/has_role\(v_uid, 'platform_admin'::public\.app_role\)/);
                 expect(body).toMatch(/has_role\(v_uid, 'auditor'::public\.app_role\)/);
                 expect(body).toMatch(/org_name/);
                 expect(body).toMatch(/has_refund_request/);
                 expect(body).toMatch(/has_payment_dispute/);
           });

           it("detect_payment_settlement_risks_v1 raises the two scan-based Phase 1 alerts", () => {
                 const body = fn("detect_payment_settlement_risks_v1");
                 expect(body).toMatch(/payfast_settlement_overdue/);
                 expect(body).toMatch(/payfast_paid_no_settlement_record/);
                 expect(body).toMatch(/ON CONFLICT \(dedup_key\) DO UPDATE/);
           });

           it("PayFast ITN/checkout/wallet source file remains untouched by this feature", () => {
                 const itn = read("supabase/functions/_shared/payments/payfast.ts");
                 expect(itn.includes("payment_settlements")).toBe(false);
                 expect(itn.includes("payment_settlement_mark_v1")).toBe(false);
                 expect(itn.includes("create_missing_payfast_settlements_v1")).toBe(false);
           });

           it("this test file exists at the expected path", () => {
                 expect(exists("src/tests/payfast-settlement-tracking-phase-1.test.ts")).toBe(true);
           });
});
