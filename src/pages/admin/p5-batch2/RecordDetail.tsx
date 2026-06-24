/**
 * RecordDetail — P-5 Batch 2 Stage 4
 *
 * Read-only render of one KYC/KYB record + checklist, ratings, version
 * history, review timeline, sensitive access log and provider state. All
 * mutating actions open the ReasonedActionDialog which routes through
 * Stage 3 RPC wrappers. No direct table writes happen here.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useP5Batch2Permissions } from "@/hooks/useP5Batch2Permissions";
import { ProviderSafeLabel } from "./components/ProviderSafeLabel";
import { MaskedField } from "./components/MaskedField";
import {
  ReasonedActionDialog,
  type ReasonedAction,
} from "./components/ReasonedActionDialog";
import type {
  P5B2EvidenceStatus,
  P5B2ProviderStatus,
  P5B2RequirementLevel,
} from "@/lib/p5-batch2/constants";

type Record = {
  id: string;
  display_name: string;
  record_type: string;
  jurisdiction: string | null;
  entity_type: string | null;
  is_high_risk: boolean;
  status_summary: string | null;
};

type Item = {
  id: string;
  category: string;
  requirement_level: P5B2RequirementLevel;
  status: P5B2EvidenceStatus;
  rating: string | null;
  expiry_date: string | null;
  provider_dependency: boolean;
  provider_status: P5B2ProviderStatus | null;
  provider_live: boolean;
  current_version_id: string | null;
  customer_safe_note: string | null;
};

type Version = {
  id: string;
  evidence_item_id: string;
  version_number: number;
  file_hash: string;
  mime_type: string | null;
  uploaded_at: string;
  is_current: boolean;
  replacement_reason: string | null;
};

type ReviewEvent = {
  id: string;
  evidence_item_id: string;
  action: string;
  previous_status: string | null;
  new_status: string | null;
  rejection_reason: string | null;
  customer_safe_note: string | null;
  actor_role: string | null;
  created_at: string;
};

type Link2 = {
  id: string;
  parent_record_id: string;
  child_record_id: string;
  link_type: string;
};

type Access = {
  id: string;
  field: string;
  reason_text: string;
  action: string;
  actor_role: string | null;
  created_at: string;
};

export default function RecordDetail() {
  const { recordId } = useParams<{ recordId: string }>();
  const perms = useP5Batch2Permissions();
  const [record, setRecord] = useState<Record | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  const [links, setLinks] = useState<Link2[]>([]);
  const [access, setAccess] = useState<Access[]>([]);
  const [dialog, setDialog] = useState<{ action: ReasonedAction; itemId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recordId || !perms.canViewRecordDetail) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ data: rec }, { data: it }, { data: lk }] = await Promise.all([
          supabase.from("p5_batch2_kyc_records")
            .select("id, display_name, record_type, jurisdiction, entity_type, is_high_risk, status_summary")
            .eq("id", recordId).maybeSingle(),
          supabase.from("p5_batch2_evidence_items")
            .select("id, category, requirement_level, status, rating, expiry_date, provider_dependency, provider_status, provider_live, current_version_id, customer_safe_note")
            .eq("record_id", recordId)
            .order("category"),
          supabase.from("p5_batch2_record_links")
            .select("id, parent_record_id, child_record_id, link_type")
            .or(`parent_record_id.eq.${recordId},child_record_id.eq.${recordId}`),
        ]);
        if (cancelled) return;
        setRecord(rec as Record | null);
        setItems((it ?? []) as Item[]);
        setLinks((lk ?? []) as Link2[]);
        const itemIds = (it ?? []).map((i) => i.id);
        if (itemIds.length) {
          const [{ data: vs }, { data: evs }, { data: ax }] = await Promise.all([
            supabase.from("p5_batch2_evidence_versions")
              .select("id, evidence_item_id, version_number, file_hash, mime_type, uploaded_at, is_current, replacement_reason")
              .in("evidence_item_id", itemIds)
              .order("version_number", { ascending: false }),
            supabase.from("p5_batch2_evidence_review_events")
              .select("id, evidence_item_id, action, previous_status, new_status, rejection_reason, customer_safe_note, actor_role, created_at")
              .in("evidence_item_id", itemIds)
              .order("created_at", { ascending: false })
              .limit(200),
            perms.canViewSensitiveAccessLog
              ? supabase.from("p5_batch2_sensitive_access_log")
                  .select("id, field, reason_text, action, actor_role, created_at")
                  .eq("record_id", recordId)
                  .order("created_at", { ascending: false })
                  .limit(100)
              : Promise.resolve({ data: [] as Access[] }),
          ]);
          if (cancelled) return;
          setVersions((vs ?? []) as Version[]);
          setEvents((evs ?? []) as ReviewEvent[]);
          setAccess((ax ?? []) as Access[]);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [recordId, perms.canViewRecordDetail, perms.canViewSensitiveAccessLog]);

  const split = useMemo(() => ({
    mandatory: items.filter((i) => i.requirement_level === "mandatory"),
    optional: items.filter((i) => i.requirement_level === "optional"),
    conditional: items.filter((i) => i.requirement_level === "conditional"),
    not_required: items.filter((i) => i.requirement_level === "not_required"),
  }), [items]);

  if (!perms.canViewRecordDetail) {
    return <div className="p-6">Access denied.</div>;
  }

  return (
    <div className="p-6 space-y-6" data-testid="p5b2-record-detail">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/p5-batch2">← Dashboard</Link>
        </Button>
      </div>

      {error && <Card><CardContent className="pt-6 text-destructive">{error}</CardContent></Card>}

      <Card data-testid="record-summary">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            {record?.display_name ?? "Loading…"}
            {record?.is_high_risk && <Badge variant="destructive">High risk</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Type: {record?.record_type ?? "—"}</p>
          <p>Jurisdiction: {record?.jurisdiction ?? "—"}</p>
          <p>Entity type: {record?.entity_type ?? "—"}</p>
          <p>Status summary: {record?.status_summary ?? "—"}</p>
          <MaskedField label="Tax / VAT" rawValue={null} field="tax_or_vat_number" recordId={recordId} />
        </CardContent>
      </Card>

      <Card data-testid="evidence-checklist">
        <CardHeader>
          <CardTitle>Evidence checklist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(["mandatory", "conditional", "optional", "not_required"] as const).map((level) => (
            <section key={level}>
              <h3 className="text-sm font-semibold capitalize mb-1">
                {level.replace("_", " ")} ({split[level].length})
              </h3>
              {split[level].length === 0 ? (
                <p className="text-xs text-muted-foreground">None</p>
              ) : (
                <ul className="divide-y border rounded-md">
                  {split[level].map((i) => (
                    <li key={i.id} className="p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">{i.category}</p>
                        <div className="flex items-center gap-2 text-xs">
                          <Badge variant="outline">{i.status}</Badge>
                          {i.rating && <Badge>{i.rating}</Badge>}
                          <ProviderSafeLabel
                            provider_status={i.provider_status}
                            provider_live={i.provider_live}
                            viewer="admin"
                          />
                        </div>
                      </div>
                      {i.customer_safe_note && (
                        <p className="text-xs text-muted-foreground">Customer-safe note: {i.customer_safe_note}</p>
                      )}
                      <div className="flex flex-wrap gap-1 pt-1">
                        {perms.canReviewEvidence && (
                          <>
                            <Button size="sm" variant="outline" data-testid="action-accept" onClick={() => setDialog({ action: "accept", itemId: i.id })}>Approve</Button>
                            <Button size="sm" variant="outline" onClick={() => setDialog({ action: "accept_with_warning", itemId: i.id })}>Accept w/ warning</Button>
                            <Button size="sm" variant="outline" onClick={() => setDialog({ action: "reject", itemId: i.id })}>Reject</Button>
                            <Button size="sm" variant="outline" onClick={() => setDialog({ action: "request_correction", itemId: i.id })}>Request correction</Button>
                          </>
                        )}
                        {perms.canSetProviderState && (
                          <Button size="sm" variant="outline" onClick={() => setDialog({ action: "set_provider_state", itemId: i.id })}>Set provider state</Button>
                        )}
                        {perms.canSuspendRelease && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setDialog({ action: "suspend", itemId: i.id })}>Suspend</Button>
                            <Button size="sm" variant="outline" onClick={() => setDialog({ action: "release", itemId: i.id })}>Release</Button>
                          </>
                        )}
                        {perms.canWaiveEvidence && (
                          <Button size="sm" variant="outline" onClick={() => setDialog({ action: "waive", itemId: i.id })}>Waive</Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </CardContent>
      </Card>

      <Card data-testid="version-history">
        <CardHeader><CardTitle>Version history</CardTitle></CardHeader>
        <CardContent>
          {versions.length === 0 ? <p className="text-muted-foreground">No versions yet.</p> : (
            <ul className="divide-y text-xs">
              {versions.map((v) => (
                <li key={v.id} className="py-1 flex justify-between">
                  <span>v{v.version_number} · {v.mime_type ?? "—"} · {new Date(v.uploaded_at).toLocaleString()}</span>
                  <span className="font-mono">{v.file_hash.slice(0, 12)}…</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card data-testid="review-timeline">
        <CardHeader><CardTitle>Review timeline</CardTitle></CardHeader>
        <CardContent>
          {events.length === 0 ? <p className="text-muted-foreground">No events.</p> : (
            <ul className="divide-y text-xs">
              {events.map((e) => (
                <li key={e.id} className="py-1">
                  <span className="font-mono">{new Date(e.created_at).toISOString()}</span>{" · "}
                  {e.action} · {e.previous_status ?? "—"} → {e.new_status ?? "—"}{" · "}
                  {e.actor_role ?? "—"}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {perms.canViewSensitiveAccessLog && (
        <Card data-testid="sensitive-access-log">
          <CardHeader><CardTitle>Sensitive access log</CardTitle></CardHeader>
          <CardContent>
            {access.length === 0 ? <p className="text-muted-foreground">No access events.</p> : (
              <ul className="divide-y text-xs">
                {access.map((a) => (
                  <li key={a.id} className="py-1">
                    {new Date(a.created_at).toISOString()} · {a.action} · {a.field} · {a.actor_role ?? "—"} · {a.reason_text}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card data-testid="linked-parties">
        <CardHeader><CardTitle>Linked parties</CardTitle></CardHeader>
        <CardContent>
          {links.length === 0 ? <p className="text-muted-foreground">No links.</p> : (
            <ul className="text-xs">
              {links.map((l) => (
                <li key={l.id}>
                  {l.link_type}: {l.parent_record_id === recordId ? `→ ${l.child_record_id}` : `← ${l.parent_record_id}`}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {dialog && (
        <ReasonedActionDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          action={dialog.action}
          evidenceItemId={dialog.itemId}
        />
      )}
    </div>
  );
}
