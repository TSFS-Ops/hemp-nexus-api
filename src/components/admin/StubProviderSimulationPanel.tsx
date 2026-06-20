/**
 * P010 — Stub Provider Simulation Panel (admin/developer diagnostic surface).
 *
 * Admin-only card surfaced inside Admin Settings, next to the Test Mode
 * bypass panel. Lets platform_admin / developer users record an audit-only
 * "simulate in Test Mode" event against one of the four stub providers.
 *
 * Strictly:
 *   - The card is gated by an admin route — the rest of Admin Settings is
 *     already locked down by `is_admin()` policies, so this panel inherits
 *     that protection. The simulate button additionally calls the
 *     `provider-stub-simulate` edge function which re-validates role
 *     server-side.
 *   - When Test Mode is OFF, every button is disabled with the agreed
 *     tooltip wording.
 *   - The result row NEVER renders "verified / cleared / passed / approved /
 *     screened / complete" — the envelope only contains
 *     `status: "test_mode_bypass"` or `status: "stub_not_live"`.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, AlertTriangle, FlaskConical } from "lucide-react";
import {
  STUB_PROVIDERS,
  STUB_PROVIDER_LABEL_SHORT,
  STUB_PROVIDER_LABEL_LONG,
  STUB_PROVIDER_STATUS,
  type StubProviderEntry,
} from "@/lib/stub-providers";

interface SimResult {
  provider: string;
  status: string;
  message: string;
  external_provider_called?: boolean;
  test_mode_active?: boolean;
  at: string;
}

export function StubProviderSimulationPanel() {
  const [testModeActive, setTestModeActive] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, SimResult>>({});

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from("admin_settings")
          .select("value")
          .eq("key", "test_mode_bypass")
          .maybeSingle();
        const v = (data?.value ?? {}) as Record<string, unknown>;
        setTestModeActive(v.enabled === true);
      } catch {
        setTestModeActive(false);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function simulate(p: StubProviderEntry) {
    setPendingKey(p.key);
    try {
      const { data, error } = await supabase.functions.invoke("provider-stub-simulate", {
        body: { provider: p.key },
      });
      if (error) throw error;
      const r = (data ?? {}) as Record<string, unknown>;
      setResults((prev) => ({
        ...prev,
        [p.key]: {
          provider: p.key,
          status: String(r.status ?? STUB_PROVIDER_STATUS.STUB_NOT_LIVE),
          message: String(r.message ?? STUB_PROVIDER_LABEL_LONG),
          external_provider_called: r.external_provider_called === true,
          test_mode_active: r.test_mode_active === true,
          at: new Date().toISOString(),
        },
      }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setResults((prev) => ({
        ...prev,
        [p.key]: {
          provider: p.key,
          status: "error",
          message: msg,
          at: new Date().toISOString(),
        },
      }));
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4" />
          Stub provider simulation
          <Badge variant="outline" className="ml-2">
            Internal / diagnostic
          </Badge>
        </CardTitle>
        <CardDescription className="space-y-1">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>{STUB_PROVIDER_LABEL_SHORT}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {STUB_PROVIDER_LABEL_LONG}
          </div>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading Test Mode state…
          </div>
        ) : (
          <TooltipProvider>
            <div className="space-y-3">
              {STUB_PROVIDERS.map((p) => {
                const res = results[p.key];
                const disabled = !testModeActive || pendingKey !== null;
                return (
                  <div
                    key={p.key}
                    className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span>{p.category} provider — not live</span>
                        <Badge variant="secondary" className="font-mono text-xs">
                          internal id: {p.key}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {STUB_PROVIDER_LABEL_SHORT}
                      </div>
                      {res && (
                        <div className="text-xs">
                          <span className="font-mono">status:</span>{" "}
                          <span className="font-mono">{res.status}</span>
                          {" · "}
                          <span className="font-mono">external_provider_called:</span>{" "}
                          <span className="font-mono">
                            {String(res.external_provider_called ?? false)}
                          </span>
                          <div className="text-muted-foreground">{res.message}</div>
                        </div>
                      )}
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={disabled}
                            onClick={() => simulate(p)}
                          >
                            {pendingKey === p.key ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : null}
                            Simulate in Test Mode
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {!testModeActive && (
                        <TooltipContent>
                          Enable Test Mode to run a non-live simulation. No external provider check is performed.
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </div>
                );
              })}
              {!testModeActive && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                  Test Mode is currently OFF. Simulation is disabled and any direct call to{" "}
                  <code className="font-mono">provider-stub-simulate</code> will be blocked
                  server-side with an audit-only{" "}
                  <code className="font-mono">stub_provider.blocked</code> event.
                </div>
              )}
            </div>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}
