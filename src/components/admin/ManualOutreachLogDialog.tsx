/**
 * ManualOutreachLogDialog
 * ───────────────────────
 * Batch 3 - Unknown-Counterparty Admin Facilitation: Manual Outreach Logging UX.
 *
 * RECORDS outreach that happened OUTSIDE the platform. It does NOT send
 * anything. There is no Send button, no provider call.
 *
 * Reuses the existing `poi-engagements` PATCH endpoint side-field path:
 *   - contact_method  (existing column)
 *   - contact_date    (existing column - last contact attempt timestamp)
 *   - admin_notes     (existing column - appended via PATCH)
 *
 * Backend already:
 *   - validates admin auth on PATCH
 *   - appends one append-only row to `engagement_outreach_logs`
 *   - emits `engagement.updated` audit
 *
 * No new endpoint. No schema change. No `engagement_outreach_logs`
 * semantic change.
 */

import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const MANUAL_OUTREACH_NOTICE =
  "This records outreach performed outside the platform. It does not send email, SMS, WhatsApp, or notifications.";

const CONTACT_METHODS = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "in_person", label: "In person" },
  { value: "other", label: "Other" },
] as const;

type ContactMethod = (typeof CONTACT_METHODS)[number]["value"];

export interface ManualOutreachLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  engagementId: string;
  /** Called after a successful save so the parent refreshes the queue row. */
  onRecorded?: () => void;
}

export function ManualOutreachLogDialog({
  open,
  onOpenChange,
  engagementId,
  onRecorded,
}: ManualOutreachLogDialogProps) {
  const [method, setMethod] = useState<ContactMethod>("email");
  const [contactDetail, setContactDetail] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setMethod("email");
    setContactDetail("");
    setNotes("");
  };

  const handleSave = async () => {
    if (saving) return;
    const trimmedNotes = notes.trim();
    if (trimmedNotes.length === 0) {
      toast.error("Add a note describing the outreach you performed.");
      return;
    }
    if (trimmedNotes.length > 2000) {
      toast.error("Notes must be 2000 characters or fewer.");
      return;
    }
    setSaving(true);
    try {
      // Compose admin_notes payload - include method + optional detail so the
      // append-only outreach log row carries the manual outreach context.
      const detailLine = contactDetail.trim()
        ? ` - ${contactDetail.trim()}`
        : "";
      const composedNotes =
        `[Manual outreach recorded · ${method}${detailLine}]\n${trimmedNotes}`.slice(0, 2000);

      const { error } = await supabase.functions.invoke(
        `poi-engagements/${engagementId}`,
        {
          method: "PATCH",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          // NOTE: we intentionally DO NOT pass engagement_status here.
          // The side-field PATCH path records the outreach attempt and
          // appends to engagement_outreach_logs without mutating canonical
          // POI/match state.
          body: {
            contact_method: method,
            contact_date: new Date().toISOString(),
            admin_notes: composedNotes,
          },
        }
      );
      if (error) throw error;
      toast.success("Manual outreach recorded.");
      reset();
      onOpenChange(false);
      onRecorded?.();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to record manual outreach";
      console.error("Manual outreach log error:", err);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        data-testid="manual-outreach-log-dialog"
      >
        <DialogHeader>
          <DialogTitle>Log manual outreach</DialogTitle>
          <DialogDescription>
            Record an outreach attempt that already happened outside the
            platform.
          </DialogDescription>
        </DialogHeader>

        <Alert data-testid="manual-outreach-outside-platform-notice">
          <AlertDescription className="text-xs leading-snug">
            {MANUAL_OUTREACH_NOTICE}
          </AlertDescription>
        </Alert>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="manual-outreach-method">Contact method</Label>
            <Select
              value={method}
              onValueChange={(v) => setMethod(v as ContactMethod)}
            >
              <SelectTrigger id="manual-outreach-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTACT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="manual-outreach-detail">
              Contact detail (optional)
            </Label>
            <Input
              id="manual-outreach-detail"
              placeholder="e.g. jane@example.com, +27 11 555 0123"
              value={contactDetail}
              onChange={(e) => setContactDetail(e.target.value.slice(0, 200))}
              maxLength={200}
            />
            <p className="text-[11px] text-muted-foreground">
              Used only to label the log entry. The platform will not contact
              this detail.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="manual-outreach-notes">Notes</Label>
            <Textarea
              id="manual-outreach-notes"
              placeholder="What was discussed, agreed, or attempted?"
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 2000))}
              rows={5}
              maxLength={2000}
            />
            <p className="text-[11px] text-muted-foreground">
              {notes.length}/2000
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <LoadingButton
            loading={saving}
            loadingText="Saving…"
            onClick={handleSave}
            data-testid="manual-outreach-record-button"
          >
            Record manual outreach
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
