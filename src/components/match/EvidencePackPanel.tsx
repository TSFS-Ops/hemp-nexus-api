import { useState, useCallback } from "react";
import { fetchEdgeFunction, EdgeInvokeError, describeEdgeError } from "@/lib/edge-invoke";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Loader2,
  Download,
  FileJson,
  FileText,
  ShieldCheck,
  ShieldAlert,
  Hash,
  Clock,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Award,
  Eye,
  EyeOff,
  ScrollText,
} from "lucide-react";
import { toast } from "sonner";
import * as MatchState from "@/lib/match-state";
import { downloadFile } from "@/lib/download-utils";

interface EvidencePackPanelProps {
  matchId: string;
  matchStatus: string;
  matchState?: string;
}

interface EvidencePackData {
  metadata: {
    packId: string;
    generatedAt: string;
    format: string;
  };
  packHash: string;
  hashAlgorithm: string;
  signatureValidation: {
    hasCollapseRecord: boolean;
    signatureValid: boolean | null;
    signatureKeyId: string | null;
  };
  timestampMetadata: {
    serverTimestampUtc: string;
    matchCreatedAt: string;
    matchSettledAt: string | null;
    collapseClientTimestamp: string | null;
    collapseServerTimestamp: string | null;
    timestampSource: string;
  };
  chainVerification: {
    valid: boolean;
    eventCount: number;
  };
  canonical: Record<string, unknown>;
}

