import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Save, AlertTriangle } from "lucide-react";
import type { Json } from "@/integrations/supabase/types";

interface BypassState {
  enabled: boolean;
  idv: boolean;
  sanctions: boolean;
  kyb: boolean;
  ubo: boolean;
  authority: boolean;
  note: string;
}

const DEFAULT_STATE: BypassState = {
  enabled: false,
  idv: false,
  sanctions: false,
  kyb: false,
  ubo: false,
  authority: false,
  note: "",
};

const GATES: { key: keyof Omit<BypassState, "enabled" | "note">; label: string; description: string }[] = [
  { key: "idv", label: "Identity verification (IDV)", description: "Skip Onfido / Companies House / CIPC. Entities auto-marked as verified." },
  { key: "sanctions", label: "Sanctions & PEP screening", description: "Skip Dilisense / Dow Jones / Refinitiv. Returns clear with no hits." },
  { key: "kyb", label: "Business verification (KYB)", description: "Skip company registry checks. Covered by the IDV bypass for company-type entities." },
  { key: "ubo", label: "Beneficial ownership (UBO)", description: "Treat ownership as 100% verified across all chain depths." },
  { key: "authority", label: "Authority-to-bind (ATB)", description: "Treat the signing person as having a verified active authority record." },
];

export function TestModeBypassPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<BypassState>(DEFAULT_STATE);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("admin_settings")
          .select("value")
          .eq("key", "test_mode_bypass")
          .maybeSingle();
        if (error) throw error;
        if (data?.value) {
          setState({ ...DEFAULT_STATE, ...(data.value as unknown as BypassState) });
        }
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
      toast.error(err instanceof Error ? err.message : "Failed to save");
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
            <CardTitle>Test-mode compliance bypass</CardTitle>
            <CardDescription className="mt-1">
              Temporarily skip external compliance providers (IDV, sanctions, KYB, UBO, ATB) so the
              rest of the platform can be tested while real integrations are still being wired.
              All bypass usage is written to the admin audit log and a global TEST MODE banner is
              shown to every user while any flag is active.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 flex items-center justify-between">
          <div>
            <Label className="text-sm font-semibold">Master switch</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Off by default. When off, all per-gate flags below are ignored.
            </p>
          </div>
          <Switch
            checked={state.enabled}
            onCheckedChange={(checked) => setState({ ...state, enabled: checked })}
          />
        </div>

        <div className="space-y-4">
          {GATES.map((gate) => (
            <div key={gate.key} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label className="text-sm">{gate.label}</Label>
                <p className="text-xs text-muted-foreground mt-0.5">{gate.description}</p>
              </div>
              <Switch
                checked={state[gate.key]}
                disabled={!state.enabled}
                onCheckedChange={(checked) => setState({ ...state, [gate.key]: checked })}
              />
            </div>
          ))}
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
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
            <strong>Active:</strong> {GATES.filter((g) => state[g.key]).map((g) => g.label).join(", ")}.
            Disable as soon as the corresponding integration is live.
          </div>
        )}

        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save test-mode settings
        </Button>
      </CardContent>
    </Card>
  );
}
