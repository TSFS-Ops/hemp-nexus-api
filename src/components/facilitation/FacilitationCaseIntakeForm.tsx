/**
 * FacilitationCaseIntakeForm — Phase 1 client intake.
 * Requires ?trade_request_id=... in the URL.
 * Submits to create-facilitation-case. No outreach.
 */
import React, { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { BackButton } from "@/components/BackButton";

export const FacilitationCaseIntakeForm: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tradeRequestId = params.get("trade_request_id") ?? "";
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    counterparty_legal_name: "",
    counterparty_trading_name: "",
    counterparty_country: "",
    counterparty_city: "",
    counterparty_website: "",
    counterparty_email: "",
    counterparty_phone: "",
    counterparty_contact_name: "",
    product_or_commodity: "",
    role: "buyer" as "buyer" | "seller",
    estimated_value_amount: "",
    estimated_value_currency: "USD",
    urgency: "normal" as "low" | "normal" | "high" | "critical",
    reason: "",
    how_user_knows_counterparty: "",
    how_user_knows_notes: "",
    permission_to_contact: false,
    user_declaration_accepted: false,
  });

  const set = (k: keyof typeof form, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tradeRequestId) {
      toast.error("Missing trade_request_id — cannot create a facilitation case.");
      return;
    }
    if (!form.user_declaration_accepted) {
      toast.error("You must accept the declaration to continue.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-facilitation-case", {
        body: {
          trade_request_id: tradeRequestId,
          counterparty_legal_name: form.counterparty_legal_name.trim(),
          counterparty_trading_name: form.counterparty_trading_name.trim() || null,
          counterparty_country: form.counterparty_country.trim(),
          counterparty_city: form.counterparty_city.trim() || null,
          counterparty_website: form.counterparty_website.trim() || null,
          counterparty_email: form.counterparty_email.trim() || null,
          counterparty_phone: form.counterparty_phone.trim() || null,
          counterparty_contact_name: form.counterparty_contact_name.trim() || null,
          product_or_commodity: form.product_or_commodity.trim(),
          role: form.role,
          estimated_value_amount: Number(form.estimated_value_amount) || 0,
          estimated_value_currency: form.estimated_value_currency.trim().toUpperCase(),
          urgency: form.urgency,
          reason: form.reason.trim(),
          how_user_knows_counterparty: form.how_user_knows_counterparty.trim(),
          how_user_knows_notes: form.how_user_knows_notes.trim() || null,
          permission_to_contact: form.permission_to_contact,
          user_declaration_accepted: true,
        },
      });
      if (error) throw error;
      const created = (data as { case?: { id: string } })?.case;
      if (!created?.id) throw new Error("Server did not return a case id");
      toast.success("Facilitation case submitted.");
      navigate(`/desk/facilitation/${created.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Submission failed";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <BackButton />
      <header className="mb-6 mt-4">
        <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-slate-400 mb-3">
          Unknown-Counterparty Facilitation
        </p>
        <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">Request facilitation</h1>
        <p className="mt-3 text-sm text-slate-500 leading-relaxed">
          Tell us about the counterparty you want to trade with. Our team will review the request and decide how to proceed. No outreach happens until an admin approves the request.
        </p>
      </header>

      {!tradeRequestId && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Missing <code>trade_request_id</code>. Open this page from an existing trade request.
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Counterparty</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Legal name *">
              <Input required value={form.counterparty_legal_name} onChange={(e) => set("counterparty_legal_name", e.target.value)} />
            </Field>
            <Field label="Trading name">
              <Input value={form.counterparty_trading_name} onChange={(e) => set("counterparty_trading_name", e.target.value)} />
            </Field>
            <Field label="Country *">
              <Input required value={form.counterparty_country} onChange={(e) => set("counterparty_country", e.target.value)} />
            </Field>
            <Field label="City">
              <Input value={form.counterparty_city} onChange={(e) => set("counterparty_city", e.target.value)} />
            </Field>
            <Field label="Website">
              <Input value={form.counterparty_website} onChange={(e) => set("counterparty_website", e.target.value)} />
            </Field>
            <Field label="Contact name">
              <Input value={form.counterparty_contact_name} onChange={(e) => set("counterparty_contact_name", e.target.value)} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.counterparty_email} onChange={(e) => set("counterparty_email", e.target.value)} />
            </Field>
            <Field label="Phone">
              <Input value={form.counterparty_phone} onChange={(e) => set("counterparty_phone", e.target.value)} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Trade context</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Product / commodity *">
              <Input required value={form.product_or_commodity} onChange={(e) => set("product_or_commodity", e.target.value)} />
            </Field>
            <Field label="Your role *">
              <Select value={form.role} onValueChange={(v) => set("role", v as "buyer" | "seller")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="buyer">Buyer</SelectItem>
                  <SelectItem value="seller">Seller</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Estimated value *">
              <Input required type="number" min="0" step="0.01" value={form.estimated_value_amount} onChange={(e) => set("estimated_value_amount", e.target.value)} />
            </Field>
            <Field label="Currency *">
              <Input required value={form.estimated_value_currency} onChange={(e) => set("estimated_value_currency", e.target.value)} />
            </Field>
            <Field label="Urgency *">
              <Select value={form.urgency} onValueChange={(v) => set("urgency", v as typeof form.urgency)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Context</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Field label="Why this counterparty? *">
              <Textarea required rows={3} value={form.reason} onChange={(e) => set("reason", e.target.value)} minLength={10} />
            </Field>
            <Field label="How do you know them? *">
              <Input required value={form.how_user_knows_counterparty} onChange={(e) => set("how_user_knows_counterparty", e.target.value)} placeholder="e.g. referred by …, previous off-platform trade, industry event …" />
            </Field>
            <Field label="Additional notes">
              <Textarea rows={2} value={form.how_user_knows_notes} onChange={(e) => set("how_user_knows_notes", e.target.value)} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Declarations</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-start gap-3 text-sm text-slate-700">
              <Checkbox checked={form.permission_to_contact} onCheckedChange={(v) => set("permission_to_contact", !!v)} />
              <span>I confirm I have permission to share the counterparty's details with the platform team for the purpose of evaluating this trade request.</span>
            </label>
            <label className="flex items-start gap-3 text-sm text-slate-700">
              <Checkbox checked={form.user_declaration_accepted} onCheckedChange={(v) => set("user_declaration_accepted", !!v)} />
              <span>I confirm the information provided is accurate to the best of my knowledge and understand that no outreach happens until an admin approves this request.</span>
            </label>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={submitting || !tradeRequestId}>
            {submitting ? "Submitting…" : "Submit facilitation request"}
          </Button>
        </div>
      </form>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-1.5">
    <Label className="text-xs text-slate-600">{label}</Label>
    {children}
  </div>
);

export default FacilitationCaseIntakeForm;
