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
import { Loader2, Search, Globe, Linkedin, Building2, X, AlertCircle } from "lucide-react";
import {
  humaniseEngagementError,
  type HumanisedEngagementError,
} from "@/lib/humanise-engagement-error";
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
// Batch A — schema mirrors the server-side `PatchPoiEngagementSchema`
// for `counterparty_email`, `contact_type` and `contact_name`. The
// `superRefine` enforces the workflow rule signed on 06 May 2026:
//   • named individual → contact_name is required
//   • organisation     → either an org link OR an organisation name
//                        must be present (server already enforces; we
//                        rely on the caller to pass a non-empty
//                        `counterparty_org_name` or set `hasOrgLink`)
// "Email-only with no organisation/name" remains Contact incomplete and
// is rejected here so the admin sees the correction inline.
export const addContactSchema = z
  .object({
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
    contact_type: z.enum(["organisation", "named_individual"], {
      required_error: "Choose a contact type.",
      invalid_type_error: "Choose a contact type.",
    }),
    contact_name: z
      .string()
      .trim()
      .max(200, { message: "Name must be 200 characters or fewer." })
      .optional()
      .or(z.literal("")),
    /** True when the engagement has counterparty_org_id OR a non-empty
     *  organisation name on the parent match. Used to satisfy the
     *  "organisation" contact_type without forcing the admin to retype it. */
    hasOrganisationName: z.boolean().optional(),
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
  })
  .superRefine((val, ctx) => {
    const name = (val.contact_name ?? "").trim();
    if (val.contact_type === "named_individual" && !name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contact_name"],
        message: "Enter the named individual's full name.",
      });
    }
    if (val.contact_type === "organisation" && !name && !val.hasOrganisationName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contact_name"],
        message:
          "Enter the organisation's name (or link to a registered organisation). Email alone is not enough.",
      });
    }
  });

export type AddContactValues = z.infer<typeof addContactSchema>;

export interface AddContactEngagementSummary {
  id: string;
  match_id?: string | null;
  counterparty_org_name: string | null;
  counterparty_email: string | null;
  commodity: string | null;
  /** Batch A — current contact_type on the engagement, if any. */
  contact_type?: "organisation" | "named_individual" | null;
  /** Batch A — current free-text contact_name on the engagement, if any. */
  contact_name?: string | null;
  /** Batch A — true when the engagement has a registered counterparty
   *  organisation linked. Used so the schema can accept "organisation"
   *  contact_type without forcing the admin to retype the name. */
  has_org_link?: boolean;
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
  // Batch A — contact_type/contact_name local state. Default to
  // "organisation" when the engagement has an org name/link, otherwise
  // default to "named_individual" so the admin is steered away from
  // creating an "email-only / Contact incomplete" record.
  const [contactType, setContactType] = useState<"organisation" | "named_individual">(
    "named_individual",
  );
  const [contactName, setContactName] = useState("");
  const [errors, setErrors] = useState<
    Partial<Record<"email" | "contact_type" | "contact_name" | "phone" | "notes", string>>
  >({});
  const [saving, setSaving] = useState(false);
  // Persistent server-side rejection state. Rendered inline above the footer
  // so the admin can read the explanation without chasing a transient toast.
  const [saveError, setSaveError] = useState<HumanisedEngagementError | null>(null);

  const hasOrganisationName =
    !!engagement?.has_org_link ||
    !!(engagement?.counterparty_org_name && engagement.counterparty_org_name.trim());

  // Reset form whenever the dialog opens for a new engagement.
  useEffect(() => {
    if (open) {
      setEmail(engagement?.counterparty_email ?? "");
      setPhone("");
      setNotes("");
      setErrors({});
      setSaveError(null);
      // Prefer the existing contact_type if the row already has one;
      // otherwise default based on whether an org name/link is known.
      if (engagement?.contact_type === "organisation" || engagement?.contact_type === "named_individual") {
        setContactType(engagement.contact_type);
      } else {
        setContactType(hasOrganisationName ? "organisation" : "named_individual");
      }
      setContactName(engagement?.contact_name ?? "");
    }
  }, [
    open,
    engagement?.id,
    engagement?.counterparty_email,
    engagement?.contact_type,
    engagement?.contact_name,
    hasOrganisationName,
  ]);

