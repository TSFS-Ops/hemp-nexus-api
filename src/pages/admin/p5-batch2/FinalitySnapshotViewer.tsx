/**
 * FinalitySnapshotViewer — P-5 Batch 2 Stage 4
 *
 * Read-only view of one immutable evidence-pack snapshot. Pack items are
 * append-only and snapshot-based. Raw files are not exposed.
 */
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useP5Batch2Permissions } from "@/hooks/useP5Batch2Permissions";

type Pack = {
  id: string;
  pack_status: string;
  pack_reason: string;
  hash_chain_reference: string | null;
  sealed_at: string;
  sealed_by: string | null;
};

type PackItem = {
  id: string;
  evidence_item_id: string;
  version_id: string;
  snapshot_status: string;
  snapshot_rating: string | null;
  snapshot_file_hash: string;
  snapshot_at: string;
};

export default function FinalitySnapshotViewer() {
  const { packId } = useParams<{ packId: string }>();
  const perms = useP5Batch2Permissions();
  const [pack, setPack] = useState<Pack | null>(null);
  const [items, setItems] = useState<PackItem[]>([]);

  useEffect(() => {
    if (!packId || !perms.canViewFinalitySnapshot) return;
    let cancelled = false;
    (async () => {
      const [{ data: p }, { data: it }] = await Promise.all([
        supabase.from("p5_batch2_evidence_packs")
          .select("id, pack_status, pack_reason, hash_chain_reference, sealed_at, sealed_by")
          .eq("id", packId).maybeSingle(),
        supabase.from("p5_batch2_evidence_pack_items")
          .select("id, evidence_item_id, version_id, snapshot_status, snapshot_rating, snapshot_file_hash, snapshot_at")
          .eq("pack_id", packId)
          .order("snapshot_at", { ascending: true }),
      ]);
      if (cancelled) return;
      setPack(p as Pack | null);
      setItems((it ?? []) as PackItem[]);
    })();
    return () => { cancelled = true; };
  }, [packId, perms.canViewFinalitySnapshot]);

  if (!perms.canViewFinalitySnapshot) {
    return <div className="p-6">Access denied.</div>;
  }

  return (
    <div className="p-6 space-y-4" data-testid="p5b2-finality-snapshot">
      <Button asChild size="sm" variant="ghost">
        <Link to="/admin/p5-batch2/packs">← All packs</Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Snapshot {pack?.id.slice(0, 8) ?? "…"}
            <Badge variant="outline">{pack?.pack_status ?? "—"}</Badge>
            <Badge>Append-only</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Reason: {pack?.pack_reason ?? "—"}</p>
          <p>Sealed at: {pack?.sealed_at ? new Date(pack.sealed_at).toISOString() : "—"}</p>
          <p>Sealed by: {pack?.sealed_by ?? "—"}</p>
          <p className="font-mono text-xs">Hash chain ref: {pack?.hash_chain_reference ?? "—"}</p>
          <p className="text-xs text-muted-foreground">
            This snapshot is immutable. Items cannot be edited or removed; new packs supersede old ones.
            Raw files are not exposed by default.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Snapshot items ({items.length})</CardTitle></CardHeader>
        <CardContent>
          {items.length === 0 ? <p className="text-muted-foreground">No items.</p> : (
            <ul className="divide-y text-xs">
              {items.map((i) => (
                <li key={i.id} className="py-2 space-y-0.5">
                  <p>
                    Evidence {i.evidence_item_id.slice(0, 8)} · version {i.version_id.slice(0, 8)} ·{" "}
                    <Badge variant="outline">{i.snapshot_status}</Badge>{" "}
                    {i.snapshot_rating && <Badge>{i.snapshot_rating}</Badge>}
                  </p>
                  <p className="font-mono text-muted-foreground">
                    sha256: {i.snapshot_file_hash.slice(0, 16)}… · snapshot_at {new Date(i.snapshot_at).toISOString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
