/**
 * AdminGovernancePosturePanel - per-org gate-position configuration.
 *
 * Implements David & Daniel's "configurable governed progression":
 * lets a platform admin choose, per organisation, where the legitimacy
 * verification gate sits in the workflow:
 *
 *   • entry     - verification required from registration
 *   • poi_mint  - verification required before issuing POI / outreach (default)
 *   • wad_only  - defer verification entirely until WaD 9-gate execution
 *
 * Changes are NOT in-place updates: a new row is inserted with
 * `effective_from = now()` and the previous active row is closed out
 * with `effective_to = now()`. This preserves the historical audit
 * memory required for forensic reconstruction (Step 3).
 */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TruncationBanner } from "@/components/ui/truncation-banner";
import { ShieldCheck, ShieldAlert, History, Search, Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type GatePosition = "entry" | "poi_mint" | "wad_only";

interface OrgRow {
  id: string;
  name: string;
}

interface ProfileRow {
  id: string;
  org_id: string;
  verification_gate_position: GatePosition;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

const POSITION_META: Record<
  GatePosition,
  { label: string; tone: "default" | "secondary" | "destructive"; description: string }
> = {
  entry: {
    label: "Entry",
    tone: "destructive",
    description:
      "Verification required from registration. The strictest posture - most clients will not want this.",
  },
  poi_mint: {
    label: "POI Mint (default)",
    tone: "default",
    description:
      "Verification required before issuing a Proof of Intent or sending counterparty-facing outreach. Search and drafting remain frictionless.",
  },
  wad_only: {
    label: "WaD Only",
    tone: "secondary",
    description:
      "Verification deferred entirely to WaD 9-gate execution. POIs and outreach permitted unverified - final binding still gated by WaD.",
  },
};

export function AdminGovernancePosturePanel() {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [orgFilter, setOrgFilter] = useState("");
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [activeProfile, setActiveProfile] = useState<ProfileRow | null>(null);
  const [history, setHistory] = useState<ProfileRow[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [pendingPosition, setPendingPosition] = useState<GatePosition>("poi_mint");
  const [pendingNotes, setPendingNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Load orgs once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name")
        .order("name", { ascending: true })
        .limit(500);
      if (!cancelled) {
        if (error) {
          toast.error(`Could not load organisations: ${error.message}`);
          setOrgs([]);
        } else {
          setOrgs(((data ?? []) as unknown) as OrgRow[]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load posture history for the selected org
  useEffect(() => {
    if (!selectedOrgId) {
      setActiveProfile(null);
      setHistory([]);
      return;
    }
    let cancelled = false;
    setLoadingProfile(true);
    (async () => {
      const { data, error } = await supabase
        .from("org_governance_profiles")
        .select("*")
        .eq("org_id", selectedOrgId)
        .order("effective_from", { ascending: false });
      if (cancelled) return;
      setLoadingProfile(false);
      if (error) {
        toast.error(`Could not load governance posture: ${error.message}`);
        setActiveProfile(null);
        setHistory([]);
        return;
      }
      const rows = (data ?? []) as ProfileRow[];
      const active = rows.find((r) => r.effective_to === null) ?? null;
      setActiveProfile(active);
      setHistory(rows);
      setPendingPosition(active?.verification_gate_position ?? "poi_mint");
      setPendingNotes("");
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedOrgId]);

  const filteredOrgs = useMemo(() => {
    if (!orgs) return [];
    const q = orgFilter.trim().toLowerCase();
    if (!q) return orgs.slice(0, 50);
    return orgs.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 50);
  }, [orgs, orgFilter]);

  const currentPosition: GatePosition = activeProfile?.verification_gate_position ?? "poi_mint";
  const positionChanged = pendingPosition !== currentPosition;

  async function handleApply() {
    if (!selectedOrgId || !user?.id || !positionChanged) return;
    setSubmitting(true);
    try {
      // Close out the existing active row (if any)
      if (activeProfile) {
        const { error: closeErr } = await supabase
          .from("org_governance_profiles")
          .update({ effective_to: new Date().toISOString() })
          .eq("id", activeProfile.id)
          .is("effective_to", null);
        if (closeErr) throw closeErr;
      }

      // Insert the new active row
      const { error: insertErr } = await supabase
        .from("org_governance_profiles")
        .insert({
          org_id: selectedOrgId,
          verification_gate_position: pendingPosition,
          notes: pendingNotes.trim() || null,
          created_by: user.id,
        });
      if (insertErr) throw insertErr;

      toast.success(
        `Gate posture updated to '${POSITION_META[pendingPosition].label}'. The previous posture is preserved in the history below.`,
      );

      // Re-fetch
      const { data } = await supabase
        .from("org_governance_profiles")
        .select("*")
        .eq("org_id", selectedOrgId)
        .order("effective_from", { ascending: false });
      const rows = (data ?? []) as ProfileRow[];
      setActiveProfile(rows.find((r) => r.effective_to === null) ?? null);
      setHistory(rows);
      setPendingNotes("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Failed to update posture: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Per-tenant verification gate posture</AlertTitle>
        <AlertDescription>
          Choose, per organisation, where the legitimacy verification gate sits in their workflow.
          The default is <strong>POI Mint</strong> - unverified orgs can search and draft, but cannot
          issue a Proof of Intent or send outreach under Izenzo's name. Changes are versioned: the
          previous posture is retained for forensic audit memory and never overwritten.
        </AlertDescription>
      </Alert>

      {/* Truncation disclosure - orgs list caps at 500. Without this banner an
          admin filtering on a name that sorts late alphabetically may believe
          the org does not exist when it is simply beyond the cap. */}
      <TruncationBanner data={orgs} limit={500} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Select organisation</CardTitle>
          <CardDescription>
            Search by organisation name. The posture below applies to that tenant only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={orgFilter}
              onChange={(e) => setOrgFilter(e.target.value)}
              placeholder="Search organisations…"
              className="pl-9"
            />
          </div>

          {orgs === null ? (
            <Skeleton className="h-32 w-full" />
          ) : filteredOrgs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No organisations match your search.
            </p>
          ) : (
            <div className="border border-border rounded-md divide-y divide-border max-h-72 overflow-y-auto">
              {filteredOrgs.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setSelectedOrgId(o.id)}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-muted transition-colors ${
                    selectedOrgId === o.id ? "bg-muted font-medium" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate">{o.name}</span>
                    <span className="text-xs text-muted-foreground font-mono shrink-0">
                      {o.id.slice(0, 8)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedOrgId && (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" />
                    Current posture
                  </CardTitle>
                  <CardDescription>
                    The active gate position enforced for this organisation right now.
                  </CardDescription>
                </div>
                {!loadingProfile && (
                  <Badge variant={POSITION_META[currentPosition].tone}>
                    {POSITION_META[currentPosition].label}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingProfile ? (
                <Skeleton className="h-20 w-full" />
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {POSITION_META[currentPosition].description}
                  </p>
                  {!activeProfile && (
                    <p className="text-xs text-muted-foreground italic">
                      No explicit profile row exists - the platform default ('POI Mint') is in
                      force. Saving any posture below will create the first historical record.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Change posture</CardTitle>
              <CardDescription>
                Selecting a different posture inserts a new historical record. The previous record
                is closed out (not deleted) so it can be referenced in audit reconstruction.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="gate-position-select">New gate position</Label>
                <Select
                  value={pendingPosition}
                  onValueChange={(v) => setPendingPosition(v as GatePosition)}
                >
                  <SelectTrigger id="gate-position-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(POSITION_META) as GatePosition[]).map((pos) => (
                      <SelectItem key={pos} value={pos}>
                        <div className="flex flex-col items-start py-0.5">
                          <span className="text-sm font-medium">{POSITION_META[pos].label}</span>
                          <span className="text-xs text-muted-foreground line-clamp-1">
                            {POSITION_META[pos].description}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="gate-position-notes">
                  Reason / change note <span className="text-muted-foreground">(recommended)</span>
                </Label>
                <Textarea
                  id="gate-position-notes"
                  value={pendingNotes}
                  onChange={(e) => setPendingNotes(e.target.value)}
                  placeholder="e.g. Client onboarded onto deferred-WaD posture per signed governance addendum 2026-04."
                  rows={2}
                  maxLength={500}
                />
              </div>

              {positionChanged && pendingPosition === "wad_only" && (
                <Alert variant="destructive">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle>Confirm: deferred-verification posture</AlertTitle>
                  <AlertDescription>
                    Setting this organisation to <strong>WaD Only</strong> means unverified users in
                    this tenant will be able to issue Proofs of Intent and send counterparty-facing
                    outreach. Verification is only enforced at WaD execution. This posture must
                    match a signed governance addendum.
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                {positionChanged && (
                  <span className="text-xs text-muted-foreground mr-auto">
                    Switching from <strong>{POSITION_META[currentPosition].label}</strong> →{" "}
                    <strong>{POSITION_META[pendingPosition].label}</strong>
                  </span>
                )}
                <Button
                  onClick={handleApply}
                  disabled={!positionChanged || submitting}
                  size="sm"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      Applying…
                    </>
                  ) : (
                    "Apply new posture"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <History className="h-4 w-4" />
                Posture history
              </CardTitle>
              <CardDescription>
                Every change is retained. Audit logs reference these rows by id when reconstructing
                the posture in force at the time of a past trade.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No history yet. The implicit platform default ('POI Mint') is in force.
                </p>
              ) : (
                <div className="border border-border rounded-md divide-y divide-border">
                  {history.map((row) => (
                    <div key={row.id} className="px-4 py-3 text-sm space-y-1">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Badge variant={POSITION_META[row.verification_gate_position].tone}>
                            {POSITION_META[row.verification_gate_position].label}
                          </Badge>
                          {row.effective_to === null && (
                            <Badge variant="outline" className="text-xs">
                              Active
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground font-mono">
                          {row.id.slice(0, 8)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Effective {new Date(row.effective_from).toLocaleString()}{" "}
                        {row.effective_to
                          ? `→ ${new Date(row.effective_to).toLocaleString()}`
                          : "→ present"}
                      </p>
                      {row.notes && (
                        <p className="text-xs text-foreground/80 pt-1 italic">"{row.notes}"</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
