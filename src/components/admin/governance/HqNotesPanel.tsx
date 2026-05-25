/**
 * Batch B — HQ Notes panel.
 *
 * HQ-only. Calls the `hq-note-add` edge function to append a manual note
 * or a correction note. Never edits an existing event.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  HQ_NOTE_INTRO_COPY,
  HQ_NOTE_REASON_CODES,
  HqNoteReasonCode,
  MIN_HQ_NOTE_LENGTH,
  MIN_HQ_NOTE_LENGTH_OTHER,
} from "@/lib/governance/governance-record";
import { GovernanceAnchor } from "@/lib/governance/use-governance-events";

interface Props {
  anchor: GovernanceAnchor;
  orgId: string | null | undefined;
  /** If supplied, opens the dialog in correction mode against this event_store id. */
  correctingEventId?: string | null;
  onCorrectingHandled?: () => void;
}

export function HqNotesPanel({
  anchor,
  orgId,
  correctingEventId,
  onCorrectingHandled,
}: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [noteType, setNoteType] = useState<"note" | "correction">("note");
  const [reason, setReason] = useState<HqNoteReasonCode>("client_instruction");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Auto-open when a correction target arrives from a timeline row.
  if (correctingEventId && !open) {
    setNoteType("correction");
    setOpen(true);
  }

  const minLen =
    reason === "other" ? MIN_HQ_NOTE_LENGTH_OTHER : MIN_HQ_NOTE_LENGTH;
  const canSubmit =
    note.trim().length >= minLen &&
    !submitting &&
    Boolean(orgId) &&
    (noteType === "note" || Boolean(correctingEventId));

  async function handleSubmit() {
    if (!orgId) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("hq-note-add", {
        body: {
          note_type: noteType,
          note: note.trim(),
          reason_code: reason,
          corrects_event_id:
            noteType === "correction" ? correctingEventId : null,
          org_id: orgId,
          match_id: anchor.matchId ?? null,
          poi_id: anchor.poiId ?? null,
          wad_id: null,
          engagement_id:
            anchor.engagementId ?? anchor.pendingEngagementId ?? null,
          payment_reference: null,
        },
      });
      if (error) throw error;
      toast({
        title: noteType === "correction" ? "Correction recorded" : "HQ note added",
        description: data?.deduplicated
          ? "Duplicate detected — existing event reused."
          : "Appended to the Governance Record.",
      });
      setNote("");
      setOpen(false);
      onCorrectingHandled?.();
      await qc.invalidateQueries({ queryKey: ["governance-record-events"] });
    } catch (e) {
      const msg = (e as Error)?.message ?? "Failed to record HQ note.";
      toast({ title: "HQ note failed", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card data-testid="hq-notes-panel">
      <CardContent className="p-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-1">
            HQ Notes
          </p>
          <p className="text-xs text-muted-foreground leading-snug max-w-prose">
            {HQ_NOTE_INTRO_COPY}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setNoteType("note");
            setOpen(true);
          }}
          data-testid="hq-notes-add-button"
        >
          Add HQ note
        </Button>
      </CardContent>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) onCorrectingHandled?.();
        }}
      >
        <DialogContent data-testid="hq-notes-dialog">
          <DialogHeader>
            <DialogTitle>
              {noteType === "correction"
                ? "Add correction note"
                : "Add HQ note"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {noteType === "correction" && correctingEventId && (
              <p className="text-[11px] text-muted-foreground font-mono break-all">
                Correcting event: {correctingEventId}
              </p>
            )}
            <div>
              <label className="font-mono text-[10px] uppercase text-muted-foreground">
                Reason
              </label>
              <Select
                value={reason}
                onValueChange={(v) => setReason(v as HqNoteReasonCode)}
              >
                <SelectTrigger className="h-9 text-sm" data-testid="hq-note-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HQ_NOTE_REASON_CODES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase text-muted-foreground">
                Note ({minLen}+ chars)
              </label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={5}
                maxLength={4000}
                data-testid="hq-note-text"
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button
              size="sm"
              disabled={!canSubmit}
              onClick={handleSubmit}
              data-testid="hq-note-submit"
            >
              {submitting ? "Saving…" : "Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
