/**
 * OrgAdminContactCompletionCard — Batch A (MT-009 Option B/C)
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Surfaces an inline "complete your counterparty contact" affordance on the
 * Match Details page for the COUNTERPARTY-SIDE organisation admin only.
 *
 * Visibility rules (mirror the backend gate in `poi-engagements` PATCH):
 *   • engagement row exists for this match
 *   • engagement is NOT terminal (accepted/declined/expired)
 *   • viewer has the `org_admin` role on the org sitting on the match side
 *     OPPOSITE the initiator (i.e. `engagement.org_id` is NOT viewer's org,
 *     and viewer's org matches `counterparty_org_id` OR the match's
 *     buyer/seller slot opposite the initiator)
 *
 * Editable fields (whitelisted server-side):
 *   • counterparty_email
 *   • contact_type
 *   • contact_name
 *
 * NEVER renders outreach / notify / status-transition / admin-notes
 * controls. Those remain platform_admin-only and are blocked by the backend.
 */

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
// Inline counterparty-side check — mirrors the backend predicate in
// supabase/functions/_shared/engagement-counterparty.ts. The backend
// remains the source of truth; this is a UX visibility gate only.
export function isCounterpartySide(
  actorOrgId: string | null | undefined,
  engagement: { org_id: string; counterparty_org_id?: string | null },
  match: { org_id?: string | null; buyer_org_id?: string | null; seller_org_id?: string | null } | null | undefined,
): boolean {
  if (!actorOrgId) return false;
  if (engagement.org_id === actorOrgId) return false;
  if (engagement.counterparty_org_id && engagement.counterparty_org_id === actorOrgId) return true;
  if (match) {
    const onMatch = match.buyer_org_id === actorOrgId || match.seller_org_id === actorOrgId;
    if (onMatch && match.org_id !== actorOrgId) return true;
  }
  return false;
}
import {
  contactBlockReason,
  contactStateLabel,
  getContactState,
  isOutreachBlocked,
  isUsableContactEmail,
} from "@/lib/contact-completeness";
import { isEngagementTerminal } from "@/lib/engagement-state";

const formSchema = z
  .object({
    counterparty_email: z
      .string()
      .trim()
      .max(254, { message: "Email must be 254 characters or fewer." })
      .optional()
      .or(z.literal("")),
    contact_type: z.enum(["organisation", "named_individual"]).optional(),
    contact_name: z
      .string()
      .trim()
      .max(200, { message: "Name must be 200 characters or fewer." })
      .optional()
      .or(z.literal("")),
  })
  .superRefine((val, ctx) => {
    const email = (val.counterparty_email ?? "").trim();
    if (email && !isUsableContactEmail(email)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["counterparty_email"],
        message: "Enter a valid email address (no .invalid test domains).",
      });
    }
    const name = (val.contact_name ?? "").trim();
    if (val.contact_type === "named_individual" && !name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contact_name"],
        message: "Enter the named individual's full name.",
      });
    }
  });

export interface OrgAdminContactCompletionEngagement {
  id: string;
  org_id: string;
  counterparty_org_id: string | null;
  counterparty_email: string | null;
  counterparty_org?: { id?: string | null; name?: string | null } | null;
  contact_type?: "organisation" | "named_individual" | null;
  contact_name?: string | null;
  engagement_status: string | null;
}

export interface OrgAdminContactCompletionMatch {
  org_id: string;
  buyer_org_id?: string | null;
  seller_org_id?: string | null;
  buyer_name?: string | null;
  seller_name?: string | null;
}

interface Props {
  engagement: OrgAdminContactCompletionEngagement | null;
  match: OrgAdminContactCompletionMatch | null;
  viewerOrgId: string | null;
  onSaved?: () => void;
}

