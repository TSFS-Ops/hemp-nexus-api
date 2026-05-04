/**
 * JurisdictionSelector - Three-branch jurisdiction chooser for the WaD documentary path.
 *
 * Branch 1: Auto-selected (one clear signal) - shows confirmation
 * Branch 2: Multiple signals - user picks from surfaced set
 * Branch 3: Escalation - conflict or missing rules, blocked
 */

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Globe, CheckCircle2, AlertTriangle, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  deriveJurisdictionSignals,
  applyThreeBranchRule,
  hasGovernanceRules,
  validateSelection,
  saveJurisdictionSelection,
  fetchJurisdictionSelection,
  getUniqueCodes,
  type JurisdictionResult,
  type JurisdictionSelection,
  type JurisdictionSignal,
} from "@/lib/modules/jurisdiction";

interface JurisdictionSelectorProps {
  matchId: string;
  orgId: string;
  onSelectionComplete: (jurisdiction: string) => void;
}

export function JurisdictionSelector({ matchId, orgId, onSelectionComplete }: JurisdictionSelectorProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<JurisdictionResult | null>(null);
  const [existing, setExisting] = useState<JurisdictionSelection | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [escalationReason, setEscalationReason] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      // Check for existing selection first
      const existingSel = await fetchJurisdictionSelection(matchId, orgId);
      if (existingSel && existingSel.selection_method !== "escalated") {
        setExisting(existingSel);
        onSelectionComplete(existingSel.selected_jurisdiction);
        return;
      }
      if (existingSel?.selection_method === "escalated") {
        setExisting(existingSel);
      }

      // Derive signals and apply three-branch rule
      const signals = await deriveJurisdictionSignals(matchId);
      const branchResult = applyThreeBranchRule(signals);
      setResult(branchResult);

      // Branch 1: auto-select
      if (branchResult.branch === 1 && branchResult.autoSelected) {
        const rulesExist = await hasGovernanceRules(branchResult.autoSelected, orgId);
        if (rulesExist) {
          // Auto-save
          const saveResult = await saveJurisdictionSelection({
            matchId,
            orgId,
            selectedJurisdiction: branchResult.autoSelected,
            surfacedJurisdictions: branchResult.surfacedJurisdictions,
            selectionMethod: "auto",
            selectedBy: session?.user?.id ?? null,
          });
          if (saveResult.success) {
            setExisting({
              id: "",
              match_id: matchId,
              org_id: orgId,
              selected_jurisdiction: branchResult.autoSelected,
              surfaced_jurisdictions: branchResult.surfacedJurisdictions,
              selection_method: "auto",
              escalation_reason: null,
              selected_by: session?.user?.id ?? null,
              created_at: new Date().toISOString(),
            });
            onSelectionComplete(branchResult.autoSelected);
          }
        } else {
          // No rules exist → escalate (branch 3)
          setEscalationReason(`No documentary rules found for jurisdiction '${branchResult.autoSelected}'. Escalated to manual governance review.`);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [matchId, orgId, session, onSelectionComplete]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSelect = async (code: string) => {
    if (saving) return;

    try {
      setSaving(true);

      // Validate against surfaced set
      const surfacedCodes = getUniqueCodes(result?.surfacedJurisdictions ?? []);
      const conflict = validateSelection(code, surfacedCodes);

      if (conflict) {
        // Branch 3: escalate
        await saveJurisdictionSelection({
          matchId,
          orgId,
          selectedJurisdiction: code,
          surfacedJurisdictions: result?.surfacedJurisdictions ?? [],
          selectionMethod: "escalated",
          escalationReason: conflict,
          selectedBy: session?.user?.id ?? null,
        });
        setEscalationReason(conflict);
        // P4: workflow shift, not a system error. The persistent escalation
        // card below carries the actionable detail and contact route — toast
        // is informational only so the user understands the state changed.
        toast.info("This trade has been routed to governance review. See the escalation panel below.");
        return;
      }

      // Check governance rules exist
      const rulesExist = await hasGovernanceRules(code, orgId);
      if (!rulesExist) {
        const reason = `No documentary rules exist for jurisdiction '${code}'. Escalated to manual governance review.`;
        await saveJurisdictionSelection({
          matchId,
          orgId,
          selectedJurisdiction: code,
          surfacedJurisdictions: result?.surfacedJurisdictions ?? [],
          selectionMethod: "escalated",
          escalationReason: reason,
          selectedBy: session?.user?.id ?? null,
        });
        setEscalationReason(reason);
        // P4: same reasoning — persistent panel below states the next step.
        toast.info("No documentary rules for this jurisdiction. Routed to governance review.");
        return;
      }

      // Valid selection
      const saveResult = await saveJurisdictionSelection({
        matchId,
        orgId,
        selectedJurisdiction: code,
        surfacedJurisdictions: result?.surfacedJurisdictions ?? [],
        selectionMethod: "user_choice",
        selectedBy: session?.user?.id ?? null,
      });

      if (saveResult.success) {
        toast.success(`Jurisdiction set to ${code}`);
        onSelectionComplete(code);
      } else {
        toast.error(saveResult.error || "Failed to save selection");
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // Already selected (non-escalated)
  if (existing && existing.selection_method !== "escalated") {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Documentary Jurisdiction
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 p-3 rounded-lg border border-green-500/30 bg-green-500/5">
            <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
            <div>
              <p className="text-sm font-medium">
                {existing.selected_jurisdiction}
                <Badge variant="outline" className="ml-2 text-xs">
                  {existing.selection_method === "auto" ? "Auto-selected" : "User choice"}
                </Badge>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Documentary and Signed Deal rules will follow {existing.selected_jurisdiction} requirements.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Escalated (branch 3)
  if (escalationReason || existing?.selection_method === "escalated") {
    const reason = escalationReason || existing?.escalation_reason || "Jurisdiction conflict detected.";
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            Jurisdiction - Pending Governance Review
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/5 space-y-2">
            <p className="text-sm font-medium text-amber-700">Manual Review Required</p>
            <p className="text-sm text-muted-foreground">{reason}</p>
            <p className="text-xs text-muted-foreground italic">
              Signed Deal creation is blocked until a governance officer resolves this. Contact compliance@izenzo.co.za.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No signals at all
  if (!result || result.surfacedJurisdictions.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Documentary Jurisdiction
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/5 space-y-2">
            <p className="text-sm">No jurisdiction signals detected from the transaction data.</p>
            <p className="text-xs text-muted-foreground">
              Ensure entity records include jurisdiction codes and that the trade order has a location.
              This match has been escalated for manual governance review.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Branch 2: Multiple signals - user chooses
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="h-4 w-4" />
          Select Documentary Jurisdiction
        </CardTitle>
        <CardDescription>
          Multiple jurisdiction signals detected. Choose the primary jurisdictional path for documentary and Signed Deal purposes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {result.surfacedJurisdictions.map((signal) => (
          <button
            key={signal.code}
            onClick={() => {
              setSelectedCode(signal.code);
              handleSelect(signal.code);
            }}
            disabled={saving}
            className={`w-full text-left p-3 rounded-lg border transition-colors ${
              selectedCode === signal.code
                ? "border-primary bg-primary/10"
                : "border-border hover:border-primary/50 hover:bg-muted"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{signal.code}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{signal.label}</p>
              </div>
              {saving && selectedCode === signal.code ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Badge variant="outline" className="text-xs">{signal.source}</Badge>
              )}
            </div>
          </button>
        ))}
        <p className="text-xs text-muted-foreground">
          You may only choose from jurisdictions surfaced by the system. If none are suitable, contact compliance@izenzo.co.za.
        </p>
      </CardContent>
    </Card>
  );
}
