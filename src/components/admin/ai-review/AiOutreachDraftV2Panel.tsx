/**
 * AiOutreachDraftV2Panel
 * ──────────────────────────────────────────────────────────────────────
 * Batch 4 — AI Outreach Drafts for an APPROVED ai_proposed_matches row.
 *
 * UI guarantees:
 *   - Visible only when the parent proposed match is in status='approved'.
 *   - Drafts persist to `ai_outreach_drafts_v2` ONLY (Phase 1 untouched).
 *   - No Send button. "Mark sent" only records that a human sent the
 *     message manually outside the platform; no provider call is made.
 *   - Copy-to-clipboard buttons let the admin paste the draft into their
 *     own email client.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Mail, RefreshCw, Check, X, Pencil, Copy, Archive, Send } from "lucide-react";
import { toast } from "sonner";

// Approved V1 outreach outcomes (mirrors supabase/functions/_shared/outreach-validator.ts).
const APPROVED_OUTCOMES = [
  "no_response",
  "bounced",
  "interested",
  "not_interested",
  "wrong_contact",
  "call_booked",
  "onboarded",
  "converted_to_match",
  "converted_to_POI",
  "closed",
] as const;

const SEND_CONFIRMATION_TEXT =
  "I confirm this outreach has been reviewed and contains no sensitive commercial, verification, bank, price, volume, document or personal-phone information.";


export interface DraftRow {
  id: string;
  proposed_match_id: string;
  trade_request_id: string;
  recipient_name: string | null;
  recipient_organisation: string | null;
  draft_subject: string;
  draft_body: string;
  draft_status: "draft_created" | "under_review" | "approved_for_send" | "sent_by_human" | "rejected" | "archived";
  created_by_ai: boolean;
  review_note: string | null;
  model: string | null;
  approved_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
  is_first_outreach?: boolean;
  outcome?: string | null;
  outcome_set_at?: string | null;
}

function statusTone(s: DraftRow["draft_status"]) {
  switch (s) {
    case "approved_for_send": return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "sent_by_human": return "bg-sky-50 text-sky-800 border-sky-200";
    case "rejected": return "bg-rose-50 text-rose-800 border-rose-200";
    case "archived": return "bg-zinc-50 text-zinc-700 border-zinc-200";
    default: return "bg-amber-50 text-amber-900 border-amber-200";
  }
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  } catch {
    toast.error("Clipboard not available");
  }
}

export function AiOutreachDraftV2Panel({
  proposedMatchId,
  parentStatus,
}: {
  proposedMatchId: string;
  parentStatus: string;
}) {
  const qc = useQueryClient();
  const gated = parentStatus !== "approved";

  const list = useQuery({
    queryKey: ["ai-outreach-drafts-v2", proposedMatchId],
    queryFn: async (): Promise<DraftRow[]> => {
      const { data, error } = await supabase
        .from("ai_outreach_drafts_v2" as any)
        .select("*")
        .eq("proposed_match_id", proposedMatchId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as DraftRow[];
    },
    enabled: !gated,
  });

  const generate = useMutation({
    mutationFn: async (regenerate_from?: string) => {
      const { data, error } = await supabase.functions.invoke("ai-outreach-draft-v2", {
        body: { proposed_match_id: proposedMatchId, regenerate_from },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return (data as any).draft as DraftRow;
    },
    onSuccess: () => {
      toast.success("Draft generated.");
      qc.invalidateQueries({ queryKey: ["ai-outreach-drafts-v2", proposedMatchId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Draft generation failed"),
  });

  if (gated) {
    return (
      <div className="border border-border rounded-sm bg-muted/30 p-3">
        <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-1">
          AI outreach drafts
        </p>
        <p className="text-[12.5px] text-muted-foreground">
          Outreach drafting is available only after this proposal is approved. No outreach is sent
          automatically by the platform — drafts are reviewed and copied manually.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-sm bg-card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mail className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
            AI outreach drafts · admin only
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={generate.isPending}
          onClick={() => generate.mutate(undefined)}
          data-testid="ai-outreach-v2-generate"
        >
          <Mail className="h-3.5 w-3.5 mr-1" /> Generate draft
        </Button>
      </div>

      <div
        className="text-[11.5px] text-amber-900 bg-amber-50 border border-amber-200 rounded-sm p-2"
        data-testid="ai-outreach-v2-banner"
      >
        Drafts are internal text only. The platform does not send anything. After approval, copy
        the subject and body, paste into your own email client, send it yourself, then mark it as
        sent for the audit trail.
      </div>

      {list.isLoading ? (
        <p className="text-[12px] text-muted-foreground">Loading drafts…</p>
      ) : list.error ? (
        <p className="text-[12px] text-rose-700">Failed to load drafts.</p>
      ) : (list.data ?? []).length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No drafts yet.</p>
      ) : (
        <ul className="space-y-3">
          {(list.data ?? []).map((d) => (
            <DraftCard key={d.id} draft={d} proposedMatchId={proposedMatchId} onRegenerate={() => generate.mutate(d.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DraftCard({
  draft,
  proposedMatchId,
  onRegenerate,
}: {
  draft: DraftRow;
  proposedMatchId: string;
  onRegenerate: () => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(draft.draft_subject);
  const [bodyText, setBodyText] = useState(draft.draft_body);

  const [openAction, setOpenAction] = useState<null | "reject" | "approve" | "sent" | "outcome">(null);
  const [note, setNote] = useState("");
  const [sendConfirmed, setSendConfirmed] = useState(false);
  const [outcomeChoice, setOutcomeChoice] = useState<string>("");
  const isFirst = draft.is_first_outreach !== false;

  const decide = useMutation({
    mutationFn: async (payload: any) => {
      const { data, error } = await supabase.functions.invoke("ai-outreach-draft-v2-decision", {
        body: { draft_id: draft.id, ...payload },
      });
      if (error) throw error;
      const d = data as any;
      if (d?.error === "first_outreach_validation_failed") {
        const cats = Array.isArray(d.failed_categories) ? d.failed_categories.join(", ") : "";
        throw new Error(`First-outreach content rejected: ${cats}. Edit and try again.`);
      }
      if (d?.error === "confirmation_acknowledged_required") {
        throw new Error("Manual-send confirmation is required.");
      }
      if (d?.error) throw new Error(typeof d.error === "string" ? d.error : "Action failed");
      return d.draft as DraftRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-outreach-drafts-v2", proposedMatchId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Action failed"),
  });

  const terminal =
    draft.draft_status === "sent_by_human" ||
    draft.draft_status === "rejected" ||
    draft.draft_status === "archived";

  return (
    <li className="border border-border rounded-sm p-3 bg-background space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">AI draft</Badge>
        <Badge variant="outline" className={statusTone(draft.draft_status)}>
          {draft.draft_status.replace(/_/g, " ")}
        </Badge>
        {isFirst ? (
          <Badge variant="outline" className="bg-amber-50 text-amber-900 border-amber-200">first outreach</Badge>
        ) : (
          <Badge variant="outline" className="bg-zinc-50 text-zinc-700 border-zinc-200">follow-up</Badge>
        )}
        {draft.outcome ? (
          <Badge variant="outline" className="bg-sky-50 text-sky-800 border-sky-200">outcome · {draft.outcome.replace(/_/g, " ")}</Badge>
        ) : null}
        {draft.model ? <Badge variant="outline" className="font-mono text-[10px]">{draft.model}</Badge> : null}
      </div>

      {editing ? (
        <div className="space-y-2">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} />
          <Textarea rows={10} value={bodyText} onChange={(e) => setBodyText(e.target.value)} maxLength={6000} />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={decide.isPending}
              onClick={async () => {
                const out = await decide.mutateAsync({ action: "edit", subject, body: bodyText });
                if (out) {
                  toast.success("Draft updated.");
                  setEditing(false);
                }
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setSubject(draft.draft_subject); setBodyText(draft.draft_body); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] font-medium leading-snug">{draft.draft_subject}</p>
            <Button size="sm" variant="ghost" onClick={() => copy(draft.draft_subject, "Subject")}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="relative">
            <pre className="whitespace-pre-wrap text-[12.5px] text-foreground font-sans bg-muted/40 border border-border rounded-sm p-2 pr-9">
              {draft.draft_body}
            </pre>
            <Button
              size="sm"
              variant="ghost"
              className="absolute top-1 right-1"
              onClick={() => copy(draft.draft_body, "Body")}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => copy(`Subject: ${draft.draft_subject}\n\n${draft.draft_body}`, "Subject + body")}
            >
              <Copy className="h-3.5 w-3.5 mr-1" /> Copy all
            </Button>
          </div>
        </>
      )}

      {draft.review_note ? (
        <p className="text-[11.5px] text-muted-foreground border-t border-border pt-1.5">
          <span className="font-medium">Review note:</span> {draft.review_note}
        </p>
      ) : null}

      {draft.draft_status === "approved_for_send" && (
        <div className="rounded-sm border border-amber-200 bg-amber-50 p-2 text-[11.5px] text-amber-900">
          Approved for manual send. The platform will not dispatch anything. Send it from your own
          email client, then click "Mark sent by me" so the audit trail records the manual send.
        </div>
      )}

      {!terminal && !editing && (
        <div className="flex flex-wrap gap-2 pt-1">
          {draft.draft_status === "draft_created" && (
            <>
              <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
              </Button>
              <Button size="sm" variant="outline" disabled={decide.isPending} onClick={onRegenerate}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Regenerate
              </Button>
              <Button size="sm" disabled={decide.isPending} onClick={() => setOpenAction("approve")}>
                <Check className="h-3.5 w-3.5 mr-1" /> Approve for manual send
              </Button>
              <Button size="sm" variant="destructive" disabled={decide.isPending} onClick={() => setOpenAction("reject")}>
                <X className="h-3.5 w-3.5 mr-1" /> Reject
              </Button>
            </>
          )}
          {draft.draft_status === "approved_for_send" && (
            <>
              <Button size="sm" disabled={decide.isPending} onClick={() => setOpenAction("sent")}>
                <Send className="h-3.5 w-3.5 mr-1" /> Mark sent by me (manual)
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={decide.isPending}
                onClick={async () => {
                  await decide.mutateAsync({ action: "archive" });
                  toast.success("Draft archived.");
                }}
              >
                <Archive className="h-3.5 w-3.5 mr-1" /> Archive
              </Button>
            </>
          )}
        </div>
      )}

      {draft.draft_status === "sent_by_human" && (
        <div className="flex flex-wrap gap-2 pt-1 border-t border-border">
          <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => { setOutcomeChoice(draft.outcome ?? ""); setOpenAction("outcome"); }}>
            {draft.outcome ? "Update outcome" : "Record outcome"}
          </Button>
        </div>
      )}

      <div className="text-[10.5px] text-muted-foreground font-mono pt-1 border-t border-border">
        id · {draft.id}<br />
        created · {new Date(draft.created_at).toISOString()}
        {draft.approved_at ? <><br />approved · {new Date(draft.approved_at).toISOString()}</> : null}
        {draft.sent_at ? <><br />sent (manual) · {new Date(draft.sent_at).toISOString()}</> : null}
      </div>

      {/* Approve / Reject / Mark-sent dialogs */}
      <Dialog open={openAction === "approve"} onOpenChange={(o) => !o && setOpenAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve draft for manual send</DialogTitle>
            <DialogDescription>
              Approving only marks the draft as ready for manual send. The platform will not send
              anything. After you send it from your own email client, mark it as sent here.
            </DialogDescription>
          </DialogHeader>
          <Textarea rows={3} placeholder="Optional review note" value={note} onChange={(e) => setNote(e.target.value)} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenAction(null)}>Cancel</Button>
            <Button
              disabled={decide.isPending}
              onClick={async () => {
                await decide.mutateAsync({ action: "approve", review_note: note || undefined });
                toast.success("Draft approved (manual send required).");
                setOpenAction(null);
                setNote("");
              }}
            >
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openAction === "reject"} onOpenChange={(o) => !o && setOpenAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject draft</DialogTitle>
            <DialogDescription>A short reason is required and is captured in the audit trail.</DialogDescription>
          </DialogHeader>
          <Textarea rows={3} placeholder="Reason (min 3 chars)" value={note} onChange={(e) => setNote(e.target.value)} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenAction(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={decide.isPending || note.trim().length < 3}
              onClick={async () => {
                await decide.mutateAsync({ action: "reject", review_note: note });
                toast.success("Draft rejected.");
                setOpenAction(null);
                setNote("");
              }}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openAction === "sent"} onOpenChange={(o) => !o && setOpenAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark sent by me (manual)</DialogTitle>
            <DialogDescription>
              This only records that you sent this draft yourself outside the platform. The platform
              does not transmit anything.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenAction(null)}>Cancel</Button>
            <Button
              disabled={decide.isPending}
              onClick={async () => {
                await decide.mutateAsync({ action: "mark_sent_by_human" });
                toast.success("Recorded as manually sent.");
                setOpenAction(null);
              }}
            >
              Confirm manual send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

export default AiOutreachDraftV2Panel;
