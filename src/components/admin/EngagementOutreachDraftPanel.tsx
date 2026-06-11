/**
 * EngagementOutreachDraftPanel
 * ──────────────────────────────────────────────────────────────────────
 * Admin-only sub-panel for the AI Outreach Drafter (Phase 1).
 *
 * IMPORTANT — Phase 1 boundary:
 *   • The panel can generate, regenerate, edit, approve, and reject
 *     drafts.
 *   • The panel does NOT send anything. There is no Send button. After
 *     approval the admin must manually copy the text and send it outside
 *     the platform, then record that contact in the existing manual
 *     outreach log.
 *   • The panel never wires to notification-dispatch, send-transactional-
 *     email, Resend, SMTP, Mailgun, Slack, or any other dispatch surface.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles, RefreshCw, Check, X, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  useEngagementOutreachDraft,
  type OutreachDraft,
} from "@/hooks/useEngagementOutreachDraft";

interface Props {
  engagementId: string;
}

function StatusBadge({ status }: { status: OutreachDraft["status"] }) {
  if (status === "approved") return <Badge variant="default">Approved</Badge>;
  if (status === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  return <Badge variant="secondary">Pending review</Badge>;
}

export function EngagementOutreachDraftPanel({ engagementId }: Props) {
  const { drafts, loading, working, error, generate, decide } =
    useEngagementOutreachDraft(engagementId);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const handleGenerate = async (regenerate_from?: string) => {
    const out = await generate(regenerate_from ? { regenerate_from } : undefined);
    if (out) toast.success(regenerate_from ? "Regenerated draft." : "Draft generated.");
  };

  const startEdit = (d: OutreachDraft) => {
    setEditingId(d.id);
    setEditSubject(d.draft_subject);
    setEditBody(d.draft_body);
  };

  const saveEdit = async (id: string) => {
    const out = await decide(id, "edit", { subject: editSubject, body: editBody });
    if (out) {
      toast.success("Draft edited.");
      setEditingId(null);
    }
  };

  const approve = async (id: string) => {
    const out = await decide(id, "approve");
    if (out) toast.success("Draft approved (manual send required).");
  };

  const reject = async (id: string) => {
    if (rejectNote.trim().length < 3) {
      toast.error("Provide a short rejection note.");
      return;
    }
    const out = await decide(id, "reject", { review_note: rejectNote });
    if (out) {
      toast.success("Draft rejected.");
      setRejectingId(null);
      setRejectNote("");
    }
  };

  return (
    <div className="space-y-4 rounded-md border bg-card p-4" data-testid="outreach-draft-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">AI Outreach Drafts</h3>
          <Badge variant="outline" className="ml-1">Admin only</Badge>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={working || loading}
          onClick={() => handleGenerate()}
          data-testid="outreach-draft-generate"
        >
          {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          <span className="ml-2">Generate draft</span>
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Drafts are internal only. The platform does not send anything automatically. After approval,
        copy the text and send it manually outside the platform, then record the contact in the
        manual outreach log.
      </p>

      {error && <div className="text-sm text-destructive">{error}</div>}
      {loading && <div className="text-sm text-muted-foreground">Loading drafts…</div>}
      {!loading && drafts.length === 0 && (
        <div className="text-sm text-muted-foreground">No drafts yet.</div>
      )}

      <ul className="space-y-3">
        {drafts.map((d) => (
          <li key={d.id} className="rounded-md border bg-background p-3 space-y-2" data-testid={`outreach-draft-${d.id}`}>
            <div className="flex items-center gap-2">
              <Badge variant="outline">AI draft</Badge>
              <StatusBadge status={d.status} />
              {d.ai_confidence && (
                <span className="text-xs text-muted-foreground">confidence: {d.ai_confidence}</span>
              )}
            </div>

            {editingId === d.id ? (
              <div className="space-y-2">
                <Input value={editSubject} onChange={(e) => setEditSubject(e.target.value)} />
                <Textarea rows={8} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => saveEdit(d.id)} disabled={working}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                <div className="text-sm font-medium">{d.draft_subject}</div>
                <pre className="whitespace-pre-wrap text-sm text-muted-foreground font-sans">
                  {d.draft_body}
                </pre>
                {d.context_summary && (
                  <div className="text-xs text-muted-foreground border-t pt-2">
                    <span className="font-medium">Context:</span> {d.context_summary}
                  </div>
                )}
              </>
            )}

            {d.status === "approved" && (
              <div
                className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"
                data-testid="manual-send-notice"
              >
                Approved — manual send required. No automated dispatch is wired.
              </div>
            )}

            {d.status === "rejected" && d.review_note && (
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Rejection note:</span> {d.review_note}
              </div>
            )}

            {d.status === "pending_review" && editingId !== d.id && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => startEdit(d)} disabled={working}>
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleGenerate(d.id)} disabled={working}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" /> Regenerate
                </Button>
                <Button size="sm" onClick={() => approve(d.id)} disabled={working} data-testid="approve-btn">
                  <Check className="h-3.5 w-3.5 mr-1" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setRejectingId(rejectingId === d.id ? null : d.id)}
                  disabled={working}
                >
                  <X className="h-3.5 w-3.5 mr-1" /> Reject
                </Button>
              </div>
            )}

            {rejectingId === d.id && (
              <div className="space-y-2 pt-2 border-t">
                <Textarea
                  rows={2}
                  placeholder="Reason for rejection (min 3 chars)"
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" onClick={() => reject(d.id)} disabled={working}>
                    Confirm reject
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setRejectingId(null); setRejectNote(""); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default EngagementOutreachDraftPanel;
