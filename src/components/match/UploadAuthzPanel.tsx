import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, RefreshCw, ShieldCheck, ShieldAlert, Copy } from "lucide-react";
import { toast } from "sonner";
import {
  probeMatchUploadAuthz,
  type UploadAuthzResult,
} from "@/lib/match-upload-authz-client";

interface UploadAuthzPanelProps {
  matchId: string;
}

/**
 * Diagnostic panel that calls `match-upload-authz` and renders the exact
 * org/buyer/seller IDs the server used to decide whether the current
 * caller is allowed to upload a document for this match. Operators copy
 * these values straight into a support note when an upload is rejected.
 */
export function UploadAuthzPanel({ matchId }: UploadAuthzPanelProps) {
  const [result, setResult] = useState<UploadAuthzResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const probe = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await probeMatchUploadAuthz(matchId);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Probe failed");
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    probe();
  }, [probe]);

  const copyDiagnostic = () => {
    if (!result) return;
    const blob = JSON.stringify(result, null, 2);
    navigator.clipboard.writeText(blob).then(
      () => toast.success("Diagnostic copied to clipboard"),
      () => toast.error("Could not copy to clipboard")
    );
  };

  return (
    <Card className="border-slate-200">
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <div className="flex items-center gap-2">
          {result?.decision.can_upload ? (
            <ShieldCheck className="h-4 w-4 text-emerald-700" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-amber-600" />
          )}
          <CardTitle className="text-sm font-medium">
            Upload authorisation probe
          </CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={copyDiagnostic}
            disabled={!result}
            aria-label="Copy diagnostic"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={probe}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5">Re-check</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : !result ? (
          <p className="text-sm text-slate-500">Checking…</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge
                variant={result.decision.can_upload ? "default" : "destructive"}
              >
                {result.decision.can_upload
                  ? "Authorised to upload"
                  : "Not authorised"}
              </Badge>
              <span className="text-xs text-slate-500">
                Reason: <code className="font-mono">{result.decision.reason}</code>
              </span>
            </div>

            {result.decision.participant_roles.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs text-slate-500">Resolved role(s):</span>
                {result.decision.participant_roles.map((r) => (
                  <Badge key={r} variant="secondary" className="text-[10px]">
                    {r}
                  </Badge>
                ))}
                {result.caller.is_platform_admin && (
                  <Badge variant="outline" className="text-[10px]">
                    platform_admin
                  </Badge>
                )}
              </div>
            )}

            <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
              <Field label="Caller user_id" value={result.caller.user_id} />
              <Field label="Caller org_id" value={result.caller.org_id} />
              <Field label="Match org_id (initiator)" value={result.match.org_id} />
              <Field label="Match status" value={result.match.status} />
              <Field label="Match buyer_org_id" value={result.match.buyer_org_id} />
              <Field label="Match seller_org_id" value={result.match.seller_org_id} />
              <Field
                label="Storage path prefix"
                value={result.storage.path_prefix}
                full
              />
              <Field label="server request_id" value={result.request_id} full />
            </dl>

            {!result.decision.can_upload && (
              <Alert>
                <AlertDescription className="text-xs">
                  Your current organisation is not on this match's initiator,
                  buyer, or seller slot, so storage access rules will reject the
                  upload. Confirm you are signed in to the correct organisation
                  for this match, or ask the initiating party to invite the
                  right organisation.
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  full,
}: {
  label: string;
  value: string | null;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="break-all font-mono text-xs text-slate-900">
        {value ?? <span className="text-slate-400">—</span>}
      </dd>
    </div>
  );
}
