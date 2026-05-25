/**
 * Batch D — HQ-only governance waiver/bypass grant + renew panel.
 *
 * Small UI affordance inside Governance Record detail. Lists currently-known
 * waivers for the anchor (most recent first) and lets a platform_admin grant
 * a new waiver/bypass or renew an existing one via the
 * `governance-waiver-grant` edge function.
 *
 * Hard rules:
 *   - Visible to platform_admin only (the parent already gates HQ access).
 *   - Submits trigger MFA/AAL2 on the backend; UI surfaces the MFA error.
 *   - Does NOT change business outcomes by itself — enforcement is in
 *     backend hooks (`assertWaiverActive` / `consumeGovernanceWaiver`).
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

type Posture = "waiver" | "bypass";
type Status = "active" | "consumed" | "expired" | "revoked";

interface WaiverRow {
  waiver_id: string;
  org_id: string;
  posture: Posture;
  scope: string;
  scope_id: string | null;
  match_id: string | null;
  poi_id: string | null;
  wad_id: string | null;
  granted_by: string;
  granted_at: string;
  expires_at: string;
  max_uses: number;
  uses: number;
  status: Status;
  reason_code: string;
  note: string | null;
  renewed_from: string | null;
}

const REASON_CODES = [
  { value: "client_instruction", label: "Client instruction" },
  { value: "incorrect_data_correction", label: "Incorrect data correction" },
  { value: "manual_verification_completed", label: "Manual verification completed" },
  { value: "dispute_reviewed", label: "Dispute reviewed" },
  { value: "system_recovery", label: "System recovery" },
  { value: "waiver_renewed", label: "Waiver renewed" },
  { value: "other", label: "Other (note required)" },
];

const SCOPES = ["poi", "wad", "execution", "finality", "custom"];

interface Props {
  anchor: {
    matchId?: string | null;
    poiId?: string | null;
    wadId?: string | null;
  };
  orgId: string | null;
}

export function GovernanceWaiversPanel({ anchor, orgId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [renewFrom, setRenewFrom] = useState<WaiverRow | null>(null);

  const filters = useMemo(
    () => ({
      match_id: anchor.matchId ?? null,
      poi_id: anchor.poiId ?? null,
      wad_id: anchor.wadId ?? null,
    }),
    [anchor.matchId, anchor.poiId, anchor.wadId],
  );

  const waiversQuery = useQuery({
    queryKey: ["governance_waivers", filters],
    queryFn: async (): Promise<WaiverRow[]> => {
      let q = supabase
        .from("governance_waivers" as never)
        .select("*")
        .order("granted_at", { ascending: false })
        .limit(50);
      if (filters.match_id) q = q.eq("match_id", filters.match_id);
      else if (filters.poi_id) q = q.eq("poi_id", filters.poi_id);
      else if (filters.wad_id) q = q.eq("wad_id", filters.wad_id);
      else return [];
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as WaiverRow[];
    },
    enabled: Boolean(filters.match_id || filters.poi_id || filters.wad_id),
  });

  return (
    <Card data-testid="governance-waivers-panel">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" aria-hidden /> Waivers &amp; bypasses
          </CardTitle>
          <CardDescription>
            HQ-granted, single-use, max 7 days. Renewal requires a new HQ decision.
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setRenewFrom(null);
            setOpen(true);
          }}
          data-testid="grant-waiver-btn"
        >
          Grant waiver / bypass
        </Button>
      </CardHeader>
      <CardContent>
        {waiversQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : (waiversQuery.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No waiver or bypass on this record.</p>
        ) : (
          <ul className="divide-y border rounded-md">
            {(waiversQuery.data ?? []).map((w) => (
              <WaiverRowItem
                key={w.waiver_id}
                row={w}
                onRenew={() => {
                  setRenewFrom(w);
                  setOpen(true);
                }}
              />
            ))}
          </ul>
        )}
      </CardContent>

      <WaiverDialog
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        orgId={orgId}
        renewFrom={renewFrom}
        onSuccess={() => {
          setOpen(false);
          setRenewFrom(null);
          qc.invalidateQueries({ queryKey: ["governance_waivers"] });
          toast({ title: "Waiver recorded" });
        }}
      />
    </Card>
  );
}

function WaiverRowItem({ row, onRenew }: { row: WaiverRow; onRenew: () => void }) {
  const expired = Date.parse(row.expires_at) <= Date.now() || row.status === "expired";
  const usable = row.status === "active" && !expired && row.uses < row.max_uses;
  return (
    <li className="px-3 py-2.5 flex items-start justify-between gap-3" data-testid="waiver-row">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <Badge variant={row.posture === "bypass" ? "destructive" : "secondary"}>
            {row.posture === "bypass" ? "Bypass Applied" : "Waiver Applied"}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground">scope={row.scope}</span>
          <StatusBadge row={row} expired={expired} />
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Reason: <span className="font-medium text-foreground">{row.reason_code}</span>
          {" · "}
          Uses {row.uses}/{row.max_uses}
          {" · "}
          Expires {format(new Date(row.expires_at), "yyyy-MM-dd HH:mm")}
        </div>
        {row.note ? (
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{row.note}</p>
        ) : null}
        {row.renewed_from ? (
          <p className="mt-1 text-[11px] text-muted-foreground font-mono">
            Renewal of {row.renewed_from.slice(0, 8)}…
          </p>
        ) : null}
      </div>
      <div className="shrink-0">
        {usable ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" /> Progression allowed
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={onRenew} data-testid="renew-waiver-btn">
            Renew
          </Button>
        )}
      </div>
    </li>
  );
}

function StatusBadge({ row, expired }: { row: WaiverRow; expired: boolean }) {
  if (row.status === "consumed") return <Badge variant="outline">Consumed</Badge>;
  if (row.status === "revoked") return <Badge variant="outline">Revoked</Badge>;
  if (expired) return <Badge variant="outline">Expired</Badge>;
  return <Badge variant="default">Active</Badge>;
}

function WaiverDialog({
  open,
  onClose,
  anchor,
  orgId,
  renewFrom,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  anchor: Props["anchor"];
  orgId: string | null;
  renewFrom: WaiverRow | null;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [posture, setPosture] = useState<Posture>("waiver");
  const [scope, setScope] = useState<string>("poi");
  const [reasonCode, setReasonCode] = useState<string>("client_instruction");
  const [note, setNote] = useState<string>("");
  const [maxUses, setMaxUses] = useState<number>(1);

  useEffect(() => {
    if (!open) return;
    if (renewFrom) {
      setPosture(renewFrom.posture);
      setScope(renewFrom.scope);
      setReasonCode("waiver_renewed");
      setNote("");
      setMaxUses(renewFrom.max_uses);
    } else {
      setPosture("waiver");
      setScope("poi");
      setReasonCode("client_instruction");
      setNote("");
      setMaxUses(1);
    }
  }, [open, renewFrom]);

  const submit = useMutation({
    mutationFn: async () => {
      const payload = renewFrom
        ? {
            mode: "renew" as const,
            prior_waiver_id: renewFrom.waiver_id,
            reason_code: reasonCode,
            note: note || null,
            max_uses: maxUses,
          }
        : {
            mode: "grant" as const,
            posture,
            scope,
            org_id: orgId,
            match_id: anchor.matchId ?? null,
            poi_id: anchor.poiId ?? null,
            wad_id: anchor.wadId ?? null,
            reason_code: reasonCode,
            note: note || null,
            max_uses: maxUses,
          };
      const { data, error } = await supabase.functions.invoke(
        "governance-waiver-grant",
        { body: payload },
      );
      if (error) throw error;
      if (data && (data as { ok?: boolean }).ok === false) {
        throw new Error((data as { error?: string }).error ?? "waiver_failed");
      }
      return data;
    },
    onSuccess,
    onError: (e: Error) => {
      toast({ title: "Waiver failed", description: e.message, variant: "destructive" });
    },
  });

  const otherTooShort =
    reasonCode === "other" && note.trim().length < 16;
  const canSubmit =
    !!orgId &&
    !!reasonCode &&
    !otherTooShort &&
    (renewFrom || anchor.matchId || anchor.poiId || anchor.wadId);

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{renewFrom ? "Renew waiver / bypass" : "Grant waiver / bypass"}</DialogTitle>
          <DialogDescription>
            Single-use by default, expires in 7 days. MFA required.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!renewFrom && (
            <>
              <div>
                <Label>Posture</Label>
                <Select value={posture} onValueChange={(v) => setPosture(v as Posture)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="waiver">Waiver Applied</SelectItem>
                    <SelectItem value="bypass">Bypass Applied</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Affected step / scope</Label>
                <Select value={scope} onValueChange={setScope}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SCOPES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          <div>
            <Label>Reason code</Label>
            <Select value={reasonCode} onValueChange={setReasonCode}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REASON_CODES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Note {reasonCode === "other" ? "(min 16 chars)" : "(optional)"}</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Describe the binding HQ decision…"
              rows={3}
            />
            {otherTooShort && (
              <p className="text-xs text-destructive mt-1">
                Note must be at least 16 characters when reason is "other".
              </p>
            )}
          </div>
          <div>
            <Label>Max uses</Label>
            <Input
              type="number"
              min={1}
              max={10}
              value={maxUses}
              onChange={(e) => setMaxUses(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!canSubmit || submit.isPending}
            onClick={() => submit.mutate()}
            data-testid="waiver-submit-btn"
          >
            {submit.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
            {renewFrom ? "Renew" : "Grant"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
