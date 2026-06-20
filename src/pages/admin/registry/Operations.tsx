/**
 * Batch 6 — M015 Operations dashboard.
 * Read-only summary of all registry admin queues + warnings. Renders the
 * mandatory no-auto-send banner so reviewers always see it on entry.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { REGISTRY_OUTREACH_NO_AUTO_SEND_COPY } from "@/lib/registry-outreach";

interface Section {
  code: string;
  label: string;
  count: number;
  warn: boolean;
  href: string;
  note?: string;
}

export default function AdminRegistryOperations() {
  const [sections, setSections] = useState<Section[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("registry-admin-operations-summary", { body: {} });
        if (error) throw error;
        if (!cancelled) setSections((data?.sections ?? []) as Section[]);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load operations summary");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-2">Registry operations</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Cross-module operational view. Every count links to the corresponding admin tab.
      </p>

      <div className="border border-border bg-muted/40 rounded-md p-3 mb-4 text-sm">
        <strong className="font-medium">Outreach control: </strong>
        {REGISTRY_OUTREACH_NO_AUTO_SEND_COPY}
      </div>

      {error && (
        <Card className="mb-4 border-destructive/50">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {(sections ?? []).map((s) => (
          <Card key={s.code} className={s.warn ? "border-amber-500/40" : undefined}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>{s.label}</span>
                <span data-testid={`ops-count-${s.code}`} className="font-mono text-base">{s.count}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-xs">
              {s.note && <p className="text-muted-foreground mb-2">{s.note}</p>}
              <Link to={s.href} className="text-primary hover:underline" data-testid={`ops-link-${s.code}`}>
                Open →
              </Link>
            </CardContent>
          </Card>
        ))}
        {sections === null && !error && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </div>
    </main>
  );
}
