import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Save, AlertTriangle, Sparkles, PowerOff } from "lucide-react";
import type { Json } from "@/integrations/supabase/types";

interface BypassState {
  enabled: boolean;
  idv: boolean;
  sanctions: boolean;
  kyb: boolean;
  ubo: boolean;
  authority: boolean;
  risk_scoring: boolean;
  webhook_connectivity: boolean;
  screening_recentness: boolean;
  note: string;
  enabled_at: string | null;
  expires_at: string | null;
}

const DEFAULT_TTL_DAYS = 7;

const DEFAULT_STATE: BypassState = {
  enabled: false,
  idv: false,
  sanctions: false,
  kyb: false,
  ubo: false,
  authority: false,
  risk_scoring: false,
  webhook_connectivity: false,
  screening_recentness: false,
  note: "",
  enabled_at: null,
  expires_at: null,
};

function addDaysISO(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function formatCountdown(expiresAt: string | null): { label: string; expired: boolean } | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return { label: "expired — bypasses are inert until you renew", expired: true };
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const mins = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return { label: `${parts.join(" ")} remaining`, expired: false };
}

type GateGroup = "upstream" | "wad";

const GATES: { key: keyof Omit<BypassState, "enabled" | "note" | "enabled_at" | "expires_at">; label: string; description: string; group: GateGroup }[] = [
  // ── Upstream provider gates (skip the external compliance integrations) ──
  { key: "idv", label: "Identity verification (IDV)", description: "Skip Onfido / Companies House / CIPC. Entities auto-marked as verified.", group: "upstream" },
  { key: "sanctions", label: "Sanctions & PEP screening", description: "Skip Dilisense / Dow Jones / Refinitiv. Synthesises a 'clear' screening result.", group: "upstream" },
  { key: "kyb", label: "Business verification (KYB)", description: "Skip company registry checks. Covered by the IDV bypass for company-type entities.", group: "upstream" },
  { key: "ubo", label: "Beneficial ownership (UBO)", description: "Treat ownership as 100% verified across all chain depths.", group: "upstream" },
  { key: "authority", label: "Authority-to-bind (ATB)", description: "Treat the signing person as having a verified active authority record.", group: "upstream" },
  // ── WaD-internal gates (let the workflow reach the evidence pack step) ──
  { key: "screening_recentness", label: "Screening recentness (WaD)", description: "Skip the 30-day staleness check on screening_results inside the WaD function. Use when a test session outlives its initial screening.", group: "wad" },
  { key: "risk_scoring", label: "Risk scoring (WaD)", description: "Allow WaD issuance even when a party's dd_risk_scores band is 'high' or 'critical'. The risk record is still kept; just not enforced.", group: "wad" },
  { key: "webhook_connectivity", label: "Webhook connectivity / Gate 10 (WaD)", description: "Allow WaD issuance when a party's primary webhook endpoint is tripped (status='inactive'). Real settlement should NOT proceed without working webhooks.", group: "wad" },
];

