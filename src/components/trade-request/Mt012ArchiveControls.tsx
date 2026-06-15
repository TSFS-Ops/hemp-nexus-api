/**
 * MT-012 - Minimal owner-org + admin controls for trade-request archive.
 *
 * Pure presentational component. Renders three actions backed by the
 * three MT-012 edge functions. Owner-org sees the archive button; admin
 * sees the override + release actions. All copy is verbatim from the
 * signed SSOT (`MT012_BLOCK_MESSAGE`, `MT012_ADMIN_OVERRIDE_WARNING`).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  MT012_BLOCK_MESSAGE,
  MT012_ADMIN_OVERRIDE_WARNING,
  MT012_MIN_REASON_LENGTH,
} from "@/lib/trade-request/mt-012-audit";

interface BlockingChild { match_id: string; status?: string | null; state?: string | null; poi_state?: string | null; }

export interface Mt012ArchiveControlsProps {
  tradeRequestId: string;
  isOwnerOrg: boolean;
  isPlatformAdmin: boolean;
  isArchived?: boolean;
  hasExceptionHoldChildren?: boolean;
  onArchived?: () => void;
  onReleased?: () => void;
}

export function Mt012ArchiveControls({
  tradeRequestId,
  isOwnerOrg,
  isPlatformAdmin,
  isArchived,
  hasExceptionHoldChildren,
  onArchived,
  onReleased,
}: Mt012ArchiveControlsProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockingChildren, setBlockingChildren] = useState<BlockingChild[]>([]);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [reason, setReason] = useState("");

  const reasonOk = reason.trim().length >= MT012_MIN_REASON_LENGTH;

  const handleNormalArchive = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("trade-request-archive", {
        body: { trade_request_id: tradeRequestId },
      });
      if (error) {
        const ctx = (error as unknown as { context?: { json?: () => Promise<unknown> } }).context;
        let body: { code?: string; blocking_children?: BlockingChild[] } | null = null;
        try { body = (await ctx?.json?.()) as typeof body; } catch { /* ignore */ }
        if (body?.code === "ACTIVE_CHILDREN_BLOCK") {
          setBlockingChildren(body.blocking_children ?? []);
          setBlockOpen(true);
          return;
        }
        toast({ title: "Archive failed", description: body?.code ?? error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Trade request archived" });
      onArchived?.();
    } catch (e) {
      toast({ title: "Archive failed", description: String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleOverride = async () => {
    if (!reasonOk) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-trade-request-archive-override", {
        body: { trade_request_id: tradeRequestId, reason: reason.trim() },
      });
      if (error) {
        toast({ title: "Override failed", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Trade request archived with admin override" });
      setOverrideOpen(false);
      setReason("");
      onArchived?.();
    } finally {
      setBusy(false);
    }
  };

  const handleRelease = async () => {
    if (!reasonOk) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-trade-request-exception-hold-release", {
        body: { trade_request_id: tradeRequestId, reason: reason.trim() },
      });
      if (error) {
        toast({ title: "Release failed", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Exception hold released" });
      setReleaseOpen(false);
      setReason("");
      onReleased?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isOwnerOrg && !isArchived && (
        <Button variant="outline" size="sm" disabled={busy} onClick={handleNormalArchive}>
          Archive trade request
        </Button>
      )}
      {isPlatformAdmin && !isArchived && (
        <Button variant="destructive" size="sm" disabled={busy} onClick={() => setOverrideOpen(true)}>
          Admin override archive
        </Button>
      )}
      {isPlatformAdmin && hasExceptionHoldChildren && (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setReleaseOpen(true)}>
          Release exception hold
        </Button>
      )}

      {/* Block dialog */}
      <Dialog open={blockOpen} onOpenChange={setBlockOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cannot archive trade request</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground">{MT012_BLOCK_MESSAGE}</p>
          {blockingChildren.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs font-mono">
              {blockingChildren.map((c) => (
                <li key={c.match_id} className="flex items-center justify-between gap-2 border-t border-border py-1">
                  <span className="truncate">{c.match_id}</span>
                  <Badge variant="secondary">{c.status ?? c.state ?? c.poi_state ?? "active"}</Badge>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin override dialog */}
      <Dialog open={overrideOpen} onOpenChange={(o) => { setOverrideOpen(o); if (!o) setReason(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Admin override - archive with active child matches</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground">{MT012_ADMIN_OVERRIDE_WARNING}</p>
          <Textarea
            placeholder={`Reason (minimum ${MT012_MIN_REASON_LENGTH} characters)`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button variant="destructive" disabled={!reasonOk || busy} onClick={handleOverride}>
              Confirm admin override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Release dialog */}
      <Dialog open={releaseOpen} onOpenChange={(o) => { setReleaseOpen(o); if (!o) setReason(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Release exception hold</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground">
            Releasing the exception hold clears the hold marker on affected child matches.
            The parent trade request will remain archived. No POI, WaD, execution, finality,
            credit, or payment events will be triggered.
          </p>
          <Textarea
            placeholder={`Reason (minimum ${MT012_MIN_REASON_LENGTH} characters)`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button disabled={!reasonOk || busy} onClick={handleRelease}>
              Confirm release
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
