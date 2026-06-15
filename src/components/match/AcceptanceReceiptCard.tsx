/**
 * AcceptanceReceiptCard
 * ─────────────────────
 * Surfaces the immutable, signed acceptance receipt for a trade engagement.
 *
 * This card serves two audiences:
 *   1. The COUNTERPARTY sees a passive confirmation that their acceptance
 *      was captured and signed.
 *   2. The INITIATOR sees the same receipt PLUS an explicit
 *      acknowledgement button: "I have seen the acceptance receipt".
 *      Clicking it writes a chained attestation (type =
 *      receipt_acknowledged) and an acknowledgement row, closing the
 *      audit loop. This is the institutional answer to the
 *      "Daniel emailed support asking 'did the platinum trade work?'"
 *      failure mode - the platform now records, on-chain, that the
 *      initiator personally saw and accepted the counterparty's signed
 *      acceptance.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { LoadingButton } from "@/components/ui/loading-button";
import { ShieldCheck, Download, Hash, Clock, Mail, Building2, FileSignature, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { useUserOrg } from "@/hooks/use-user-org";
import { useToast } from "@/hooks/use-toast";

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

interface AcknowledgementRow {
  id: string;
  receipt_id: string;
  acknowledging_user_id: string;
  acknowledging_user_name: string | null;
  acknowledging_user_email: string | null;
  acknowledged_at: string;
  signature_hash: string;
  receipt_signature_hash: string;
  attestation_id: string | null;
}

export function AcceptanceReceiptCard({ matchId }: AcceptanceReceiptCardProps) {
  const userOrgId = useUserOrg();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  const { data: acks } = useQuery<AcknowledgementRow[]>({
    queryKey: ["acceptance-receipt-acks", receipt?.id],
    queryFn: async () => {
      if (!receipt?.id) return [];
      const { data, error } = await supabase
        .from("acceptance_receipt_acknowledgements")
        .select("id, receipt_id, acknowledging_user_id, acknowledging_user_name, acknowledging_user_email, acknowledged_at, signature_hash, receipt_signature_hash, attestation_id")
        .eq("receipt_id", receipt.id)
        .order("acknowledged_at", { ascending: true });
      if (error) throw error;
      return (data as AcknowledgementRow[]) || [];
    },
    enabled: !!receipt?.id,
  });

  const ackMutation = useMutation({
    mutationFn: async () => {
      if (!receipt?.id) throw new Error("Missing receipt");
      const userAgent = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null;
      const { data, error } = await supabase.rpc("acknowledge_acceptance_receipt", {
        p_receipt_id: receipt.id,
        p_user_agent: userAgent,
        p_ip_address: null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["acceptance-receipt-acks", receipt?.id] });
      setConfirmOpen(false);
      toast({
        title: data?.already_acknowledged ? "Already acknowledged" : "Acknowledgement recorded",
        description: data?.already_acknowledged
          ? "Your earlier acknowledgement is still on the audit trail."
          : "Your acknowledgement has been signed and linked to the attestation chain.",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not record acknowledgement",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading || !receipt) return null;

  const isInitiator = !!userOrgId && userOrgId === receipt.initiator_org_id;
  // Any ack on this receipt comes from the initiator org (RLS enforces this),
  // so showing the first one is correct for both audiences.
  const orgAck = acks && acks.length > 0 ? acks[0] : null;

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
            acknowledgements: (acks || []).map((a) => ({
              acknowledgement_id: a.id,
              user_id: a.acknowledging_user_id,
              name: a.acknowledging_user_name,
              email: a.acknowledging_user_email,
              acknowledged_at: a.acknowledged_at,
              signature_hash: a.signature_hash,
              chained_receipt_signature_hash: a.receipt_signature_hash,
              attestation_id: a.attestation_id,
            })),
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
                {orgAck && (
                  <Badge variant="outline" className="text-xs border-[hsl(var(--success))]/40 text-[hsl(var(--success))]">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Acknowledged by initiator
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

        {/* ── Initiator acknowledgement loop ───────────────────────────── */}
        {isInitiator && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                <CheckCircle2 className="h-3 w-3" />
                Initiator acknowledgement
              </div>

              {orgAck ? (
                <div className="rounded-sm border border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/5 p-3 text-sm space-y-1">
                  <p className="font-medium text-[hsl(var(--success))]">
                    Acknowledged by {orgAck.acknowledging_user_name || orgAck.acknowledging_user_email || "your team"}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {format(new Date(orgAck.acknowledged_at), "yyyy-MM-dd HH:mm:ss 'UTC'")}
                  </p>
                  <p className="text-xs text-muted-foreground break-all">
                    Acknowledgement signature: <span className="font-mono">{orgAck.signature_hash.slice(0, 24)}…</span>
                  </p>
                  {orgAck.attestation_id && (
                    <p className="text-xs text-muted-foreground break-all">
                      Linked attestation: <span className="font-mono">{orgAck.attestation_id.slice(0, 24)}…</span>
                    </p>
                  )}
                </div>
              ) : confirmOpen ? (
                <div className="rounded-sm border border-primary/30 bg-background p-3 space-y-3">
                  <p className="text-sm">
                    By acknowledging, you confirm that you have personally reviewed the
                    counterparty's signed acceptance receipt above. Your acknowledgement
                    will be cryptographically signed, linked to the attestation chain, and
                    cannot be undone.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <LoadingButton
                      size="sm"
                      onClick={() => ackMutation.mutate()}
                      loading={ackMutation.isPending}
                      loadingText="Signing acknowledgement…"
                    >
                      Confirm acknowledgement
                    </LoadingButton>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmOpen(false)}
                      disabled={ackMutation.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Your counterparty has signed and accepted. Please confirm you have seen
                    this receipt - your acknowledgement closes the audit loop and is
                    recorded against the attestation chain.
                  </p>
                  <Button size="sm" onClick={() => setConfirmOpen(true)}>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    I have seen the acceptance receipt
                  </Button>
                </div>
              )}
            </div>
          </>
        )}

        {/* Counterparty-side passive view of any initiator acknowledgement */}
        {!isInitiator && orgAck && (
          <>
            <Separator />
            <div className="rounded-sm border border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/5 p-3 text-xs text-muted-foreground">
              The initiator confirmed receipt of your acceptance on{" "}
              <span className="font-mono">
                {format(new Date(orgAck.acknowledged_at), "yyyy-MM-dd HH:mm 'UTC'")}
              </span>
              .
            </div>
          </>
        )}

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
