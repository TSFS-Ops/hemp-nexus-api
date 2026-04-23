/**
 * AcceptanceReceiptCard
 * ─────────────────────
 * Surfaces the immutable, signed acceptance receipt for a trade engagement.
 *
 * This is the institutional answer to the "Daniel emailed support asking
 * 'did the platinum trade work?'" failure mode. The moment a counterparty
 * accepts an engagement, a row is written to public.acceptance_receipts
 * containing a SHA-256-signed payload, a linked attestation, and the
 * accepting user's identity. This card surfaces that receipt directly to
 * the initiator on the match detail page, removing all epistemic doubt.
 *
 * Read-only, deterministic, and downloadable.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ShieldCheck, Download, Hash, Clock, Mail, Building2, FileSignature } from "lucide-react";
import { format } from "date-fns";

interface AcceptanceReceiptCardProps {
  matchId: string;
}

interface ReceiptRow {
  id: string;
  engagement_id: string;
  match_id: string;
  initiator_org_id: string;
  counterparty_org_id: string | null;
  counterparty_email: string | null;
  accepting_user_id: string | null;
  accepting_user_name: string | null;
  accepting_user_email: string | null;
  accepted_at: string;
  attestation_id: string | null;
  signed_payload: string;
  signature_hash: string;
  receipt_version: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export function AcceptanceReceiptCard({ matchId }: AcceptanceReceiptCardProps) {
  const { data: receipt, isLoading } = useQuery<ReceiptRow | null>({
    queryKey: ["acceptance-receipt", matchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("acceptance_receipts")
        .select("*")
        .eq("match_id", matchId)
        .maybeSingle();
      if (error) throw error;
      return data as ReceiptRow | null;
    },
    enabled: !!matchId,
  });

  if (isLoading || !receipt) return null;

  const isBackfilled = !!(receipt.metadata as { backfilled?: boolean })?.backfilled;
  const acceptingParty =
    receipt.accepting_user_name ||
    receipt.accepting_user_email ||
    receipt.counterparty_email ||
    "Counterparty";

  const handleDownload = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            receipt_id: receipt.id,
            engagement_id: receipt.engagement_id,
            match_id: receipt.match_id,
            accepted_at: receipt.accepted_at,
            accepting_party: {
              user_id: receipt.accepting_user_id,
              name: receipt.accepting_user_name,
              email: receipt.accepting_user_email,
              counterparty_email: receipt.counterparty_email,
              counterparty_org_id: receipt.counterparty_org_id,
            },
            initiator_org_id: receipt.initiator_org_id,
            attestation_id: receipt.attestation_id,
            signed_payload: receipt.signed_payload,
            signature_hash: receipt.signature_hash,
            signature_algorithm: "SHA-256",
            receipt_version: receipt.receipt_version,
            issued_at: receipt.created_at,
            metadata: receipt.metadata,
          },
          null,
          2
        ),
      ],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `acceptance-receipt-${receipt.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="rounded-sm bg-primary/15 p-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                Acceptance Receipt
                <Badge variant="outline" className="text-xs border-primary/40 text-primary">
                  Signed · Immutable
                </Badge>
                {isBackfilled && (
                  <Badge variant="outline" className="text-xs border-muted-foreground/40 text-muted-foreground">
                    Backfilled
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="mt-1">
                Your counterparty has formally accepted this engagement. This receipt is a
                permanent, cryptographically signed record.
              </CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-2" />
            Download JSON
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="flex items-start gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide">Accepted by</p>
              <p className="font-medium">{acceptingParty}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide">Accepted at</p>
              <p className="font-medium font-mono text-xs">
                {format(new Date(receipt.accepted_at), "yyyy-MM-dd HH:mm:ss 'UTC'")}
              </p>
            </div>
          </div>
          {receipt.counterparty_email && (
            <div className="flex items-start gap-2">
              <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide">Counterparty contact</p>
                <p className="font-medium text-xs break-all">{receipt.counterparty_email}</p>
              </div>
            </div>
          )}
          {receipt.attestation_id && (
            <div className="flex items-start gap-2">
              <FileSignature className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide">Attestation</p>
                <p className="font-medium font-mono text-xs">{receipt.attestation_id.slice(0, 12)}…</p>
              </div>
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Hash className="h-3 w-3" />
            SHA-256 signature hash
          </div>
          <code className="block w-full text-xs font-mono bg-background border border-border rounded-sm p-2 break-all">
            {receipt.signature_hash}
          </code>
          <p className="text-xs text-muted-foreground">
            Receipt ID: <span className="font-mono">{receipt.id}</span>
          </p>
        </div>

        {isBackfilled && (
          <div className="rounded-sm border border-muted-foreground/30 bg-muted p-3 text-xs text-muted-foreground">
            This receipt was generated retroactively from the original engagement record.
            The acceptance event itself is immutable; the receipt artefact was created when
            the platform's signed-receipt infrastructure was deployed.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
