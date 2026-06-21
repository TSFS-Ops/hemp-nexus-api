/**
 * Batch 17 — Registry Admin Operations Centre (cockpit).
 * Tiles + links to specialist pages. No raw bank, no full keys, no provider payloads.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  REGISTRY_OPS_TILE_LABEL,
  REGISTRY_OPS_EMPTY_COPY,
  REGISTRY_OPS_SEVERITY_LABEL,
  REGISTRY_OPS_SEVERITY_TONE,
  type RegistryOpsTileCode,
  type RegistryOpsSeverity,
} from "@/lib/registry-operations-centre-ssot";

interface Tile {
  code: RegistryOpsTileCode;
  count: number;
  severity: RegistryOpsSeverity;
  oldest_age_hours: number | null;
  href: string;
}

const tabClass = (active: boolean) =>
  `px-3 py-2 text-sm border-b-2 ${active ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`;

function severityVariant(s: RegistryOpsSeverity) {
  const tone = REGISTRY_OPS_SEVERITY_TONE[s];
  if (tone === "danger") return "destructive" as const;
  if (tone === "warn") return "secondary" as const;
  return "outline" as const;
}

export default function AdminRegistryOperationsCentre() {
  const [tiles, setTiles] = useState<Tile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("registry-operations-summary", { body: {} });
        if (error) throw error;
        if (!cancelled) setTiles((data?.tiles ?? []) as Tile[]);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load operations summary");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-1">Registry operations centre</h1>
      <p className="text-sm text-muted-foreground mb-4">
        One controlled cockpit for imports, claims, authority, bank details, verification, API and risk.
        Tiles never display raw bank details, full API keys or provider payloads.
      </p>

      <div className="flex gap-2 border-b border-border mb-4 flex-wrap">
        <Link to="/admin/registry/operations" className={tabClass(true)}>Centre</Link>
        <Link to="/admin/registry/operations/queue" className={tabClass(false)}>Unified queue</Link>
        <Link to="/admin/registry/operations/slas" className={tabClass(false)}>SLAs</Link>
        <Link to="/admin/registry/operations/risk" className={tabClass(false)}>Risk</Link>
        <Link to="/admin/registry/operations/readiness" className={tabClass(false)}>Readiness blockers</Link>
        <Link to="/admin/registry/operations/audit" className={tabClass(false)}>Audit activity</Link>
      </div>

      {error && (
        <Card className="mb-4 border-destructive/50">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="ops-tiles">
        {(tiles ?? []).map((t) => (
          <Card key={t.code} data-testid={`ops-tile-${t.code}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between gap-2">
                <span>{REGISTRY_OPS_TILE_LABEL[t.code] ?? t.code}</span>
                <span className="font-mono text-base" data-testid={`ops-tile-count-${t.code}`}>{t.count}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-xs space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant={severityVariant(t.severity)} data-testid={`ops-tile-severity-${t.code}`}>
                  {REGISTRY_OPS_SEVERITY_LABEL[t.severity]}
                </Badge>
                <span className="text-muted-foreground" data-testid={`ops-tile-oldest-${t.code}`}>
                  {t.oldest_age_hours == null ? "No active items" : `Oldest: ${t.oldest_age_hours}h`}
                </span>
              </div>
              <Link to={t.href} className="text-primary hover:underline">Open →</Link>
            </CardContent>
          </Card>
        ))}
        {tiles !== null && tiles.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">{REGISTRY_OPS_EMPTY_COPY.queue}</p>
        )}
        {tiles === null && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      </div>
    </main>
  );
}