  const research = useMemo(
    () => buildResearchLinks(engagement?.counterparty_org_name ?? null),
    [engagement?.counterparty_org_name],
  );

  // Fetch the underlying match so we can mount the existing
  // CounterpartyIntelPanel (it requires a full Match row). Read-only —
  // no schema changes, no new edge functions. The panel itself runs
  // the system-assisted public-source sketch on first render.
  const matchId = engagement?.match_id ?? null;
  const { data: matchRow, isLoading: matchLoading } = useQuery({
    queryKey: ["add-contact-match", matchId],
    enabled: !!open && !!matchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId as string)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as Match | null;
    },
    refetchOnWindowFocus: false,
  });

  const handleSave = async () => {
    if (!engagement) return;

    const parsed = addContactSchema.safeParse({
      email,
      contact_type: contactType,
      contact_name: contactName,
      hasOrganisationName,
      phone,
      notes,
    });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as
          | "email"
          | "contact_type"
          | "contact_name"
          | "phone"
          | "notes"
          | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSaveError(null);

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
            // Batch A — persist the contact_type radio + free-text name
            // so the canonical contact-state badge resolves correctly
            // and the backend's preview/send gate has the right inputs.
            contact_type: parsed.data.contact_type,
            contact_name: (parsed.data.contact_name ?? "").trim() || null,
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
      // ── Surface the backend rejection in plain English ──
      // Try to pull a parsed JSON body off the FunctionsHttpError first
      // (newer supabase-js builds expose .context.body as a Response).
      // Then hand whatever we have to humaniseEngagementError, which maps
      // known opaque codes (invalid_target_status, INVALID_TRANSITION,
      // VALIDATION_ERROR, NOT_FOUND, …) to admin-readable copy.
      let serverMessage: unknown = err;
      try {
        const ctxBody = err?.context?.body;
        if (ctxBody && typeof ctxBody.json === "function") {
          const parsedErr = await ctxBody.json();
          // Preserve the full parsed payload so humaniseEngagementError can
          // also pick up `request_id` / `trace_id` fields, not just `message`.
          if (parsedErr && typeof parsedErr === "object") {
            serverMessage = {
              message: parsedErr.message ?? String(err?.message ?? ""),
              request_id: parsedErr.request_id ?? parsedErr.requestId,
              trace_id: parsedErr.trace_id,
              context: { headers: err?.context?.headers },
            };
          }
        }
      } catch {
        /* keep original err */
      }
      const humanised = humaniseEngagementError(serverMessage);
      setSaveError(humanised);
      const description = [humanised.hint, humanised.requestId ? `Request ID: ${humanised.requestId}` : null]
        .filter(Boolean)
        .join(" — ");
      toast.error(humanised.headline, {
        description: description || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add contact details</DialogTitle>
          <DialogDescription>
            Capture a real contact email for this counterparty so platform
            outreach can be sent. This does <strong>not</strong> send an email
            and does <strong>not</strong> mark the engagement as contacted —
            after saving, use <em>Send outreach</em> to email them, or <em>Record contact</em> to log off-platform contact.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* ── Left column: capture form + manual research deep-links ── */}
          <div className="space-y-4">
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

          {/* Batch A — contact_type radio. Drives the canonical contact-state
              badge and the backend's preview/send gate. "Email-only with no
              organisation/name" remains Contact incomplete and is rejected
              by the schema's superRefine — admins must pick a type and,
              for named individuals, supply a name. */}
          <fieldset className="space-y-2 rounded-md border border-slate-200 bg-slate-50/40 p-3">
            <legend className="px-1 text-xs font-medium text-slate-700">
              Contact type *
            </legend>
            <RadioGroup
              value={contactType}
              onValueChange={(v) => setContactType(v as "organisation" | "named_individual")}
              className="gap-2"
              aria-label="Contact type"
            >
              <label className="flex items-start gap-2 cursor-pointer">
                <RadioGroupItem value="organisation" id="add-contact-type-org" className="mt-0.5" />
                <span className="text-sm">
                  <span className="font-medium">Organisation-level contact</span>
                  <span className="block text-xs text-muted-foreground">
                    A general inbox or shared address belonging to the counterparty organisation.
                    {hasOrganisationName
                      ? ` We'll use "${(engagement?.counterparty_org_name ?? "the linked organisation").trim()}" as the organisation name.`
                      : " Provide the organisation's name in the field below."}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <RadioGroupItem value="named_individual" id="add-contact-type-individual" className="mt-0.5" />
                <span className="text-sm">
                  <span className="font-medium">Named individual contact</span>
                  <span className="block text-xs text-muted-foreground">
                    A specific person at the counterparty (e.g. the procurement lead). Their full name is required below.
                  </span>
                </span>
              </label>
            </RadioGroup>
            {errors.contact_type && (
              <p className="text-xs text-destructive">{errors.contact_type}</p>
            )}
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="add-contact-name">
              {contactType === "named_individual"
                ? "Full name *"
                : hasOrganisationName
                  ? "Organisation name (optional override)"
                  : "Organisation name *"}
            </Label>
            <Input
              id="add-contact-name"
              type="text"
              autoComplete="off"
              placeholder={
                contactType === "named_individual"
                  ? "e.g. Naledi Mokoena"
                  : hasOrganisationName
                    ? engagement?.counterparty_org_name ?? "Override the linked organisation name"
                    : "e.g. Acme Trading (Pty) Ltd"
              }
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              aria-invalid={!!errors.contact_name}
              aria-describedby={errors.contact_name ? "add-contact-name-err" : undefined}
              maxLength={200}
            />
            {errors.contact_name && (
              <p id="add-contact-name-err" className="text-xs text-destructive">
                {errors.contact_name}
              </p>
            )}
            {!errors.contact_name && contactType === "organisation" && hasOrganisationName && (
              <p className="text-xs text-muted-foreground">
                Leave blank to keep the linked organisation name.
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
          </div>
          {/* ── Right column: read-only system-assisted intel panel ── */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-700 flex items-center gap-2">
              <Search className="h-3.5 w-3.5" />
              System-assisted intel
            </div>
            {!matchId ? (
              <p className="text-xs text-muted-foreground">
                No match context available — research deep-links on the left can still help.
              </p>
            ) : matchLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading match…
              </div>
            ) : matchRow ? (
              <CounterpartyIntelPanel match={matchRow} />
            ) : (
              <p className="text-xs text-muted-foreground">
                Could not load match for intel. The capture form on the left still works.
              </p>
            )}
          </div>
        </div>

        {/* ── Persistent server-rejection banner ──
            Stays visible until the next save attempt or the dialog closes,
            so the admin doesn't have to chase a transient toast. Includes
            the original server code in a <details> for support diagnostics. */}
        {saveError && (
          <div
            role="alert"
            aria-live="polite"
            className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
              <div className="space-y-1">
                <p className="font-medium text-destructive">{saveError.headline}</p>
                {saveError.hint && (
                  <p className="text-xs text-muted-foreground">{saveError.hint}</p>
                )}
                {saveError.requestId && (
                  <p className="text-[11px] text-muted-foreground/90">
                    Request ID:{" "}
                    <code className="font-mono break-all">{saveError.requestId}</code>{" "}
                    <button
                      type="button"
                      className="underline hover:no-underline"
                      onClick={() => {
                        void navigator.clipboard?.writeText(saveError.requestId!);
                        toast.success("Request ID copied");
                      }}
                    >
                      Copy
                    </button>
                  </p>
                )}
                <details className="text-[11px] text-muted-foreground/80">
                  <summary className="cursor-pointer select-none">Technical details</summary>
                  <code className="block mt-1 break-all font-mono">{saveError.technical}</code>
                </details>
              </div>
            </div>
          </div>
        )}

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
