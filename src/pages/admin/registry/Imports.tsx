/**
 * Batch 9 — Admin Import Pipeline page.
 *
 * Single page that walks an admin through the full controlled-import
 * pipeline: upload/paste source records, run validation, review
 * duplicates and quarantine, approve and publish. Read-only summary
 * tables for every batch. All write calls are routed through the
 * audited Batch 9 edge functions.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  SOURCE_FILE_TYPES, type SourceFileType,
  IMPORTED_RECORD_DEFAULT_READINESS,
} from "@/lib/registry-import-pipeline";

interface BatchRow {
  id: string;
  batch_reference: string;
  state: string;
  country_code: string | null;
  source_file_id: string | null;
  validation_summary: Record<string, number>;
  created_at: string;
}

interface StagingRow {
  id: string;
  row_number: number;
  company_name: string | null;
  country_code: string | null;
  registration_number: string | null;
  validation_outcome: string;
  duplicate_status: string;
  publish_status: string;
  quarantine_reason: string | null;
}

interface DupRow {
  id: string;
  staging_id: string;
  confidence: string;
  match_reasons: string[];
  review_status: string;
}

interface QuarantineRow {
  id: string;
  staging_id: string;
  reason_code: string;
  reason_detail: string | null;
  status: string;
}

export default function AdminRegistryImports() {
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [staging, setStaging] = useState<StagingRow[]>([]);
  const [dupes, setDupes] = useState<DupRow[]>([]);
  const [quarantine, setQuarantine] = useState<QuarantineRow[]>([]);
  const [busy, setBusy] = useState(false);

  // Upload form
  const [sourceName, setSourceName] = useState("");
  const [sourceType, setSourceType] = useState<SourceFileType>("manual_records");
  const [countryCode, setCountryCode] = useState("ZA");
  const [providerName, setProviderName] = useState("");
  const [licenceReference, setLicenceReference] = useState("");
  const [permittedUses, setPermittedUses] = useState("registry_display");
  const [batchReference, setBatchReference] = useState("");
  const [payload, setPayload] = useState("[]");
  const [rawText, setRawText] = useState("");

  // Approve form
  const [businessDecisionId, setBusinessDecisionId] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [approvalRationale, setApprovalRationale] = useState("");

  async function loadBatches() {
    const { data } = await supabase.from("registry_import_batches")
      .select("id, batch_reference, state, country_code, source_file_id, validation_summary, created_at")
      .order("created_at", { ascending: false }).limit(50);
    setBatches((data ?? []) as unknown as BatchRow[]);
  }
  async function loadBatchDetail(id: string) {
    const [{ data: st }, { data: dp }, { data: qt }] = await Promise.all([
      supabase.from("registry_import_records_staging")
        .select("id, row_number, company_name, country_code, registration_number, validation_outcome, duplicate_status, publish_status, quarantine_reason")
        .eq("batch_id", id).order("row_number"),
      supabase.from("registry_import_duplicate_candidates")
        .select("id, staging_id, confidence, match_reasons, review_status")
        .in("staging_id", ((await supabase.from("registry_import_records_staging").select("id").eq("batch_id", id)).data ?? []).map((r: { id: string }) => r.id)),
      supabase.from("registry_import_quarantine")
        .select("id, staging_id, reason_code, reason_detail, status")
        .in("staging_id", ((await supabase.from("registry_import_records_staging").select("id").eq("batch_id", id)).data ?? []).map((r: { id: string }) => r.id)),
    ]);
    setStaging((st ?? []) as StagingRow[]);
    setDupes((dp ?? []) as DupRow[]);
    setQuarantine((qt ?? []) as QuarantineRow[]);
  }
  useEffect(() => { loadBatches(); }, []);
  useEffect(() => { if (selectedId) loadBatchDetail(selectedId); }, [selectedId]);

  async function onCreate() {
    setBusy(true);
    try {
      let parsed: unknown[] | undefined;
      try { parsed = JSON.parse(payload); } catch { parsed = undefined; }
      const body: Record<string, unknown> = {
        source_name: sourceName,
        source_type: sourceType,
        country_code: countryCode.toUpperCase(),
        provider_name: providerName || undefined,
        licence_reference: licenceReference,
        permitted_uses: permittedUses.split(",").map(s => s.trim()).filter(Boolean),
        batch_reference: batchReference,
      };
      if (sourceType === "csv_payload") body.csv_text = rawText;
      else if (sourceType === "text_extract" || sourceType === "pdf_text_paste") body.raw_text = rawText;
      else body.records = Array.isArray(parsed) ? parsed : [];
      const { data, error } = await supabase.functions.invoke("registry-source-file-upload", { body });
      if (error) throw error;
      toast.success("Source file staged");
      await loadBatches();
      const created = (data as { batch_id: string }).batch_id;
      setSelectedId(created);
    } catch (err) {
      toast.error("Upload failed", { description: String(err) });
    } finally { setBusy(false); }
  }

  async function onValidate() {
    if (!selectedId) return;
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("registry-import-validate", { body: { batch_id: selectedId } });
      if (error) throw error;
      toast.success("Validation complete");
      await loadBatches(); await loadBatchDetail(selectedId);
    } catch (err) {
      toast.error("Validation failed", { description: String(err) });
    } finally { setBusy(false); }
  }

  async function onDupeDecision(candidateId: string, decision: "reviewed_unique"|"reviewed_duplicate"|"reviewed_keep_both") {
    try {
      const { error } = await supabase.functions.invoke("registry-import-duplicate-check", { body: { candidate_id: candidateId, decision } });
      if (error) throw error;
      toast.success("Duplicate decision recorded");
      if (selectedId) await loadBatchDetail(selectedId);
    } catch (err) {
      toast.error("Decision failed", { description: String(err) });
    }
  }

  async function onQuarantineDecision(qid: string, decision: "released"|"permanently_excluded") {
    const rationale = window.prompt("Rationale (min 20 chars):") ?? "";
    if (rationale.length < 20) { toast.error("Rationale too short"); return; }
    try {
      const { error } = await supabase.functions.invoke("registry-import-quarantine-review", {
        body: { quarantine_id: qid, decision, rationale },
      });
      if (error) throw error;
      toast.success("Quarantine decision recorded");
      if (selectedId) await loadBatchDetail(selectedId);
    } catch (err) {
      toast.error("Decision failed", { description: String(err) });
    }
  }

  async function onApprove() {
    if (!selectedId) return;
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("registry-import-approve-publish", {
        body: {
          action: "approve", batch_id: selectedId,
          business_decision_id: businessDecisionId,
          evidence_url: evidenceUrl,
          rationale: approvalRationale,
        },
      });
      if (error) throw error;
      toast.success("Batch approved");
      await loadBatches();
    } catch (err) {
      toast.error("Approval failed", { description: String(err) });
    } finally { setBusy(false); }
  }

  async function onPublish() {
    if (!selectedId) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("registry-import-approve-publish", {
        body: { action: "publish", batch_id: selectedId, acknowledged_imported_unverified: true },
      });
      if (error) throw error;
      toast.success(`Published. ${JSON.stringify((data as { result?: unknown }).result)}`);
      await loadBatches(); await loadBatchDetail(selectedId);
    } catch (err) {
      toast.error("Publish failed", { description: String(err) });
    } finally { setBusy(false); }
  }

  const summary = batches.find(b => b.id === selectedId)?.validation_summary ?? {};

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Import pipeline</h1>
      <ReadinessBanner state="shell_ready" moduleCode="M012" />
      <p className="text-xs text-muted-foreground">
        Every record produced by this pipeline is created with readiness
        <span className="font-mono mx-1">{IMPORTED_RECORD_DEFAULT_READINESS}</span>
        and is NOT marked as verified, production-ready or institutionally usable.
      </p>

      <Tabs defaultValue="batches">
        <TabsList>
          <TabsTrigger value="batches">Batches</TabsTrigger>
          <TabsTrigger value="upload">Upload</TabsTrigger>
          {selectedId && <TabsTrigger value="detail">Selected batch</TabsTrigger>}
        </TabsList>

        <TabsContent value="batches">
          <Card>
            <CardHeader><CardTitle className="text-base">Recent batches</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-1 text-xs">
                {batches.map(b => (
                  <button key={b.id}
                    className="w-full text-left p-2 rounded border border-border hover:bg-muted"
                    onClick={() => setSelectedId(b.id)}>
                    <div className="flex justify-between">
                      <span className="font-mono">{b.batch_reference}</span>
                      <Badge variant="secondary" className="text-[10px]">{b.state}</Badge>
                    </div>
                    <div className="text-muted-foreground">
                      {b.country_code ?? "—"} · {new Date(b.created_at).toLocaleString()}
                    </div>
                  </button>
                ))}
                {batches.length === 0 && <p className="text-muted-foreground">No batches yet.</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="upload">
          <Card>
            <CardHeader><CardTitle className="text-base">Stage a new source file / records</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Source name</Label><Input value={sourceName} onChange={e => setSourceName(e.target.value)} /></div>
                <div>
                  <Label>Source type</Label>
                  <select className="w-full h-9 rounded-md border border-input bg-background px-2" value={sourceType} onChange={e => setSourceType(e.target.value as SourceFileType)}>
                    {SOURCE_FILE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div><Label>Country (ISO)</Label><Input value={countryCode} onChange={e => setCountryCode(e.target.value.toUpperCase())} /></div>
                <div><Label>Provider name (optional)</Label><Input value={providerName} onChange={e => setProviderName(e.target.value)} /></div>
                <div className="col-span-2"><Label>Licence reference</Label><Input value={licenceReference} onChange={e => setLicenceReference(e.target.value)} placeholder="e.g. CC-BY-4.0 / contract-2026-001" /></div>
                <div className="col-span-2"><Label>Permitted uses (comma-separated)</Label><Input value={permittedUses} onChange={e => setPermittedUses(e.target.value)} /></div>
                <div className="col-span-2"><Label>Batch reference</Label><Input value={batchReference} onChange={e => setBatchReference(e.target.value)} /></div>
              </div>
              {(sourceType === "csv_payload" || sourceType === "text_extract" || sourceType === "pdf_text_paste") ? (
                <div>
                  <Label>{sourceType === "csv_payload" ? "CSV text" : "Extracted text"}</Label>
                  <Textarea rows={10} value={rawText} onChange={e => setRawText(e.target.value)} />
                </div>
              ) : (
                <div>
                  <Label>Records JSON (array)</Label>
                  <Textarea rows={10} value={payload} onChange={e => setPayload(e.target.value)} className="font-mono text-xs" />
                </div>
              )}
              <Button onClick={onCreate} disabled={busy} data-testid="import-create-cta">{busy ? "Working…" : "Stage source file"}</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {selectedId && (
          <TabsContent value="detail">
            <Card>
              <CardHeader><CardTitle className="text-base">Pipeline actions</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                  {(["total","valid","valid_with_warnings","quarantined","rejected","duplicates_flagged"] as const).map(k => (
                    <div key={k} className="border border-border rounded p-2 text-center">
                      <div className="text-[10px] text-muted-foreground">{k}</div>
                      <div className="font-mono text-base">{(summary as Record<string, number>)[k] ?? 0}</div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={onValidate} disabled={busy} data-testid="import-validate-cta">Run validation</Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input placeholder="business_decision_id (uuid)" value={businessDecisionId} onChange={e => setBusinessDecisionId(e.target.value)} />
                  <Input placeholder="evidence_url" value={evidenceUrl} onChange={e => setEvidenceUrl(e.target.value)} />
                </div>
                <Textarea rows={2} placeholder="Approval rationale (min 20 chars)" value={approvalRationale} onChange={e => setApprovalRationale(e.target.value)} />
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" onClick={onApprove} disabled={busy} data-testid="import-approve-cta">Approve batch</Button>
                  <Button size="sm" variant="default" onClick={onPublish} disabled={busy} data-testid="import-publish-cta">Publish approved batch</Button>
                </div>
              </CardContent>
            </Card>

            <Card className="mt-3">
              <CardHeader><CardTitle className="text-base">Staged records ({staging.length})</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="text-left p-1">#</th>
                      <th className="text-left p-1">Company</th>
                      <th className="text-left p-1">Country</th>
                      <th className="text-left p-1">Reg.no</th>
                      <th className="text-left p-1">Validation</th>
                      <th className="text-left p-1">Dup</th>
                      <th className="text-left p-1">Publish</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staging.map(r => (
                      <tr key={r.id} className="border-b border-border">
                        <td className="p-1 font-mono">{r.row_number}</td>
                        <td className="p-1">{r.company_name ?? "—"}</td>
                        <td className="p-1">{r.country_code ?? "—"}</td>
                        <td className="p-1">{r.registration_number ?? "—"}</td>
                        <td className="p-1"><Badge variant="secondary" className="text-[10px]">{r.validation_outcome}</Badge></td>
                        <td className="p-1">{r.duplicate_status}</td>
                        <td className="p-1">{r.publish_status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card className="mt-3">
              <CardHeader><CardTitle className="text-base">Duplicate candidates ({dupes.length})</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-xs">
                {dupes.length === 0 && <p className="text-muted-foreground">No duplicate candidates.</p>}
                {dupes.map(d => (
                  <div key={d.id} className="border border-border rounded p-2 flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">{d.confidence}</Badge>
                    <span className="text-muted-foreground">{d.match_reasons.join(", ")}</span>
                    <span className="ml-auto">{d.review_status}</span>
                    {d.review_status === "pending" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => onDupeDecision(d.id, "reviewed_unique")}>Unique</Button>
                        <Button size="sm" variant="outline" onClick={() => onDupeDecision(d.id, "reviewed_duplicate")}>Duplicate</Button>
                        <Button size="sm" variant="outline" onClick={() => onDupeDecision(d.id, "reviewed_keep_both")}>Keep both</Button>
                      </>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="mt-3">
              <CardHeader><CardTitle className="text-base">Quarantine queue ({quarantine.length})</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-xs">
                {quarantine.length === 0 && <p className="text-muted-foreground">No quarantine entries.</p>}
                {quarantine.map(q => (
                  <div key={q.id} className="border border-border rounded p-2 flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">{q.reason_code}</Badge>
                    <span className="text-muted-foreground">{q.reason_detail ?? ""}</span>
                    <span className="ml-auto">{q.status}</span>
                    {q.status === "open" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => onQuarantineDecision(q.id, "released")}>Release</Button>
                        <Button size="sm" variant="outline" onClick={() => onQuarantineDecision(q.id, "permanently_excluded")}>Exclude</Button>
                      </>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </main>
  );
}
