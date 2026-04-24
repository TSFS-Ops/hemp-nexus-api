import { useState, useCallback } from "react";
import { fetchEdgeFunction, EdgeInvokeError } from "@/lib/edge-invoke";
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
} from "lucide-react";
import { toast } from "sonner";
import * as MatchState from "@/lib/match-state";
import { downloadFile } from "@/lib/download-utils";
import { DownloadErrorState } from "./DownloadErrorState";

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

      const data = await fetchEdgeFunction<EvidencePackData>(`evidence-pack/${matchId}`, {
        method: "GET",
        label: "generate evidence pack",
      });
      setPack(data);
      toast.success("Evidence pack generated successfully");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to generate evidence pack";
      console.error("Evidence pack error:", error);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  const downloadJson = useCallback(() => {
    if (!pack) return;
    const json = JSON.stringify(pack, null, 2);
    downloadFile(json, `evidence-pack-${matchId}.json`, "application/json");
    toast.success("JSON evidence pack downloaded");
  }, [pack, matchId]);

  const downloadHtmlReport = useCallback(async () => {
    try {
      const html = await fetchEdgeFunction<string>(`evidence-pack/${matchId}`, {
        method: "GET",
        query: { format: "pdf" },
        label: "download evidence report",
      });
      downloadFile(html, `evidence-pack-${matchId}.html`, "text/html");
      toast.success("Evidence report downloaded", {
        description: "This is an HTML file. Double-click it or drag it into your browser to view the formatted report.",
        duration: 8000,
      });
    } catch (error) {
      console.error("Report download error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to download evidence report");
    }
  }, [matchId]);

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
      toast.error(error instanceof Error ? error.message : "Failed to download certificate.");
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
          <div className="p-4 rounded-lg border border-primary/20 bg-primary/5 space-y-3">
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
            <div className="flex flex-col sm:flex-row gap-2">
              <Button variant="outline" className="flex-1" onClick={downloadJson}>
                <FileJson className="h-4 w-4 mr-2" />
                Download JSON
              </Button>
              <Button variant="outline" className="flex-1" onClick={downloadHtmlReport}>
                <FileText className="h-4 w-4 mr-2" />
                Download Report
              </Button>
              <p className="text-[11px] text-muted-foreground col-span-2 text-center -mt-1">
                The report downloads as an HTML file. Open it in your browser (Chrome, Edge, Safari) to view.
              </p>
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
