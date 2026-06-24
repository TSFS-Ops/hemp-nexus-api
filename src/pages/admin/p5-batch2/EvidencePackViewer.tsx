/**
 * EvidencePackViewer — P-5 Batch 2 Stage 4
 *
 * Admin/operator listing of all evidence packs. Read-only. Raw files are
 * never rendered. Each pack opens the FinalitySnapshotViewer.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useP5Batch2Permissions } from "@/hooks/useP5Batch2Permissions";

type Pack = {
  id: string;
  pack_status: string;
  pack_reason: string;
  organization_id: string | null;
  counterparty_id: string | null;
  match_id: string | null;
  trade_request_id: string | null;
  hash_chain_reference: string | null;
  sealed_at: string;
};

export default function EvidencePackViewer() {
  const perms = useP5Batch2Permissions();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!perms.canViewEvidencePack) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("p5_batch2_evidence_packs")
        .select("id, pack_status, pack_reason, organization_id, counterparty_id, match_id, trade_request_id, hash_chain_reference, sealed_at")
        .order("sealed_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      setPacks((data ?? []) as Pack[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [perms.canViewEvidencePack]);

  if (!perms.canViewEvidencePack) {
    return <div className="p-6">Access denied.</div>;
  }

  return (
    <div className="p-6 space-y-4" data-testid="p5b2-evidence-pack-viewer">
      <h1 className="text-2xl font-semibold">Evidence packs</h1>
      <Card>
        <CardHeader><CardTitle>Sealed packs</CardTitle></CardHeader>
        <CardContent>
          {loading ? <p>Loading…</p> : packs.length === 0 ? (
            <p className="text-muted-foreground">No packs yet.</p>
          ) : (
            <ul className="divide-y">
              {packs.map((p) => (
                <li key={p.id} className="py-2 flex items-center justify-between">
                  <div className="text-sm">
                    <p className="font-medium">Pack {p.id.slice(0, 8)} · {p.pack_reason}</p>
                    <p className="text-xs text-muted-foreground">
                      Sealed {new Date(p.sealed_at).toLocaleString()} ·{" "}
                      <Badge variant="outline">{p.pack_status}</Badge>{" · "}
                      hash: <span className="font-mono">{p.hash_chain_reference?.slice(0, 12) ?? "—"}…</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      org={p.organization_id?.slice(0, 8) ?? "—"} ·
                      cp={p.counterparty_id?.slice(0, 8) ?? "—"} ·
                      match={p.match_id?.slice(0, 8) ?? "—"} ·
                      tr={p.trade_request_id?.slice(0, 8) ?? "—"}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/admin/p5-batch2/packs/${p.id}`}>Open snapshot</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="pt-3 text-xs text-muted-foreground">
            Pack items are append-only snapshots. Raw files are not exposed by default.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
