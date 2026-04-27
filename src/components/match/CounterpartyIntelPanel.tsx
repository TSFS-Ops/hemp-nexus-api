/**
 * CounterpartyIntelPanel — "light public-source checking"
 * ────────────────────────────────────────────────────────
 * Implements Daniel's 2026-04-27 product directive:
 *   • POI no longer requires the counterparty to be a registered org
 *   • The platform should still LIGHTLY support the existence of the
 *     named counterparty via public-source pointers (website, LinkedIn,
 *     other social) and a free-text note
 *   • No paid API integrations — purely user/operator-curated metadata
 *
 * One row per (match_id, side) is enforced server-side via UNIQUE.
 * RLS keeps the data inside the originating organisation.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Globe, Linkedin, Loader2, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import type { Match } from "@/hooks/use-match-details";

type Side = "buyer" | "seller";

interface IntelRow {
  id: string;
  match_id: string;
  org_id: string;
  side: Side;
  counterparty_name: string;
  website_url: string | null;
  linkedin_url: string | null;
  notes: string | null;
  presence_confirmed: boolean;
  presence_confirmed_at: string | null;
  updated_at: string;
}

interface SideEditorProps {
  match: Match;
  side: Side;
  counterpartyName: string;
  isRegistered: boolean;
  existing: IntelRow | undefined;
  onSaved: () => void;
}

function SideEditor({ match, side, counterpartyName, isRegistered, existing, onSaved }: SideEditorProps) {
  const [website, setWebsite] = useState(existing?.website_url ?? "");
  const [linkedin, setLinkedin] = useState(existing?.linkedin_url ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [presence, setPresence] = useState(existing?.presence_confirmed ?? false);
  const [saving, setSaving] = useState(false);
  const { session } = useAuth();

  // ── URL validation ──
  // Mirror the database CHECK constraints so the user sees a clean inline
  // error instead of a Postgres rejection. Empty input is allowed.
  const websiteTrim = website.trim();
  const linkedinTrim = linkedin.trim();
  const websiteValid =
    websiteTrim === "" ||
    /^https?:\/\/[^\s]+\.[^\s]+$/i.test(websiteTrim);
  const linkedinValid =
    linkedinTrim === "" ||
    /^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\/.+$/i.test(linkedinTrim);
  const formValid = websiteValid && linkedinValid;

  const handleSave = async () => {
    if (!session) return;
    if (!formValid) {
      toast.error("Fix the highlighted URL fields before saving.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        match_id: match.id,
        org_id: (match as any).org_id,
        side,
        counterparty_name: counterpartyName,
        website_url: websiteTrim || null,
        linkedin_url: linkedinTrim || null,
        notes: notes.trim() || null,
        presence_confirmed: presence,
        presence_confirmed_at: presence ? new Date().toISOString() : null,
        presence_confirmed_by: presence ? session.user.id : null,
        created_by: existing ? undefined : session.user.id,
      };

      const { error } = await supabase
        .from("match_counterparty_intel")
        .upsert(payload, { onConflict: "match_id,side" });

      if (error) throw error;
      toast.success(`${side === "buyer" ? "Buyer" : "Seller"} intel saved`);
      onSaved();
    } catch (e: any) {
      toast.error(`Could not save intel: ${e.message ?? "unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            {side === "buyer" ? "Buyer" : "Seller"}: {counterpartyName || "—"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isRegistered
              ? "Registered on platform — light intel is optional."
              : "Not yet registered — capture light public-source signals so reviewers have context."}
          </p>
        </div>
        <Badge variant={isRegistered ? "secondary" : "outline"} className="shrink-0 text-[10px]">
          {isRegistered ? "Registered" : "Named only"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={`web-${side}`} className="text-xs flex items-center gap-1.5">
            <Globe className="h-3 w-3" /> Website
          </Label>
          <Input
            id={`web-${side}`}
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://example.com"
            className="h-9 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`li-${side}`} className="text-xs flex items-center gap-1.5">
            <Linkedin className="h-3 w-3" /> LinkedIn
          </Label>
          <Input
            id={`li-${side}`}
            value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)}
            placeholder="https://linkedin.com/company/…"
            className="h-9 text-sm"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`notes-${side}`} className="text-xs">
          Notes (public-source observations)
        </Label>
        <Textarea
          id={`notes-${side}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Active LinkedIn page with 200+ employees; mentioned in trade press 2025-11-…"
          rows={2}
          className="text-sm"
        />
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
          <Checkbox
            checked={presence}
            onCheckedChange={(v) => setPresence(v === true)}
          />
          <span className="flex items-center gap-1.5">
            {presence ? (
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <ShieldQuestion className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            Public presence confirmed
          </span>
        </label>
        <Button size="sm" onClick={handleSave} disabled={saving} variant="outline">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
          Save
        </Button>
      </div>
    </div>
  );
}

export function CounterpartyIntelPanel({ match }: { match: Match }) {
  const queryClient = useQueryClient();
  const matchType = (match as any).match_type;
  const isUnilateral = matchType === "unilateral";

  const { data: rows = [], refetch, isLoading } = useQuery({
    queryKey: ["counterparty-intel", match.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("match_counterparty_intel")
        .select("*")
        .eq("match_id", match.id);
      if (error) throw error;
      return (data ?? []) as IntelRow[];
    },
  });

  const buyerIntel = useMemo(() => rows.find((r) => r.side === "buyer"), [rows]);
  const sellerIntel = useMemo(() => rows.find((r) => r.side === "seller"), [rows]);

  const handleSaved = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ["counterparty-intel", match.id] });
  };

  // Hide entirely if there are no parties at all (e.g. wide-open unilateral draft).
  if (!match.buyer_name && !match.seller_name) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldQuestion className="h-4 w-4 text-muted-foreground" />
          Counterparty intel — light public-source checks
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1.5">
          POI no longer requires verified registration. Capture website, LinkedIn,
          and short observations here so reviewers can confirm the counterparty
          plausibly exists. Hard verification (KYB / IDV) is still required at
          the WaD stage, not now.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        )}
        {!isUnilateral && match.buyer_name && (
          <SideEditor
            match={match}
            side="buyer"
            counterpartyName={match.buyer_name}
            isRegistered={!!(match as any).buyer_id}
            existing={buyerIntel}
            onSaved={handleSaved}
          />
        )}
        {!isUnilateral && match.seller_name && (
          <SideEditor
            match={match}
            side="seller"
            counterpartyName={match.seller_name}
            isRegistered={!!(match as any).seller_id}
            existing={sellerIntel}
            onSaved={handleSaved}
          />
        )}
        {isUnilateral && (
          <p className="text-sm text-muted-foreground">
            Unilateral intent — only the declaring party is on record. Light intel
            for the eventual counterparty can be added once a counterparty is named.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
