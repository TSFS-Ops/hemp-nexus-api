/**
 * AddContactDialog — admin contact-capture for unregistered counterparties
 * ────────────────────────────────────────────────────────────────────────
 *
 * Closes the UX gap identified after the "Could not load email preview"
 * fix. The platform's intended workflow for admin Pending Engagements is:
 *
 *   registered trade desk user generates a POI/match involving an
 *   unregistered external counterparty → engagement appears in Pending
 *   Engagements → admin researches the counterparty externally → admin
 *   adds a valid discovered email/contact detail → admin previews and
 *   sends Izenzo outreach → external counterparty receives onboarding
 *   CTA and can join/review the trade.
 *
 * The previous UI hid "save a discovered email" inside a button labelled
 * "Mark contacted" — which implies the admin has *already* reached the
 * counterparty. This dialog gives the discovery step its own dedicated
 * affordance ("Add contact") with the right semantics:
 *
 *   • Email  — required, validated client-side (zod `.email()`, 3–254 chars,
 *              must NOT end in `.invalid` per RFC 2606). Saved via the
 *              existing `poi-engagements` PATCH `counterparty_email`
 *              endpoint — backend validation is the source of truth and
 *              is unchanged.
 *   • Phone  — optional. Persisted as part of `admin_notes` (until/unless
 *              a `counterparty_phone` column is added) so it survives.
 *   • Notes  — optional, prepended to `admin_notes`.
 *
 * Once the email saves successfully the row's existing Notify button
 * enables and the existing preview-outreach / send-outreach flow runs
 * unchanged. No backend, schema, or send-logic changes.
 */

import React, { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Search, Globe, Linkedin, Building2, X } from "lucide-react";
import { CounterpartyIntelPanel } from "@/components/match/CounterpartyIntelPanel";
import type { Match } from "@/hooks/use-match-details";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isUsableOutreachEmail } from "@/components/admin/AdminPendingEngagementsPanel";
import {
  BINDING_HINT_MESSAGES,
  type UpdatePoiEngagementResponse,
} from "@/types/poi-engagement";

// ────────────────────────────────────────────────────────────────────────
// Schema. Mirrors the server-side Zod contract in
// supabase/functions/poi-engagements/index.ts (`PatchPoiEngagementSchema`)
// for `counterparty_email` (3–254, .email()) and adds a frontend-only
// `.invalid`-TLD block. Backend stays the source of truth.
// ────────────────────────────────────────────────────────────────────────
export const addContactSchema = z.object({
  email: z
    .string()
    .trim()
    .min(3, { message: "Email is too short." })
    .max(254, { message: "Email must be 254 characters or fewer." })
    .email({ message: "Enter a valid email address." })
    .refine((v) => isUsableOutreachEmail(v), {
      message:
        "This address uses a non-deliverable test domain (.invalid). Use a real email.",
    }),
  phone: z
    .string()
    .trim()
    .max(64, { message: "Phone must be 64 characters or fewer." })
    .optional()
    .or(z.literal("")),
  notes: z
    .string()
    .trim()
    .max(2000, { message: "Notes must be 2000 characters or fewer." })
    .optional()
    .or(z.literal("")),
});

export type AddContactValues = z.infer<typeof addContactSchema>;

export interface AddContactEngagementSummary {
  id: string;
  match_id?: string | null;
  counterparty_org_name: string | null;
  counterparty_email: string | null;
  commodity: string | null;
}

interface AddContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  engagement: AddContactEngagementSummary | null;
  /** Called after a successful save so the parent can refresh the row. */
  onSaved?: () => void;
}

/**
 * Builds three deep-link helpers (Google, LinkedIn, Companies House
 * search). Pure client-side — opens a new tab. Helps the admin do the
 * external research step from inside the desk.
 */
function buildResearchLinks(orgName: string | null) {
  const q = (orgName ?? "").trim();
  if (!q) return null;
  const enc = encodeURIComponent(q);
  return {
    google: `https://www.google.com/search?q=${encodeURIComponent(`${q} contact email`)}`,
    linkedin: `https://www.linkedin.com/search/results/companies/?keywords=${enc}`,
    companiesHouse: `https://find-and-update.company-information.service.gov.uk/search?q=${enc}`,
  };
}