export function OrgAdminContactCompletionCard({
  engagement,
  match,
  viewerOrgId,
  onSaved,
}: Props) {
  const { isPlatformAdmin, isOrgAdmin } = useAuth();

  // Visibility gate — must mirror the backend MT-009 Option B rule exactly.
  const visible = useMemo(() => {
    if (!engagement || !match || !viewerOrgId) return false;
    if (isPlatformAdmin) return false; // platform admins use the admin panel
    if (!isOrgAdmin) return false;
    if (isEngagementTerminal(engagement.engagement_status)) return false;
    return isCounterpartySide(viewerOrgId, engagement, match);
  }, [engagement, match, viewerOrgId, isPlatformAdmin, isOrgAdmin]);

  const [email, setEmail] = useState("");
  const [contactType, setContactType] = useState<"organisation" | "named_individual">("organisation");
  const [contactName, setContactName] = useState("");
  const [errors, setErrors] = useState<Partial<Record<"counterparty_email" | "contact_name", string>>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!engagement) return;
    setEmail(engagement.counterparty_email ?? "");
    setContactName(engagement.contact_name ?? "");
    if (engagement.contact_type === "organisation" || engagement.contact_type === "named_individual") {
      setContactType(engagement.contact_type);
    } else {
      const hasOrgName = !!(engagement.counterparty_org?.name && engagement.counterparty_org.name.trim());
      setContactType(engagement.counterparty_org_id || hasOrgName ? "organisation" : "named_individual");
    }
    setErrors({});
  }, [engagement?.id, engagement?.counterparty_email, engagement?.contact_type, engagement?.contact_name]);

  if (!visible || !engagement) return null;

  const cs = getContactState(
    {
      counterparty_email: email,
      counterparty_org_id: engagement.counterparty_org_id,
      contact_name: contactName,
      contact_type: contactType,
      counterparty_org: engagement.counterparty_org,
    },
    match,
  );
  const blocked = isOutreachBlocked(cs);
  const reason = contactBlockReason(cs);

  const handleSave = async () => {
    const parsed = formSchema.safeParse({
      counterparty_email: email,
      contact_type: contactType,
      contact_name: contactName,
    });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as "counterparty_email" | "contact_name" | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        contact_type: contactType,
        contact_name: (contactName ?? "").trim() || null,
      };
      const trimmedEmail = (email ?? "").trim();
      if (trimmedEmail) body.counterparty_email = trimmedEmail;

      const { error } = await supabase.functions.invoke(`poi-engagements/${engagement.id}`, {
        method: "PATCH",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body,
      });
      if (error) throw error;
      toast.success("Counterparty contact updated.");
      onSaved?.();
    } catch (err: any) {
      toast.error(err?.message || "Could not update counterparty contact.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-sky-500/40 bg-sky-500/5" data-testid="org-admin-contact-completion-card">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              {blocked ? (
                <AlertCircle className="h-4 w-4 text-amber-600" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              )}
              Complete your counterparty contact
            </CardTitle>
            <CardDescription>
              You are listed as the counterparty on this trade. Add or correct
              the contact details so our compliance desk can reach you.
              You cannot send platform outreach yourself — that remains with the desk.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className="text-xs"
            data-contact-state={cs}
            title={reason ?? "Contact details are sufficient for outreach."}
          >
            {contactStateLabel(cs)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="org-admin-contact-email">Email address</Label>
          <Input
            id="org-admin-contact-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!errors.counterparty_email}
            placeholder="name@company.com"
          />
          {errors.counterparty_email && (
            <p className="text-xs text-destructive">{errors.counterparty_email}</p>
          )}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-slate-700">Contact type</legend>
          <RadioGroup
            value={contactType}
            onValueChange={(v) => setContactType(v as "organisation" | "named_individual")}
          >
            <label className="flex items-start gap-2 cursor-pointer">
              <RadioGroupItem value="organisation" id="org-admin-type-org" className="mt-0.5" />
              <span className="text-sm">Organisation-level contact</span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <RadioGroupItem value="named_individual" id="org-admin-type-individual" className="mt-0.5" />
              <span className="text-sm">Named individual contact</span>
            </label>
          </RadioGroup>
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor="org-admin-contact-name">
            {contactType === "named_individual" ? "Full name" : "Organisation name (optional)"}
          </Label>
          <Input
            id="org-admin-contact-name"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            aria-invalid={!!errors.contact_name}
            maxLength={200}
            placeholder={contactType === "named_individual" ? "e.g. Naledi Mokoena" : "e.g. Acme Trading (Pty) Ltd"}
          />
          {errors.contact_name && (
            <p className="text-xs text-destructive">{errors.contact_name}</p>
          )}
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Save contact
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
