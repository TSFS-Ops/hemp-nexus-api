/**
 * AiPoiIntelligencePanel — Batch 5
 * Read-only display + advisory generation surface for AI POI intelligence
 * notes attached to a proposed match. Strictly advisory:
 *   - Never calls a source "verified".
 *   - Classifies every reference by source type.
 *   - Escalation is a UI/review surface only (no external action).
 *   - No POI / WaD / formal-match creation. No outreach dispatch.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { AlertTriangle, ShieldAlert, Sparkles } from "lucide-react";

type Note = {
  id: string;
  proposed_match_id: string | null;
  trade_request_id: string | null;
  counterparty_name: string | null;
  public_news_refs: any[];
  public_web_refs: any[];
  company_announcement_refs: any[];
  director_management_refs: any[];
  trade_activity_refs: any[];
  adverse_media_refs: any[];
  litigation_refs: any[];
  fraud_warning_refs: any[];
  social_media_refs: any[];
  source_links: any[];
  source_summaries: string[];
  source_classification: string | null;
  risk_flags: Array<{ code?: string; severity?: string; rationale?: string }>;
  supports_or_weakens: string | null;
  escalation_required: boolean;
  escalation_reason: string | null;
  model: string | null;
  created_at: string;
};

const SOURCE_LABELS: Record<string, string> = {
  public_source: "Public source",
  social_media: "Social / media context",
  ai_interpretation: "AI interpretation",
};

const SEVERITY_TONE: Record<string, string> = {
  info: "bg-slate-100 text-slate-700 border-slate-200",
  low: "bg-sky-50 text-sky-800 border-sky-200",
  medium: "bg-amber-50 text-amber-800 border-amber-200",
  high: "bg-rose-50 text-rose-800 border-rose-200",
};

export function AiPoiIntelligencePanel({
  proposedMatchId,
}: {
  proposedMatchId: string;
}) {
  const qc = useQueryClient();
  const [escalateNoteId, setEscalateNoteId] = useState<string | null>(null);
  const [escalateReason, setEscalateReason] = useState("");

  const notesQuery = useQuery({
    queryKey: ["ai-poi-intel-notes", proposedMatchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_poi_intelligence_notes")
        .select("*")
        .eq("proposed_match_id", proposedMatchId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Note[];
    },
  });

  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("ai-poi-intelligence-note", {
        body: { action: "generate", proposed_match_id: proposedMatchId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Intelligence note generated.");
      qc.invalidateQueries({ queryKey: ["ai-poi-intel-notes", proposedMatchId] });
      qc.invalidateQueries({ queryKey: ["ai-proposed-match-audit", proposedMatchId] });
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Failed to generate intelligence note.");
    },
  });

  const escalate = useMutation({
    mutationFn: async ({ noteId, reason }: { noteId: string; reason: string }) => {
      const { data, error } = await supabase.functions.invoke("ai-poi-intelligence-note", {
        body: { action: "escalate", note_id: noteId, reason },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Escalation surface created (review state only).");
      setEscalateNoteId(null);
      setEscalateReason("");
      qc.invalidateQueries({ queryKey: ["ai-poi-intel-notes", proposedMatchId] });
      qc.invalidateQueries({ queryKey: ["ai-proposed-match-audit", proposedMatchId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to escalate."),
  });

  const notes = notesQuery.data ?? [];

  return (
    <div className="mt-4 rounded-md border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div>
          <h4 className="text-[13px] font-semibold text-slate-900">
            AI POI intelligence notes
          </h4>
          <p className="text-[11.5px] text-slate-500">
            Advisory only. Not a verification. Sources are classified as public,
            social, or AI interpretation — never "verified".
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => generate.mutate()}
          disabled={generate.isPending}
          className="h-8 text-[12px]"
        >
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          {generate.isPending ? "Generating…" : "Generate intelligence note"}
        </Button>
      </div>

      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11.5px] text-amber-900">
        <AlertTriangle className="mr-1 inline h-3 w-3" />
        This surface produces advisory intelligence only. It does not create a
        POI, does not progress a POI, does not create a WaD, does not mark any
        party verified, and does not send any outreach.
      </div>

      <div className="divide-y divide-slate-100">
        {notesQuery.isLoading ? (
          <p className="px-4 py-3 text-[12px] text-slate-500">Loading…</p>
        ) : notes.length === 0 ? (
          <p className="px-4 py-3 text-[12px] text-slate-500">
            No intelligence notes yet for this proposed match.
          </p>
        ) : (
          notes.map((n) => <NoteCard key={n.id} note={n} onEscalate={(id) => setEscalateNoteId(id)} />)
        )}
      </div>

      <Dialog
        open={!!escalateNoteId}
        onOpenChange={(open) => {
          if (!open) {
            setEscalateNoteId(null);
            setEscalateReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Escalate intelligence note</DialogTitle>
            <DialogDescription>
              Escalation creates a review state on this note for the admin
              reviewer. It does not trigger any external action, notification,
              or compliance workflow.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason for escalation (required)…"
            value={escalateReason}
            onChange={(e) => setEscalateReason(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEscalateNoteId(null);
                setEscalateReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!escalateReason.trim() || escalate.isPending}
              onClick={() =>
                escalateNoteId &&
                escalate.mutate({ noteId: escalateNoteId, reason: escalateReason.trim() })
              }
            >
              {escalate.isPending ? "Escalating…" : "Create escalation surface"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NoteCard({ note, onEscalate }: { note: Note; onEscalate: (id: string) => void }) {
  const buckets = useMemo(
    () => [
      { key: "public_news_refs", label: "Public news", type: "public_source" },
      { key: "public_web_refs", label: "Public web", type: "public_source" },
      { key: "company_announcement_refs", label: "Company announcements", type: "public_source" },
      { key: "director_management_refs", label: "Director / management", type: "public_source" },
      { key: "trade_activity_refs", label: "Trade activity", type: "public_source" },
      { key: "adverse_media_refs", label: "Adverse media", type: "public_source" },
      { key: "litigation_refs", label: "Litigation", type: "public_source" },
      { key: "fraud_warning_refs", label: "Fraud warnings", type: "public_source" },
      { key: "social_media_refs", label: "Social media", type: "social_media" },
    ],
    [],
  );

  const classification = note.source_classification ?? "ai_interpretation";

  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-[11px]">
          {SOURCE_LABELS[classification] ?? classification}
        </Badge>
        <Badge variant="outline" className="text-[11px]">
          {note.supports_or_weakens ?? "insufficient_signal"}
        </Badge>
        {note.escalation_required ? (
          <Badge className="border-rose-200 bg-rose-50 text-[11px] text-rose-800">
            <ShieldAlert className="mr-1 h-3 w-3" />
            Escalation surface · review state only
          </Badge>
        ) : null}
        <span className="ml-auto text-[11px] text-slate-500">
          {new Date(note.created_at).toLocaleString()}
        </span>
      </div>

      {note.source_summaries?.length ? (
        <ul className="mb-2 list-disc space-y-0.5 pl-5 text-[12px] text-slate-800">
          {note.source_summaries.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] italic text-slate-500">No advisory summary recorded.</p>
      )}

      {(note.risk_flags ?? []).length ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {note.risk_flags.map((f, i) => (
            <span
              key={i}
              className={`rounded border px-1.5 py-0.5 text-[10.5px] ${
                SEVERITY_TONE[f.severity ?? "info"] ?? SEVERITY_TONE.info
              }`}
              title={f.rationale}
            >
              {f.code ?? "flag"} · {f.severity ?? "info"}
            </span>
          ))}
        </div>
      ) : null}

      <details className="text-[11.5px]">
        <summary className="cursor-pointer text-slate-600">References by source type</summary>
        <div className="mt-1.5 space-y-1.5">
          {buckets.map((b) => {
            const arr = (note as any)[b.key] as any[];
            if (!Array.isArray(arr) || arr.length === 0) return null;
            return (
              <div key={b.key}>
                <div className="text-[11px] font-medium text-slate-700">
                  {b.label}{" "}
                  <span className="text-[10.5px] font-normal text-slate-500">
                    ({SOURCE_LABELS[b.type] ?? b.type})
                  </span>
                </div>
                <ul className="ml-3 list-disc space-y-0.5 text-[11.5px]">
                  {arr.map((r, i) => (
                    <li key={i}>
                      {r?.url ? (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-emerald-700 underline"
                        >
                          {r.title || r.url}
                        </a>
                      ) : (
                        <span className="italic text-slate-500">Source reference not available.</span>
                      )}
                      {r?.note ? <span className="text-slate-600"> — {r.note}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </details>

      <div className="mt-2 flex justify-end">
        {!note.escalation_required ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11.5px]"
            onClick={() => onEscalate(note.id)}
          >
            Escalate (review surface only)
          </Button>
        ) : note.escalation_reason ? (
          <span className="text-[11px] italic text-rose-700">
            Escalation reason: {note.escalation_reason}
          </span>
        ) : null}
      </div>
    </div>
  );
}
