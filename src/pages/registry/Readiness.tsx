/**
 * Batch 6 — M017 Client-safe readiness dashboard.
 *
 * Replaces the Batch 1 placeholder. Reads from the
 * registry-client-readiness-summary edge function. Never overclaims.
 *
 * SSOT-derived bucket copy lives in src/lib/registry-outreach.ts.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import {
  REGISTRY_CLIENT_READINESS_BUCKETS,
  REGISTRY_CLIENT_READINESS_COPY,
  REGISTRY_CLIENT_READINESS_HEADLINE,
  type RegistryClientReadinessBucket,
} from "@/lib/registry-outreach";

interface Module {
  code: string;
  name: string;
  bucket: RegistryClientReadinessBucket;
  what_exists: string;
  what_is_missing: string;
}

const TONE: Record<RegistryClientReadinessBucket, string> = {
  production_ready: "border-primary/40 bg-primary/5",
  client_demo_ready: "border-amber-500/40 bg-amber-500/5",
  shell_ready: "border-border bg-muted/30",
  test_data_ready: "border-border bg-muted/30",
  seed_only: "border-border bg-muted/30",
  sample_only: "border-border bg-muted/30",
  provider_pending: "border-amber-500/40 bg-amber-500/5",
  data_pending: "border-border bg-muted/30",
  licence_pending: "border-border bg-muted/30",
  business_decision_required: "border-amber-500/40 bg-amber-500/5",
  disabled: "border-destructive/40 bg-destructive/5",
};

export default function RegistryReadiness() {
  const [modules, setModules] = useState<Module[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("registry-client-readiness-summary", { body: {} });
        if (error) throw error;
        if (!cancelled) setModules((data?.modules ?? []) as Module[]);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load readiness");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const grouped = new Map<RegistryClientReadinessBucket, Module[]>();
  for (const b of REGISTRY_CLIENT_READINESS_BUCKETS) grouped.set(b, []);
  for (const m of modules ?? []) grouped.get(m.bucket)?.push(m);

  return (
    <main className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-2">Module readiness</h1>
      <p className="text-sm text-muted-foreground mb-4">
        A plain-English view of what each registry module actually does today.
        This page does not show any real registry records and does not present anything as more ready than it is.
      </p>

      {error && (
        <Card className="mb-4 border-destructive/50">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {modules === null && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

      {REGISTRY_CLIENT_READINESS_BUCKETS.map((bucket) => {
        const items = grouped.get(bucket) ?? [];
        if (items.length === 0) return null;
        return (
          <section key={bucket} className={`mb-6 border rounded-md p-4 ${TONE[bucket]}`} data-testid={`readiness-bucket-${bucket}`}>
            <h2 className="text-lg font-semibold mb-1">{REGISTRY_CLIENT_READINESS_HEADLINE[bucket]}</h2>
            <p className="text-sm text-muted-foreground mb-3">{REGISTRY_CLIENT_READINESS_COPY[bucket]}</p>
            <ul className="space-y-2">
              {items.map((m) => (
                <li key={m.code} className="border-t border-border pt-2">
                  <p className="text-sm font-medium">{m.code} — {m.name}</p>
                  <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">What exists: </span>{m.what_exists}</p>
                  <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">What is missing: </span>{m.what_is_missing}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