export function EvidencePackPanel({ matchId, matchStatus, matchState }: EvidencePackPanelProps) {
  const [pack, setPack] = useState<EvidencePackData | null>(null);
  const [loading, setLoading] = useState(false);
  const [certLoading, setCertLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    match: boolean;
    originalHash: string;
    recomputedHash: string;
  } | null>(null);

  const isSettled = MatchState.isSettled(matchStatus);
  const isCompleted = matchState === "completed";
  // Evidence pack is generatable as soon as the trade has progressed past
  // discovery (i.e. POI exists / WaD has been issued). Settlement is no longer
  // required; the deal certificate (below) remains gated on `completed`.
  const canGeneratePack =
    isSettled ||
    isCompleted ||
    (!!matchState && matchState !== "discovery");

  const generatePack = useCallback(async () => {
    try {
      setLoading(true);
      setVerificationResult(null);
      setPreviewHtml(null);
      setPreviewOpen(false);

      const data = await fetchEdgeFunction<EvidencePackData>(`evidence-pack/${matchId}`, {
        method: "GET",
        label: "generate evidence pack",
      });
      setPack(data);
      toast.success("Evidence pack generated successfully");
    } catch (error: unknown) {
      const message = describeEdgeError(error, "Failed to generate evidence pack");
      console.error("Evidence pack error:", error);
      toast.error(message, { duration: 8000 });
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  // Build a self-describing artifact slug: <matchId>-<version>-<shortHash>-<utcStamp>
  // so the file on disk is unambiguously traceable back to the pack version + hash + moment of generation.
  const buildArtifactSlug = useCallback(
    (p: EvidencePackData): { slug: string; shortHash: string; utcStamp: string; version: string } => {
      const version = p.metadata.format || "v1";
      const shortHash = p.packHash ? p.packHash.slice(0, 12) : "nohash";
      const utcStamp = (p.metadata.generatedAt || new Date().toISOString())
        .replace(/[:.]/g, "-")
        .replace(/Z$/, "Z");
      return {
        slug: `${matchId}-${version}-${shortHash}-${utcStamp}`,
        shortHash,
        utcStamp,
        version,
      };
    },
    [matchId],
  );

  const downloadJson = useCallback(() => {
    if (!pack) return;
    const { slug, shortHash, version } = buildArtifactSlug(pack);
    const filename = `evidence-pack-${slug}.json`;
    // Annotate the canonical pack with traceability fields without mutating the canonical block
    // (which is the SHA-256 source of truth — must NOT be modified).
    const annotated = {
      ...pack,
      traceability: {
        artifactVersion: version,
        sha256: pack.packHash,
        sha256Short: shortHash,
        generatedAtUtc: pack.metadata.generatedAt,
        downloadedAtUtc: new Date().toISOString(),
        matchId,
      },
    };
    const json = JSON.stringify(annotated, null, 2);
    downloadFile(json, filename, "application/json");
    toast.success("Canonical JSON downloaded", {
      description: `Saved as ${filename} · ${version} · SHA-256 ${shortHash}…`,
      duration: 6000,
    });
  }, [pack, matchId, buildArtifactSlug]);

  const fetchHtmlReport = useCallback(async (): Promise<string | null> => {
    try {
      const html = await fetchEdgeFunction<string>(`evidence-pack/${matchId}`, {
        method: "GET",
        query: { format: "pdf" },
        label: "load evidence report",
      });
      return typeof html === "string" ? html : String(html ?? "");
    } catch (error) {
      console.error("Report fetch error:", error);
      toast.error(describeEdgeError(error, "Failed to load evidence report"), { duration: 8000 });
      return null;
    }
  }, [matchId]);

  const downloadHtmlReport = useCallback(async () => {
    if (!pack) return;
    const html = previewHtml ?? (await fetchHtmlReport());
    if (!html) return;
    const { slug, shortHash, utcStamp, version } = buildArtifactSlug(pack);
    const filename = `evidence-pack-${slug}.html`;
    // Prepend a non-rendering HTML comment carrying traceability metadata so the file
    // on disk is self-describing even when opened in a text editor.
    const header =
      `<!-- Izenzo Evidence Pack\n` +
      `     Match ID: ${matchId}\n` +
      `     Artifact version: ${version}\n` +
      `     SHA-256: ${pack.packHash}\n` +
      `     Generated (UTC): ${pack.metadata.generatedAt}\n` +
      `     Downloaded (UTC): ${new Date().toISOString()}\n` +
      `-->\n`;
    downloadFile(header + html, filename, "text/html");
    toast.success("Evidence report downloaded", {
      description: `Saved as ${filename} · ${version} · SHA-256 ${shortHash}… · generated ${utcStamp}`,
      duration: 8000,
    });
  }, [pack, fetchHtmlReport, previewHtml, matchId, buildArtifactSlug]);

  /**
   * Standalone Audit Trail export — separate file (CSV by default, JSON optional)
   * containing only the audit_logs entries for this match. Includes its own
   * SHA-256 trail hash + the parent pack hash for cross-traceability so a
   * compliance reviewer can ingest it independently of the full evidence pack.
   */
  const downloadAuditTrail = useCallback(
    async (variant: "csv" | "json" = "csv") => {
      try {
        setAuditLoading(true);
        const data = await fetchEdgeFunction<string>(`evidence-pack/${matchId}/audit`, {
          method: "GET",
          query: { format: variant },
          label: "export audit trail",
        });
        const body = typeof data === "string" ? data : JSON.stringify(data, null, 2);
        const ext = variant === "json" ? "json" : "csv";
        const mime = variant === "json" ? "application/json" : "text/csv";
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z");
        const filename = `audit-trail-${matchId}-${stamp}.${ext}`;

        // Batch T — AUD-017: standalone audit-trail export is sensitive
        // (it leaks the per-match chronological action log). Audit BEFORE
        // any bytes leave the browser, and block on AAL2 if required.
        const auditResult = await recordExportAudit({
          target_type: "audit_logs",
          format: variant,
          row_count: body.split(/\r?\n/).filter(Boolean).length,
          sensitive: true,
          filters: { match_id: matchId },
          reason: "evidence-pack standalone audit trail",
        });
        if (auditResult.aal_required) {
          toast.error("Multi-factor authentication required for this export.", {
            description: "Please re-authenticate with MFA to download audit trails.",
            duration: 7000,
          });
          return;
        }

        // Prepend a provenance preamble for CSV (JSON keeps its own shape).
        const finalBody = variant === "csv"
          ? `# report: evidence-pack-audit-trail\n# generated_at: ${new Date().toISOString()}\n# match_id: ${matchId}\n${body}`
          : body;
        downloadFile(finalBody, filename, mime);
        toast.success("Audit trail exported", {
          description: `Saved as ${filename} — standalone audit log for compliance review.`,
          duration: 7000,
        });
      } catch (error) {
        console.error("Audit trail export error:", error);
        toast.error(describeEdgeError(error, "Failed to export audit trail"), { duration: 8000 });
      } finally {
        setAuditLoading(false);
      }
    },
    [matchId],
  );

  const togglePreview = useCallback(async () => {
    if (previewOpen) {
      setPreviewOpen(false);
      return;
    }
    if (previewHtml) {
      setPreviewOpen(true);
      return;
    }
    setPreviewLoading(true);
    const html = await fetchHtmlReport();
    setPreviewLoading(false);
    if (html) {
      setPreviewHtml(html);
      setPreviewOpen(true);
    }
  }, [fetchHtmlReport, previewHtml, previewOpen]);

  const downloadDealCertificate = useCallback(async () => {
    try {
      setCertLoading(true);
      const html = await fetchEdgeFunction<string>(`deal-certificate/${matchId}`, {
        method: "GET",
        label: "download deal certificate",
      });
      downloadFile(html, `deal-certificate-${matchId}.html`, "text/html");
      toast.success("Deal certificate downloaded.", {
        description: "Open the HTML file in your browser to view the formatted certificate.",
        duration: 6000,
      });
    } catch (error) {
      if (error instanceof EdgeInvokeError && error.status === 422) {
        toast.error("Certificate is only available once the deal reaches Signed Deal state.");
        return;
      }
      console.error("Certificate download error:", error);
      toast.error(describeEdgeError(error, "Failed to download certificate."), { duration: 8000 });
    } finally {
      setCertLoading(false);
    }
  }, [matchId]);

  /**
   * Verification: regenerate the pack and compare hashes.
   * If they match, the data is untampered.
   */
  const verifyIntegrity = useCallback(async () => {
    if (!pack) return;

    try {
      setVerifying(true);
      const freshPack = await fetchEdgeFunction<EvidencePackData>(`evidence-pack/${matchId}`, {
        method: "GET",
        label: "verify evidence pack",
      });
      const hashesMatch = pack.packHash === freshPack.packHash;

      setVerificationResult({
        match: hashesMatch,
        originalHash: pack.packHash,
        recomputedHash: freshPack.packHash,
      });

      if (hashesMatch) {
        toast.success("Integrity verified - hashes match");
      } else {
        toast.error("Hash mismatch detected - data may have been tampered with");
      }
    } catch (error) {
      console.error("Verification error:", error);
      toast.error("Verification failed");
    } finally {
      setVerifying(false);
    }
  }, [pack, matchId]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5" />
            Evidence Pack
          </CardTitle>
          {pack && (
            <Badge variant="outline" className="font-mono text-xs">
              {pack.metadata.format}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canGeneratePack && (
          <div className="flex items-center gap-2 p-3 rounded-md bg-muted text-muted-foreground text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Evidence packs are available once the Proof of Intent has been generated.</span>
          </div>
        )}

        {/* Deal Certificate - only available at Signed Deal (completed) state */}
        {isCompleted && (
          <div className="p-4 rounded-md border border-primary/20 bg-primary/5 space-y-3">
            <div className="flex items-center gap-2">
              <Award className="h-5 w-5 text-primary" />
              <span className="font-semibold text-sm">Certificate of Signed Deal</span>
              <Badge variant="secondary" className="text-[10px]">Sealed</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              This deal has been tamper-proofally sealed. Download the institutional-grade certificate
              containing partner identities, trade terms, and hash-chain integrity verification.
            </p>
            <Button
              onClick={downloadDealCertificate}
              disabled={certLoading}
              className="w-full"
            >
              {certLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating certificate…
                </>
              ) : (
                <>
                  <Award className="h-4 w-4 mr-2" />
                  Download Deal Certificate
                </>
              )}
            </Button>
          </div>
        )}

        {/* Generate button */}
        {canGeneratePack && !pack && (
          <Button onClick={generatePack} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4 mr-2" />
                Generate Evidence Pack
              </>
            )}
          </Button>
        )}

        {/* Pack details */}
        {pack && (
          <>
            {/* Hash */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Hash className="h-4 w-4" />
                SHA-256 Hash
              </div>
              <code className="block p-3 bg-muted rounded-md text-xs font-mono break-all">
                {pack.packHash}
              </code>
            </div>

            <Separator />

            {/* Signature validation */}
            <div className="space-y-2">
              <div className="text-sm font-medium">Signature Validation</div>
              <div className="flex items-center gap-2">
                {pack.signatureValidation.hasCollapseRecord ? (
                  pack.signatureValidation.signatureValid ? (
                    <Badge className="bg-green-600 hover:bg-green-700 gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Valid Signature
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <ShieldAlert className="h-3 w-3" />
                      Invalid Signature
                    </Badge>
                  )
                ) : (
                  <Badge variant="secondary" className="gap-1">
                    No collapse record
                  </Badge>
                )}
                {pack.signatureValidation.signatureKeyId && (
                  <span className="text-xs text-muted-foreground font-mono">
                    Key: {pack.signatureValidation.signatureKeyId}
                  </span>
                )}
              </div>
            </div>

            <Separator />

            {/* Chain verification */}
            <div className="space-y-2">
              <div className="text-sm font-medium">Chain Integrity</div>
              <div className="flex items-center gap-2">
                {pack.chainVerification.valid ? (
                  <Badge className="bg-green-600 hover:bg-green-700 gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    Verified ({pack.chainVerification.eventCount} events)
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <ShieldAlert className="h-3 w-3" />
                    Compromised
                  </Badge>
                )}
              </div>
            </div>

            <Separator />

            {/* Timestamps */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Clock className="h-4 w-4" />
                Timestamps
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Generated</dt>
                <dd className="font-mono">{new Date(pack.timestampMetadata.serverTimestampUtc).toLocaleString()}</dd>
                <dt className="text-muted-foreground">Match created</dt>
                <dd className="font-mono">{new Date(pack.timestampMetadata.matchCreatedAt).toLocaleString()}</dd>
                {pack.timestampMetadata.matchSettledAt && (
                  <>
                    <dt className="text-muted-foreground">Settled</dt>
                    <dd className="font-mono">{new Date(pack.timestampMetadata.matchSettledAt).toLocaleString()}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">Source</dt>
                <dd>{pack.timestampMetadata.timestampSource}</dd>
              </dl>
            </div>

            <Separator />

            {/* Download buttons */}
            <div className="space-y-2">
              {/* Artifact fingerprint — surfaces version + full SHA-256 + generated UTC
                  on the download surface itself so what you see matches what hits disk. */}
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] font-mono text-muted-foreground space-y-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>
                    <span className="text-foreground font-semibold">Version:</span>{" "}
                    {pack.metadata.format || "v1"}
                  </span>
                  <span>
                    <span className="text-foreground font-semibold">Generated (UTC):</span>{" "}
                    {pack.metadata.generatedAt}
                  </span>
                </div>
                <div className="break-all">
                  <span className="text-foreground font-semibold">SHA-256:</span> {pack.packHash}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button variant="default" className="flex-1" onClick={downloadHtmlReport}>
                  <FileText className="h-4 w-4 mr-2" />
                  Download Evidence Report (HTML)
                </Button>
                <Button variant="outline" className="flex-1" onClick={downloadJson}>
                  <FileJson className="h-4 w-4 mr-2" />
                  Download Canonical JSON
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={togglePreview}
                disabled={previewLoading}
              >
                {previewLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading preview…
                  </>
                ) : previewOpen ? (
                  <>
                    <EyeOff className="h-4 w-4 mr-2" />
                    Hide in-page preview
                  </>
                ) : (
                  <>
                    <Eye className="h-4 w-4 mr-2" />
                    Preview evidence pack in-page
                  </>
                )}
              </Button>

              {/* Standalone audit-trail export — separate file for compliance review */}
              <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <ScrollText className="h-3.5 w-3.5" />
                  Audit Trail (standalone)
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Download just the audit log entries for this trade as a separate file
                  — for compliance reviewers who only need the chronological action log.
                  Includes a SHA-256 trail hash plus the parent pack hash for cross-traceability.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => downloadAuditTrail("csv")}
                    disabled={auditLoading}
                  >
                    {auditLoading ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                        Exporting…
                      </>
                    ) : (
                      <>
                        <ScrollText className="h-3.5 w-3.5 mr-2" />
                        Export Audit Trail (CSV)
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1"
                    onClick={() => downloadAuditTrail("json")}
                    disabled={auditLoading}
                  >
                    <FileJson className="h-3.5 w-3.5 mr-2" />
                    Export as JSON
                  </Button>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground">
                The HTML report is the human-readable, printable evidence pack (match summary, event timeline,
                documents, approval chain, full audit references). Open it in any browser. The JSON is the
                machine-readable canonical source used to compute the SHA-256 hash above.
              </p>

              {/* In-page preview panel */}
              {previewOpen && previewHtml && (
                <div className="mt-2 rounded-md border border-border bg-background overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40">
                    <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                      <FileText className="h-3.5 w-3.5" />
                      Evidence Pack Preview
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      Read-only · sandboxed
                    </span>
                  </div>
                  <iframe
                    title="Evidence pack preview"
                    sandbox=""
                    srcDoc={previewHtml}
                    className="block w-full h-[520px] bg-background"
                  />
                </div>
              )}
            </div>

            {/* Verify button */}
            <Button
              variant="secondary"
              className="w-full"
              onClick={verifyIntegrity}
              disabled={verifying}
            >
              {verifying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Verifying…
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Verify Integrity (Regenerate & Compare)
                </>
              )}
            </Button>

            {/* Verification result */}
            {verificationResult && (
              <div
                className={`p-3 rounded-md text-sm space-y-1 ${
                  verificationResult.match
                    ? "bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800"
                    : "bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800"
                }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  {verificationResult.match ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span className="text-green-700 dark:text-green-400">Integrity Verified</span>
                    </>
                  ) : (
                    <>
                      <ShieldAlert className="h-4 w-4 text-red-600" />
                      <span className="text-red-700 dark:text-red-400">Hash Mismatch Detected</span>
                    </>
                  )}
                </div>
                <div className="text-xs font-mono space-y-0.5">
                  <div>
                    <span className="text-muted-foreground">Original: </span>
                    {verificationResult.originalHash.substring(0, 32)}…
                  </div>
                  <div>
                    <span className="text-muted-foreground">Recomputed: </span>
                    {verificationResult.recomputedHash.substring(0, 32)}…
                  </div>
                </div>
              </div>
            )}

            {/* Regenerate */}
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs"
              onClick={generatePack}
              disabled={loading}
            >
              <Download className="h-3 w-3 mr-1" />
              Regenerate
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