export function AddContactDialog({
  open,
  onOpenChange,
  engagement,
  onSaved,
}: AddContactDialogProps) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Partial<Record<"email" | "phone" | "notes", string>>>({});
  const [saving, setSaving] = useState(false);

  // Reset form whenever the dialog opens for a new engagement.
  useEffect(() => {
    if (open) {
      setEmail(engagement?.counterparty_email ?? "");
      setPhone("");
      setNotes("");
      setErrors({});
    }
  }, [open, engagement?.id, engagement?.counterparty_email]);

  const research = useMemo(
    () => buildResearchLinks(engagement?.counterparty_org_name ?? null),
    [engagement?.counterparty_org_name],
  );

  const handleSave = async () => {
    if (!engagement) return;

    const parsed = addContactSchema.safeParse({ email, phone, notes });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as "email" | "phone" | "notes" | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});

    // Build the audit-friendly admin_notes payload. Phone + free-text notes
    // are appended as a structured block so they survive in the immutable
    // outreach log via the existing PATCH endpoint.
    const trimmedPhone = (parsed.data.phone ?? "").trim();
    const trimmedNotes = (parsed.data.notes ?? "").trim();
    const stamps: string[] = [];
    if (trimmedPhone) stamps.push(`Phone: ${trimmedPhone}`);
    if (trimmedNotes) stamps.push(trimmedNotes);
    const adminNotesPayload = stamps.length ? stamps.join("\n") : undefined;

    setSaving(true);
    try {
      // Step 1 — persist the email through the existing, unchanged backend
      // contract. Surfaces the auto-resolution `binding` hint so the admin
      // immediately knows whether the address auto-linked to a registered
      // org, hit suppression, or remained unregistered.
      const { data, error } = await supabase.functions.invoke<UpdatePoiEngagementResponse>(
        `poi-engagements/${engagement.id}`,
        {
          method: "PATCH",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: {
            counterparty_email: parsed.data.email.trim(),
            ...(adminNotesPayload ? { admin_notes: adminNotesPayload } : {}),
          },
        },
      );
      if (error) throw error;

      const hint = data?.binding;
      if (hint) {
        const copy = BINDING_HINT_MESSAGES[hint.status];
        if (copy.tone === "success") toast.success(copy.title);
        else if (copy.tone === "warning") toast.warning(copy.title);
        else if (copy.tone === "error") toast.error(copy.title);
        else toast.info(copy.title);
      } else {
        toast.success("Contact saved. You can now send outreach.");
      }

      onSaved?.();
      onOpenChange(false);
    } catch (err: any) {
      // Surface the backend's specific message (e.g. suppression, invalid
      // format) instead of a generic fallback. Mirrors the panel's
      // extractEdgeError helper but inlined here to avoid coupling.
      let msg = "Could not save contact details.";
      try {
        const ctxBody = err?.context?.body;
        if (ctxBody && typeof ctxBody.json === "function") {
          const parsedErr = await ctxBody.json();
          if (parsedErr?.message) msg = String(parsedErr.message);
        } else if (typeof err?.message === "string" && !err.message.includes("non-2xx")) {
          msg = err.message;
        }
      } catch {
        /* keep fallback */
      }
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add contact details</DialogTitle>
          <DialogDescription>
            Capture a real contact email for this counterparty so outreach can
            be sent. This does <strong>not</strong> mark the engagement as
            contacted — use <em>Mark contacted</em> only after you have
            actually reached them.
          </DialogDescription>
        </DialogHeader>

        {/* Research helpers — only useful when we know the counterparty name. */}
        {research && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
              <Search className="h-3.5 w-3.5" />
              Research <span className="font-mono">{engagement?.counterparty_org_name}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={research.google}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100"
              >
                <Globe className="h-3 w-3" /> Google for contact
              </a>
              <a
                href={research.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100"
              >
                <Linkedin className="h-3 w-3" /> LinkedIn
              </a>
              <a
                href={research.companiesHouse}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100"
              >
                <Building2 className="h-3 w-3" /> Companies House
              </a>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="add-contact-email">Email address *</Label>
            <Input
              id="add-contact-email"
              type="email"
              autoComplete="off"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "add-contact-email-err" : undefined}
            />
            {errors.email && (
              <p id="add-contact-email-err" className="text-xs text-destructive">
                {errors.email}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-contact-phone">Phone (optional)</Label>
            <Input
              id="add-contact-phone"
              type="tel"
              autoComplete="off"
              placeholder="+27 82 555 0100"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-invalid={!!errors.phone}
            />
            {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
            <p className="text-xs text-muted-foreground">
              Stored in admin notes for now. Outreach will still be sent by
              email — phone is captured for the audit trail.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-contact-notes">Research notes (optional)</Label>
            <Textarea
              id="add-contact-notes"
              rows={3}
              placeholder="e.g. Found contact email on company website footer; LinkedIn confirms current MD."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              aria-invalid={!!errors.notes}
            />
            {errors.notes && <p className="text-xs text-destructive">{errors.notes}</p>}
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            <X className="h-3.5 w-3.5 mr-1" /> Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Save contact
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
