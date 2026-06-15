/**
 * VerificationWalkthroughCard
 *
 * Operational proof harness embedded in the admin verification queue.
 * Lets a platform admin convert vacuous invariant passes (INV-D / INV-G)
 * into substantive ones by walking a real synthetic record through the
 * production code path:
 *
 *   1. Seed   - creates an open match + intel row + pending OVR
 *   2. Action - admin completes the OVR via the existing queue dialog
 *   3. Verify - re-runs INV-B / INV-D / INV-G across the live data set
 *   4. Clean  - deletes the synthetic fixtures + their audit rows
 *
 * The completion in step 2 is intentionally NOT performed by this card -
 * the audit row INV-G inspects must be written by the same UI/code path a
 * real admin uses in production, otherwise the test proves nothing.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Sparkles, RefreshCw, Trash2, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type SeedResult = {
  ok: true;
  match_id: string;
  intel_id: string;
  request_id: string;
  subject_name: string;
};

type InvariantResult = {
  ok: true;
  universe: {
    ovr_total: number;
    ovr_pending: number;
    ovr_closed: number;
    intel_total: number;
    matches_total: number;
    matches_non_open: number;
  };
  invariants: {
    inv_b: { name: string; violations: number; substantive: boolean };
    inv_d: { name: string; violations: number; substantive: boolean };
    inv_g: { name: string; violations: number; substantive: boolean; sample_missing: string[] };
  };
};

type CleanupResult = {
  ok: true;
  deleted: { matches: number; intel: number; requests: number; audits: number };
};

async function callWalkthrough<T>(action: "seed" | "invariants" | "cleanup"): Promise<T> {
  const { data, error } = await supabase.functions.invoke("verification-walkthrough", {
    body: { action },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(`${data.error}${data.detail ? `: ${data.detail}` : ""}`);
  return data as T;
}

export function VerificationWalkthroughCard() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<null | "seed" | "invariants" | "cleanup">(null);
  const [seed, setSeed] = useState<SeedResult | null>(null);
  const [before, setBefore] = useState<InvariantResult | null>(null);
  const [after, setAfter] = useState<InvariantResult | null>(null);

  const handleSeed = async () => {
    setBusy("seed");
    try {
      // Snapshot invariants BEFORE seeding so the user can compare deltas.
      const snapshot = await callWalkthrough<InvariantResult>("invariants");
      setBefore(snapshot);
      setAfter(null);
      const result = await callWalkthrough<SeedResult>("seed");
      setSeed(result);
      queryClient.invalidateQueries({ queryKey: ["admin-verification-queue"] });
      toast.success(`Seeded request for "${result.subject_name}". Find it in the queue below and click Action.`);
    } catch (e: any) {
      toast.error(`Seed failed: ${e.message ?? "unknown error"}`);
    } finally {
      setBusy(null);
    }
  };

  const handleVerify = async () => {
    setBusy("invariants");
    try {
      const result = await callWalkthrough<InvariantResult>("invariants");
      setAfter(result);
      toast.success("Invariants re-run against live data.");
    } catch (e: any) {
      toast.error(`Verify failed: ${e.message ?? "unknown error"}`);
    } finally {
      setBusy(null);
    }
  };

  const handleCleanup = async () => {
    if (!confirm("Delete all walkthrough fixtures (matches, intel, OVRs, audit rows) you've created?")) return;
    setBusy("cleanup");
    try {
      const result = await callWalkthrough<CleanupResult>("cleanup");
      toast.success(
        `Removed ${result.deleted.matches} match(es), ${result.deleted.requests} request(s), ${result.deleted.intel} intel row(s), ${result.deleted.audits} audit row(s).`,
      );
      setSeed(null);
      setBefore(null);
      setAfter(null);
      queryClient.invalidateQueries({ queryKey: ["admin-verification-queue"] });
    } catch (e: any) {
      toast.error(`Cleanup failed: ${e.message ?? "unknown error"}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-sm border border-border bg-muted/20 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-medium flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5" />
            Walkthrough harness
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
            Seeds one synthetic, isolated verification request so cross-consistency
            invariants (INV-B / INV-D / INV-G) can be validated against a real
            completion event instead of an empty table. Safe - fixtures are
            tagged and removable in one click.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={handleSeed} disabled={!!busy}>
            {busy === "seed" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
            1. Seed
          </Button>
          <Button size="sm" variant="outline" onClick={handleVerify} disabled={!!busy}>
            {busy === "invariants" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            3. Re-run invariants
          </Button>
          <Button size="sm" variant="outline" onClick={handleCleanup} disabled={!!busy}>
            {busy === "cleanup" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
            4. Clean up
          </Button>
        </div>
      </div>

      {seed && (
        <div className="rounded-sm border border-dashed border-border bg-background p-3 text-xs space-y-1">
          <div className="font-medium text-sm">Step 2 - Action the request below</div>
          <div className="text-muted-foreground">
            Subject: <span className="font-mono">{seed.subject_name}</span>
          </div>
          <div className="text-muted-foreground">
            Find it in the queue table (filter “Open”), click <span className="font-medium">Action</span>,
            choose status <span className="font-medium">Completed</span>, pick any outcome, save. Then come
            back here and click <span className="font-medium">3. Re-run invariants</span>.
          </div>
        </div>
      )}

      {(before || after) && (
        <InvariantsTable before={before} after={after} />
      )}
    </div>
  );
}

function InvariantsTable({ before, after }: { before: InvariantResult | null; after: InvariantResult | null }) {
  const rows: Array<{
    key: "inv_b" | "inv_d" | "inv_g";
    label: string;
  }> = [
    { key: "inv_b", label: "INV-B  Pending OVR on non-open match" },
    { key: "inv_d", label: "INV-D  Intel on non-open match" },
    { key: "inv_g", label: "INV-G  Closed OVR missing audit row" },
  ];

  return (
    <div className="rounded-sm border border-border bg-background overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr className="text-left">
            <th className="px-3 py-2">Invariant</th>
            <th className="px-3 py-2">Before</th>
            <th className="px-3 py-2">After</th>
            <th className="px-3 py-2">Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const b = before?.invariants[r.key];
            const a = after?.invariants[r.key];
            return (
              <tr key={r.key} className="border-t border-border align-top">
                <td className="px-3 py-2 font-mono">{r.label}</td>
                <td className="px-3 py-2">{b ? <Cell violations={b.violations} substantive={b.substantive} /> : "-"}</td>
                <td className="px-3 py-2">{a ? <Cell violations={a.violations} substantive={a.substantive} /> : "-"}</td>
                <td className="px-3 py-2">
                  {a ? (
                    a.violations === 0 ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" /> Pass{a.substantive ? " (substantive)" : " (vacuous)"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <XCircle className="h-3 w-3" /> Fail
                      </span>
                    )
                  ) : (
                    <span className="text-muted-foreground">awaiting</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border text-muted-foreground">
            <td className="px-3 py-2" colSpan={4}>
              <div className="flex flex-wrap gap-3 text-[11px]">
                {after && (
                  <>
                    <span>OVR total: {after.universe.ovr_total}</span>
                    <span>Pending: {after.universe.ovr_pending}</span>
                    <span>Closed: {after.universe.ovr_closed}</span>
                    <span>Intel: {after.universe.intel_total}</span>
                    <span>Matches: {after.universe.matches_total}</span>
                    <span>Non-open matches: {after.universe.matches_non_open}</span>
                  </>
                )}
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Cell({ violations, substantive }: { violations: number; substantive: boolean }) {
  if (violations > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-destructive font-medium">
        <AlertCircle className="h-3 w-3" /> {violations}
      </span>
    );
  }
  return (
    <Badge variant={substantive ? "default" : "outline"} className="text-[10px]">
      0 {substantive ? "(real)" : "(vacuous)"}
    </Badge>
  );
}
