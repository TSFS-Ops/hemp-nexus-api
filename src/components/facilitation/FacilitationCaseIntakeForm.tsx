/**
 * FacilitationCaseIntakeForm - Phase 1 + Batch 3 intake.
 *
 * Aligned with the completed client questionnaire:
 *  - Adds sector, target response date, relationship status, role expansion,
 *    optional registration/tax/VAT/address/contact-person fields,
 *    preferred contact language.
 *  - Adds a mandatory "source / evidence summary" field.
 *  - Adds authority confirmation declaration.
 *  - Client-side validation prevents submit when required questionnaire
 *    fields are missing or no contact identifier is provided.
 *  - No outreach. No SLA. No notification. No POI/match/credit mutation.
 *
 * Requires ?trade_request_id=... in the URL.
 */
import React, { useMemo, useState } from "react";
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
import { friendlyFacilitationError } from "@/lib/facilitation-labels";
import {
  ROLE_LABELS,
  RELATIONSHIP_STATUS_LABELS,
  ROLES,
  RELATIONSHIP_STATUSES,
  type FacilitationRole,
  type FacilitationRelationshipStatus,
} from "@/lib/facilitation-case-state";

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
    physical_address: "",
    counterparty_website: "",
    counterparty_email: "",
    counterparty_phone: "",
    counterparty_contact_name: "",
    contact_person_title: "",
    contact_person_phone: "",
    contact_person_email: "",
    preferred_contact_language: "",
    registration_number: "",
    tax_vat_number: "",
    product_or_commodity: "",
    sector: "",
    role: "buyer" as FacilitationRole,
    estimated_value_amount: "",
    estimated_value_currency: "USD",
    urgency: "normal" as "low" | "normal" | "high" | "critical",
    target_response_date: "",
    relationship_status: "no_prior_contact" as FacilitationRelationshipStatus,
    reason: "",
    how_user_knows_counterparty: "",
    how_user_knows_notes: "",
    source_evidence_summary: "",
    permission_to_contact: false,
    authority_confirmation: false,
    user_declaration_accepted: false,
  });

  const set = (k: keyof typeof form, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const hasContactIdentifier = useMemo(
    () =>
      Boolean(form.counterparty_email.trim()) ||
      Boolean(form.counterparty_website.trim()) ||
      Boolean(form.counterparty_phone.trim()) ||
      Boolean(form.counterparty_contact_name.trim()) ||
      Boolean(form.registration_number.trim()) ||
      Boolean(form.contact_person_email.trim()) ||
      Boolean(form.contact_person_phone.trim()),
    [form],
  );

  const missingRequired = useMemo(() => {
    const missing: string[] = [];
    if (!form.counterparty_legal_name.trim() && !form.counterparty_trading_name.trim()) {
      missing.push("Counterparty legal or trading name");
    }
    if (!form.counterparty_country.trim()) missing.push("Country");
    if (!form.product_or_commodity.trim()) missing.push("Product, service or commodity");
    if (!form.reason.trim() || form.reason.trim().length < 10) missing.push("Reason for contact (at least 10 characters)");
    if (!form.estimated_value_amount || Number(form.estimated_value_amount) < 0) missing.push("Estimated value");
    if (!form.estimated_value_currency.trim()) missing.push("Currency");
    if (!form.authority_confirmation) missing.push("Authority confirmation");
    if (!form.source_evidence_summary.trim() || form.source_evidence_summary.trim().length < 2) {
      missing.push("At least one source or evidence item");
    }
    if (!hasContactIdentifier) missing.push("At least one contact identifier");
    return missing;
  }, [form, hasContactIdentifier]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tradeRequestId) {
      toast.error("Missing trade request reference. Open this page from an existing trade request.");
      return;
    }
    if (!form.user_declaration_accepted) {
      toast.error("Please accept the declaration to continue.");
      return;
    }
    if (missingRequired.length > 0) {
      toast.error(`Please complete: ${missingRequired.join(", ")}`);
      return;
    }
    setSubmitting(true);
    try {
      const legal = form.counterparty_legal_name.trim() || form.counterparty_trading_name.trim();
      const { data, error } = await supabase.functions.invoke("create-facilitation-case", {
        body: {
          trade_request_id: tradeRequestId,
          counterparty_legal_name: legal,
          counterparty_trading_name: form.counterparty_trading_name.trim() || null,
          counterparty_country: form.counterparty_country.trim(),
          counterparty_city: form.counterparty_city.trim() || null,
          physical_address: form.physical_address.trim() || null,
          counterparty_website: form.counterparty_website.trim() || null,
          counterparty_email: form.counterparty_email.trim() || null,
          counterparty_phone: form.counterparty_phone.trim() || null,
          counterparty_contact_name: form.counterparty_contact_name.trim() || null,
          contact_person_title: form.contact_person_title.trim() || null,
          contact_person_phone: form.contact_person_phone.trim() || null,
          contact_person_email: form.contact_person_email.trim() || null,
          preferred_contact_language: form.preferred_contact_language.trim() || null,
          registration_number: form.registration_number.trim() || null,
          tax_vat_number: form.tax_vat_number.trim() || null,
          product_or_commodity: form.product_or_commodity.trim(),
          sector: form.sector.trim() || null,
          role: form.role,
          estimated_value_amount: Number(form.estimated_value_amount) || 0,
          estimated_value_currency: form.estimated_value_currency.trim().toUpperCase(),
          urgency: form.urgency,
          target_response_date: form.target_response_date || null,
          relationship_status: form.relationship_status,
          reason: form.reason.trim(),
          how_user_knows_counterparty: form.how_user_knows_counterparty.trim() || form.relationship_status,
          how_user_knows_notes: form.how_user_knows_notes.trim() || null,
          source_evidence_summary: form.source_evidence_summary.trim(),
          permission_to_contact: form.permission_to_contact,
          user_declaration_accepted: true,
        },
      });
      if (error) throw error;
      const created = (data as { case?: { id: string } })?.case;
      if (!created?.id) throw new Error("Server did not return a case id");
      toast.success("Your facilitation request has been submitted.");
      navigate(`/desk/facilitation/${created.id}`);
    } catch (err: unknown) {
      const msg = await friendlyFacilitationError(err, "Could not submit. Please check the form and try again.");
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <BackButton />
      <header className="mb-6 mt-4">
        <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">Ask Izenzo to help with a counterparty</h1>
        <p className="mt-3 text-sm text-slate-500 leading-relaxed">
          Tell us about the counterparty you want to trade with. Our team will review the request and decide how to proceed. No contact is made with the counterparty until an admin approves it.
        </p>
      </header>

      {!tradeRequestId && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Open this page from an existing trade request.
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Counterparty</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Legal name *">
              <Input value={form.counterparty_legal_name} onChange={(e) => set("counterparty_legal_name", e.target.value)} />
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
            <Field label="Physical address">
              <Input value={form.physical_address} onChange={(e) => set("physical_address", e.target.value)} />
            </Field>
            <Field label="Website or company page">
              <Input value={form.counterparty_website} onChange={(e) => set("counterparty_website", e.target.value)} />
            </Field>
            <Field label="Registration number">
              <Input value={form.registration_number} onChange={(e) => set("registration_number", e.target.value)} />
            </Field>
            <Field label="Tax / VAT number">
              <Input value={form.tax_vat_number} onChange={(e) => set("tax_vat_number", e.target.value)} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Contact person</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Name">
              <Input value={form.counterparty_contact_name} onChange={(e) => set("counterparty_contact_name", e.target.value)} />
            </Field>
            <Field label="Title">
              <Input value={form.contact_person_title} onChange={(e) => set("contact_person_title", e.target.value)} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.contact_person_email} onChange={(e) => set("contact_person_email", e.target.value)} />
            </Field>
            <Field label="Phone">
              <Input value={form.contact_person_phone} onChange={(e) => set("contact_person_phone", e.target.value)} />
            </Field>
            <Field label="Company email">
              <Input type="email" value={form.counterparty_email} onChange={(e) => set("counterparty_email", e.target.value)} />
            </Field>
            <Field label="Company phone">
              <Input value={form.counterparty_phone} onChange={(e) => set("counterparty_phone", e.target.value)} />
            </Field>
            <Field label="Preferred language">
              <Input value={form.preferred_contact_language} onChange={(e) => set("preferred_contact_language", e.target.value)} placeholder="e.g. English" />
            </Field>
          </CardContent>
          <div className="px-6 pb-4 text-xs text-slate-500">
            At least one contact identifier is required: email, website, phone, registration number, or a named contact person.
          </div>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Trade context</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Product, service or commodity *">
              <Input required value={form.product_or_commodity} onChange={(e) => set("product_or_commodity", e.target.value)} />
            </Field>
            <Field label="Sector">
              <Input value={form.sector} onChange={(e) => set("sector", e.target.value)} placeholder="e.g. agriculture, energy, logistics" />
            </Field>
            <Field label="Your role *">
              <Select value={form.role} onValueChange={(v) => set("role", v as FacilitationRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Relationship to counterparty *">
              <Select
                value={form.relationship_status}
                onValueChange={(v) => set("relationship_status", v as FacilitationRelationshipStatus)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RELATIONSHIP_STATUSES.map((r) => (
                    <SelectItem key={r} value={r}>{RELATIONSHIP_STATUS_LABELS[r]}</SelectItem>
                  ))}
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
            <Field label="Target response date">
              <Input type="date" value={form.target_response_date} onChange={(e) => set("target_response_date", e.target.value)} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Reason and sources</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Field label="Why are you contacting this counterparty? *">
              <Textarea required rows={3} value={form.reason} onChange={(e) => set("reason", e.target.value)} minLength={10} placeholder="Describe the commercial purpose of the trade in plain language." />
            </Field>
            <Field label="How did you find them or how do you know them?">
              <Input value={form.how_user_knows_counterparty} onChange={(e) => set("how_user_knows_counterparty", e.target.value)} placeholder="e.g. referred by, prior off-platform trade, industry event" />
            </Field>
            <Field label="Source / evidence items *">
              <Textarea
                required
                rows={3}
                value={form.source_evidence_summary}
                onChange={(e) => set("source_evidence_summary", e.target.value)}
                minLength={2}
                placeholder="List at least one source or evidence item: document, email, referral note, prior communication, website reference, or written source note."
              />
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
              <Checkbox checked={form.authority_confirmation} onCheckedChange={(v) => set("authority_confirmation", !!v)} />
              <span>I confirm I have the authority within my organisation to ask Izenzo to facilitate contact with this counterparty for this trade. *</span>
            </label>
            <label className="flex items-start gap-3 text-sm text-slate-700">
              <Checkbox checked={form.permission_to_contact} onCheckedChange={(v) => set("permission_to_contact", !!v)} />
              <span>I confirm I have permission to share the counterparty's details with the platform team for the purpose of evaluating this trade request.</span>
            </label>
            <label className="flex items-start gap-3 text-sm text-slate-700">
              <Checkbox checked={form.user_declaration_accepted} onCheckedChange={(v) => set("user_declaration_accepted", !!v)} />
              <span>I confirm the information provided is accurate to the best of my knowledge. I understand that no contact happens with the counterparty until an admin approves this request.</span>
            </label>
          </CardContent>
        </Card>

        {missingRequired.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Still needed before you can submit: {missingRequired.join(", ")}.
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={submitting || !tradeRequestId || missingRequired.length > 0 || !form.user_declaration_accepted}>
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