export function TestModeBypassPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<BypassState>(DEFAULT_STATE);
  const [productionLocked, setProductionLocked] = useState(false);
  const [tier, setTier] = useState<string>("sandbox");

  useEffect(() => {
    (async () => {
      try {
        const [{ data, error }, lockoutRes] = await Promise.all([
          supabase
            .from("admin_settings")
            .select("value")
            .eq("key", "test_mode_bypass")
            .maybeSingle(),
          supabase.rpc("get_test_mode_lockout_state"),
        ]);
        if (error) throw error;
        if (data?.value) {
          setState({ ...DEFAULT_STATE, ...(data.value as unknown as BypassState) });
        }
        const lockout = (lockoutRes.data ?? {}) as Record<string, unknown>;
        setProductionLocked(lockout.production_locked === true);
        setTier(typeof lockout.tier === "string" ? lockout.tier : "sandbox");
      } catch (err) {
        console.error(err);
        toast.error("Failed to load test-mode settings");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("admin_settings")
        .upsert(
          { key: "test_mode_bypass", value: state as unknown as Json, updated_by: user?.id },
          { onConflict: "key" },
        );
      if (error) throw error;
      toast.success("Test-mode settings saved");
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Failed to save";
      if (/AAL2_REQUIRED/.test(msg)) {
        toast.error(
          "MFA required: changing test-mode bypass needs a fresh authenticator challenge. Re-authenticate and retry.",
        );
      } else {
        toast.error(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const anyGateOn = GATES.some((g) => state[g.key]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div>
            <CardTitle>
              Test-mode compliance bypass{" "}
              <span className="text-xs font-normal text-muted-foreground">(sandbox / test only)</span>
            </CardTitle>
            <CardDescription className="mt-1">
              Temporarily skip compliance gates so the rest of the platform can be tested while
              real integrations are still being wired. Two layers: <strong>upstream provider gates</strong>
              (IDV / sanctions / KYB / UBO / ATB) and <strong>WaD-internal gates</strong> (screening
              recentness / risk scoring / webhook connectivity). All bypass usage is written to the
              admin audit log, every WaD issued under bypass is permanently stamped, and a global
              TEST MODE banner is shown to every user while any flag is active.
              <br />
              <strong className="text-foreground">Test-mode bypass is not a production override.</strong>{" "}
              In production, every flag below is ignored at both the database and edge layers.
              Production overrides must use the future break-glass / second-approval workflow.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {productionLocked && (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 text-destructive p-4 space-y-1"
            data-testid="test-mode-production-lockout-banner"
          >
            <div className="flex items-center gap-2 font-semibold text-sm">
              <AlertTriangle className="h-4 w-4" />
              Production lockout active — every control below is inert
            </div>
            <p className="text-xs opacity-90">
              This deployment's environment tier is <code className="font-mono">{tier}</code>.
              The master switch, "Enable all for demo" preset, and per-gate toggles are disabled
              here, and <code className="font-mono">is_test_mode_bypass_enabled()</code> at the
              database layer returns <code className="font-mono">false</code> for every gate
              regardless of what's saved. To override a compliance gate in production, use the
              break-glass / second-approval workflow (Stage 3 plan) — not test-mode bypass.
            </p>
          </div>
        )}
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-sm font-semibold">Master switch</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Off by default. When off, all per-gate flags below are ignored.
                Enabling auto-stamps a {DEFAULT_TTL_DAYS}-day expiry — bypasses self-disable on that date.
              </p>
            </div>
            <Switch
              checked={state.enabled}
              disabled={productionLocked}
              onCheckedChange={(checked) => {
                if (checked) {
                  setState({
                    ...state,
                    enabled: true,
                    enabled_at: state.enabled_at ?? new Date().toISOString(),
                    expires_at: state.expires_at ?? addDaysISO(DEFAULT_TTL_DAYS),
                  });
                } else {
                  setState({ ...state, enabled: false });
                }
              }}
            />
          </div>
          {state.enabled && (() => {
            const cd = formatCountdown(state.expires_at);
            if (!cd) return null;
            return (
              <div className={`flex items-center justify-between gap-3 rounded-sm px-3 py-2 text-xs ${cd.expired ? "bg-destructive/10 text-destructive" : "bg-background/60 text-muted-foreground"}`}>
                <div>
                  <strong>Auto-expiry:</strong> {cd.label}
                  {state.expires_at && (
                    <span className="ml-1 opacity-70">
                      (expires {new Date(state.expires_at).toUTCString()})
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setState({ ...state, expires_at: addDaysISO(DEFAULT_TTL_DAYS) })}
                >
                  Renew {DEFAULT_TTL_DAYS}d
                </Button>
              </div>
            );
          })()}

          {/* Demo preset controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-dashed border-amber-500/40 bg-background/40 px-3 py-2">
            <div className="text-xs text-muted-foreground">
              <strong className="text-foreground">One-click demo preset:</strong> enables the master switch
              and every upstream + WaD gate so a client can run signup → POI → WaD end-to-end without friction.
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="default"
                disabled={productionLocked}
                onClick={() => {
                  const allOn = GATES.reduce((acc, g) => ({ ...acc, [g.key]: true }), {} as Partial<BypassState>);
                  setState({
                    ...state,
                    ...allOn,
                    enabled: true,
                    enabled_at: state.enabled_at ?? new Date().toISOString(),
                    expires_at: addDaysISO(DEFAULT_TTL_DAYS),
                    note: state.note?.trim() ? state.note : "Demo preset — full bypass for client walkthrough",
                  });
                }}
              >
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                Enable all for demo
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={productionLocked}
                onClick={() => {
                  const allOff = GATES.reduce((acc, g) => ({ ...acc, [g.key]: false }), {} as Partial<BypassState>);
                  setState({ ...state, ...allOff, enabled: false });
                }}
              >
                <PowerOff className="h-3.5 w-3.5 mr-1.5" />
                Disable all
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <h4 className="text-sm font-semibold mb-3">Upstream provider gates</h4>
            <p className="text-xs text-muted-foreground mb-3">
              Skip the external compliance integrations (IDV, sanctions, KYB, UBO, ATB) that aren't wired in yet.
            </p>
            <div className="space-y-4">
              {GATES.filter((g) => g.group === "upstream").map((gate) => (
                <div key={gate.key} className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Label className="text-sm">{gate.label}</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">{gate.description}</p>
                  </div>
                  <Switch
                    checked={state[gate.key]}
                    disabled={!state.enabled || productionLocked}
                    onCheckedChange={(checked) => setState({ ...state, [gate.key]: checked })}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="border-t pt-6">
            <h4 className="text-sm font-semibold mb-3">WaD-internal gates</h4>
            <p className="text-xs text-muted-foreground mb-3">
              The WaD function runs four hard-gates of its own that are <em>not</em> covered by the upstream
              bypasses above. Enable these to let the workflow reach the evidence pack step.
              Every WaD issued under any of these flags is permanently stamped <strong>"TEST MODE — demo
              grade only"</strong> on its certificate and in its evidence bundle hash.
            </p>
            <div className="space-y-4">
              {GATES.filter((g) => g.group === "wad").map((gate) => (
                <div key={gate.key} className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Label className="text-sm">{gate.label}</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">{gate.description}</p>
                  </div>
                  <Switch
                    checked={state[gate.key]}
                    disabled={!state.enabled || productionLocked}
                    onCheckedChange={(checked) => setState({ ...state, [gate.key]: checked })}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bypass-note">Reason / ticket reference (audit trail)</Label>
          <Textarea
            id="bypass-note"
            placeholder="e.g. INTEG-204 — testing evidence pack rendering before Onfido is live"
            value={state.note}
            onChange={(e) => setState({ ...state, note: e.target.value })}
            rows={2}
          />
        </div>

        {state.enabled && anyGateOn && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1">
            <div><strong>Active:</strong> {GATES.filter((g) => state[g.key]).map((g) => g.label).join(", ")}.</div>
            <div>Disable as soon as the corresponding integration is live. Production-tier deployments ignore these flags entirely.</div>
          </div>
        )}

        <Button onClick={save} disabled={saving || productionLocked}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          {productionLocked ? "Saving disabled in production" : "Save test-mode settings"}
        </Button>
      </CardContent>
    </Card>
  );
}
