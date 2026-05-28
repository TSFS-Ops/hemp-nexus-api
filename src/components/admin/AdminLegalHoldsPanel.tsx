/**
 * DATA-003 Phase 1 — HQ Legal Holds admin panel.
 *
 * Platform-admin only. Lists active + released legal holds and lets the
 * admin apply and release holds via the `admin-legal-hold` edge function.
 *
 * Wording is the signed Phase 1 copy:
 *   apply success →  "Legal hold applied — deletion/anonymisation suspended for this scope."
 *   block        →  "Deletion/anonymisation is blocked because an active legal hold exists for this scope."
 *   release success → "Legal hold released — deletion/anonymisation may resume where otherwise permitted."
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, ShieldAlert, ShieldCheck, AlertCircle } from "lucide-react";
import { parseEdgeError } from "@/lib/edge-error";

const SCOPE_TYPES = [
  "user", "org", "match", "engagement", "poi",
  "wad", "dispute", "payment", "evidence", "record_group",
] as const;
type ScopeType = typeof SCOPE_TYPES[number];

interface LegalHold {
  id: string;
  scope_type: ScopeType;
  scope_id: string;
  reason: string;
  status: "active" | "released";
  applied_by: string | null;
  applied_at: string;
  released_by: string | null;
  released_at: string | null;
  released_reason: string | null;
  metadata: Record<string, unknown> | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function HoldActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge variant="destructive" className="gap-1">
      <ShieldAlert className="h-3 w-3" /> Legal hold active
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <ShieldCheck className="h-3 w-3" /> No hold
    </Badge>
  );
}

export function AdminLegalHoldsPanel() {
  const { toast } = useToast();
  const [active, setActive] = useState<LegalHold[]>([]);
  const [released, setReleased] = useState<LegalHold[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<{ title: string; message: string } | null>(null);
  // Preflight AAL state — drives the persistent inline MFA banner so that
  // an aal1 caller sees a clear "MFA required" message BEFORE clicking
  // Apply hold (DANIEL_RETEST gate A).
  const [aalState, setAalState] = useState<"loading" | "aal1" | "aal2" | "unknown">("loading");


  // Apply form
  const [scopeType, setScopeType] = useState<ScopeType>("user");
  const [scopeId, setScopeId] = useState("");
  const [reason, setReason] = useState("");

  // Release form (per row)
  const [releaseReasons, setReleaseReasons] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [a, r] = await Promise.all([
        supabase.functions.invoke("admin-legal-hold", {
          body: { action: "list", status: "active", limit: 200 },
        }),
        supabase.functions.invoke("admin-legal-hold", {
          body: { action: "list", status: "released", limit: 100 },
        }),
      ]);
      if (a.error) throw a.error;
      if (r.error) throw r.error;
      setActive((a.data?.holds ?? []) as LegalHold[]);
      setReleased((r.data?.holds ?? []) as LegalHold[]);
    } catch (e) {
      toast({
        title: "Could not load legal holds",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { refresh(); }, [refresh]);

  // Detect current session AAL so we can render a persistent MFA banner.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (cancelled) return;
        if (error) {
          setAalState("unknown");
          return;
        }
        const current = data?.currentLevel;
        setAalState(current === "aal2" ? "aal2" : current === "aal1" ? "aal1" : "unknown");
      } catch {
        if (!cancelled) setAalState("unknown");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Server requires AAL2 for BOTH apply and release (see
  // supabase/functions/admin-legal-hold/index.ts — assertAal2 around L174-186,
  // applied to both `apply` and `release`; `list` is read-only). We therefore
  // gate both destructive actions in the UI when the preflight reports
  // anything other than aal2. We distinguish:
  //   • aal1     → user definitely needs to verify MFA (banner is firm).
  //   • unknown  → preflight failed transiently; show a cautious "could not
  //                confirm" state and still block destructive actions
  //                client-side rather than surface a misleading enabled
  //                button that would only fail server-side.
  const needsMfa = aalState === "aal1" || aalState === "unknown";
  const mfaUnknown = aalState === "unknown";
  const mfaLoading = aalState === "loading";

  const applyDisabled = useMemo(() => {
    return (
      applying ||
      needsMfa ||
      mfaLoading ||
      !UUID_RE.test(scopeId.trim()) ||
      reason.trim().length < 10
    );
  }, [applying, needsMfa, mfaLoading, scopeId, reason]);

  const handleApply = async () => {
    setApplying(true);
    setApplyError(null);
    try {
      const { data, error } = await supabase.functions.invoke("admin-legal-hold", {
        body: {
          action: "apply",
          scope_type: scopeType,
          scope_id: scopeId.trim(),
          reason: reason.trim(),
        },
      });
      if (error) {
        const parsed = await parseEdgeError(error);
        const title =
          parsed.code === "MFA_REQUIRED"
            ? "Multi-factor authentication required"
            : parsed.code === "NOT_PLATFORM_ADMIN" || parsed.status === 403
              ? "Not authorised"
              : "Apply failed";
        setApplyError({ title, message: parsed.message });
        toast({ title, description: parsed.message, variant: "destructive" });
        return;
      }
      if (data?.ok === false) {
        const msg = data?.message ?? "Unknown error";
        setApplyError({ title: "Could not apply hold", message: msg });
        toast({ title: "Could not apply hold", description: msg, variant: "destructive" });
      } else {
        toast({
          title: "Legal hold applied",
          description: "Legal hold applied — deletion/anonymisation suspended for this scope.",
        });
        setScopeId("");
        setReason("");
        refresh();
      }
    } catch (e) {
      const parsed = await parseEdgeError(e);
      setApplyError({ title: "Apply failed", message: parsed.message });
      toast({ title: "Apply failed", description: parsed.message, variant: "destructive" });
    } finally {
      setApplying(false);
    }
  };

  const handleRelease = async (hold: LegalHold) => {
    const rr = (releaseReasons[hold.id] ?? "").trim();
    if (rr.length < 10) {
      toast({
        title: "Release reason required",
        description: "Provide at least 10 characters explaining why this hold is being released.",
        variant: "destructive",
      });
      return;
    }
    setReleasingId(hold.id);
    try {
      const { data, error } = await supabase.functions.invoke("admin-legal-hold", {
        body: {
          action: "release",
          legal_hold_id: hold.id,
          released_reason: rr,
        },
      });
      if (error) throw error;
      if (data?.ok === false) {
        toast({
          title: "Could not release hold",
          description: data?.message ?? "Unknown error",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Legal hold released",
          description: "Legal hold released — deletion/anonymisation may resume where otherwise permitted.",
        });
        setReleaseReasons((s) => ({ ...s, [hold.id]: "" }));
        refresh();
      }
    } catch (e) {
      toast({
        title: "Release failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setReleasingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Persistent MFA preflight banner — gate A. */}
      {needsMfa && (
        <Alert variant="destructive" data-testid="legal-holds-mfa-banner">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>
            {mfaUnknown
              ? "Could not confirm MFA status"
              : "Multi-factor authentication required"}
          </AlertTitle>
          <AlertDescription>
            {mfaUnknown ? (
              <>
                We could not verify your session's MFA status. Apply and
                Release are blocked until this clears. Refresh the page, or
                open{" "}
                <a href="/desk/settings/security" className="underline font-medium">
                  Settings → Security
                </a>{" "}
                to re-verify your factor.
              </>
            ) : (
              <>
                Applying or releasing a legal hold requires an MFA-verified
                session. Open{" "}
                <a href="/desk/settings/security" className="underline font-medium">
                  Settings → Security
                </a>{" "}
                to enrol an authenticator or verify your existing factor, then
                return to this page. This banner stays visible until your
                session is MFA-verified.
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Apply form */}
      <div className="border border-border rounded-sm p-4 bg-muted/30">
        <h3 className="text-sm font-semibold mb-3">Apply legal hold</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="lh-scope-type">Scope type</Label>
            <Select value={scopeType} onValueChange={(v) => setScopeType(v as ScopeType)}>
              <SelectTrigger id="lh-scope-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCOPE_TYPES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="lh-scope-id">Scope ID (UUID)</Label>
            <Input
              id="lh-scope-id"
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="font-mono text-xs"
            />
          </div>
        </div>
        <div className="mt-3">
          <Label htmlFor="lh-reason">Reason (mandatory, ≥10 chars)</Label>
          <Textarea
            id="lh-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Litigation hold for case #2026-LX-441"
            rows={2}
          />
        </div>
        {applyError && (
          <Alert variant="destructive" className="mt-3">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{applyError.title}</AlertTitle>
            <AlertDescription>{applyError.message}</AlertDescription>
          </Alert>
        )}
        <div className="mt-3 flex justify-end">
          <Button onClick={handleApply} disabled={applyDisabled}>
            {applying && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
            Apply hold
          </Button>
        </div>
      </div>

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
          <TabsTrigger value="released">Released ({released.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4">
          {loading ? (
            <div className="text-sm text-muted-foreground"><Loader2 className="h-3 w-3 inline animate-spin mr-2" />Loading…</div>
          ) : active.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active legal holds.</p>
          ) : (
            <ul className="space-y-3">
              {active.map((h) => (
                <li key={h.id} className="border border-border rounded-sm p-3 bg-card">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <HoldActiveBadge active />
                      <div className="mt-2 font-mono text-xs text-muted-foreground">
                        {h.scope_type} · {h.scope_id}
                      </div>
                      <p className="mt-1 text-sm">{h.reason}</p>
                      <p className="mt-1 text-[11px] font-mono text-muted-foreground">
                        applied {new Date(h.applied_at).toISOString()} · by {h.applied_by ?? "system"}
                      </p>
                    </div>
                    <div className="w-full md:w-80 space-y-2">
                      <Textarea
                        placeholder="Release reason (≥10 chars, mandatory)"
                        rows={2}
                        value={releaseReasons[h.id] ?? ""}
                        onChange={(e) =>
                          setReleaseReasons((s) => ({ ...s, [h.id]: e.target.value }))
                        }
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        disabled={
                          releasingId === h.id ||
                          needsMfa ||
                          mfaLoading ||
                          (releaseReasons[h.id] ?? "").trim().length < 10
                        }
                        onClick={() => handleRelease(h)}
                      >
                        {releasingId === h.id && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                        Release hold
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="released" className="mt-4">
          {released.length === 0 ? (
            <p className="text-sm text-muted-foreground">No released holds.</p>
          ) : (
            <ul className="space-y-2">
              {released.map((h) => (
                <li key={h.id} className="border border-border rounded-sm p-3 bg-card">
                  <div className="font-mono text-xs text-muted-foreground">
                    {h.scope_type} · {h.scope_id}
                  </div>
                  <p className="text-sm mt-1">{h.reason}</p>
                  {h.released_reason && (
                    <p className="text-xs mt-1 text-muted-foreground">
                      Release: {h.released_reason}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] font-mono text-muted-foreground">
                    applied {new Date(h.applied_at).toISOString()}
                    {h.released_at && ` · released ${new Date(h.released_at).toISOString()}`}
                    {h.released_by && ` · by ${h.released_by}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
