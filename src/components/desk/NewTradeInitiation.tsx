/**
 * NewTradeInitiation, entry point to the deal state machine.
 *
 * Captures the minimum viable intent (commodity, side, counterparty), inserts
 * a row into `matches` in the `discovery` state, and hard-redirects the user
 * into the Match Compiler so term negotiation can begin immediately.
 *
 * Counterparty selection prefers a known org from the `counterparties` table
 * (creates a typed metadata record). Falls back to a free-text label which is
 * stored on the match for later resolution.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserOrg } from "@/hooks/use-user-org";
import { CommoditySelect } from "@/components/ui/commodity-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { sha256Hex, canonicalTermsPayload } from "@/lib/crypto";
import { useDebounce } from "@/hooks/use-debounce";
import { useDraftPersistence } from "@/hooks/use-draft-persistence";
import { ActiveOrgIndicator } from "@/components/desk/ActiveOrgIndicator";
import { PageContainer } from "@/components/ui/page-container";
const initiationSchema = z.object({
  commodity: z.string().trim().min(2, "Select or enter a commodity").max(120),
  side: z.enum(["buyer", "seller"]),
  counterpartyLabel: z.string().trim().min(2, "Counterparty name required").max(160)
});
interface CounterpartyHit {
  id: string;
  company_name: string;
  jurisdiction: string | null;
}
export function NewTradeInitiation() {
  const navigate = useNavigate();
  const {
    user
  } = useAuth();
  const orgId = useUserOrg();
  const [orgName, setOrgName] = useState<string | null>(null);
  useEffect(() => {
    if (!orgId) {
      setOrgName(null);
      return;
    }
    supabase.from("organizations").select("name").eq("id", orgId).maybeSingle().then(({
      data,
      error
    }) => {
      if (error) {
        toast.error("Could not load your organisation name", { description: error.message });
        return;
      }
      setOrgName(data?.name ?? null);
    });
  }, [orgId]);
  const [commodity, setCommodity] = useState("");
  const [side, setSide] = useState<"buyer" | "seller">("buyer");
  const [counterpartyLabel, setCounterpartyLabel] = useState("");
  const [selectedCounterparty, setSelectedCounterparty] = useState<CounterpartyHit | null>(null);
  const [hits, setHits] = useState<CounterpartyHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const debouncedQuery = useDebounce(counterpartyLabel, 250);

  // ── Draft persistence: emergency-save the form on session expiry / page unload.
  // Listens for `izenzo:session-expiry` (fired by the session-expiry bus before
  // the SessionExpiredModal opens) and `beforeunload`. On restore after sign-in,
  // the saved values rehydrate so the user does not lose typed input.
  const draft = useDraftPersistence<{
    commodity: string;
    side: "buyer" | "seller";
    counterpartyLabel: string;
  }>("new-trade-initiation", () => ({ commodity, side, counterpartyLabel }));
  useEffect(() => {
    const restored = draft.restoreDraft();
    if (restored) {
      if (restored.commodity) setCommodity(restored.commodity);
      if (restored.side) setSide(restored.side);
      if (restored.counterpartyLabel) setCounterpartyLabel(restored.counterpartyLabel);
    }
    // Only run on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live counterparty lookup against the real `counterparties` table.
  useEffect(() => {
    if (selectedCounterparty || debouncedQuery.trim().length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setSearching(true);
      const {
        data,
        error
      } = await supabase.from("counterparties").select("id, company_name, jurisdiction").ilike("company_name", `%${debouncedQuery.trim()}%`).limit(6);
      if (cancelled) return;
      if (error) {
        toast.error("Counterparty search failed", { description: error.message });
        setHits([]);
      } else if (data) {
        setHits(data as CounterpartyHit[]);
      }
      setSearching(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, selectedCounterparty]);
  const canSubmit = useMemo(() => {
    const parsed = initiationSchema.safeParse({
      commodity,
      side,
      counterpartyLabel
    });
    return parsed.success && !!orgId && !submitting;
  }, [commodity, side, counterpartyLabel, orgId, submitting]);
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = initiationSchema.safeParse({
      commodity,
      side,
      counterpartyLabel
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
      return;
    }
    if (!orgId || !user?.id) {
      toast.error("No organisation context. Please refresh");
      return;
    }
    setSubmitting(true);
    try {
      // Deterministic hash anchoring this initiation to its commercial intent.
      const hashInput = canonicalTermsPayload({
        org_id: orgId,
        commodity: parsed.data.commodity,
        side: parsed.data.side,
        counterparty_label: parsed.data.counterpartyLabel,
        created_at: new Date().toISOString()
      });
      const hash = await sha256Hex(hashInput);
      const insertRow = {
        org_id: orgId,
        created_by: user.id,
        commodity: parsed.data.commodity,
        state: "discovery" as const,
        status: "matched" as const,
        poi_state: "DRAFT" as const,
        match_type: "search" as const,
        hash,
        buyer_org_id: parsed.data.side === "buyer" ? orgId : null,
        seller_org_id: parsed.data.side === "seller" ? orgId : null,
        // Side semantics: the initiating org takes the chosen role; the
        // counterparty slot is left null until they accept the engagement.
        ...(parsed.data.side === "buyer" ? {
          buyer_name: orgName ?? null,
          seller_name: selectedCounterparty?.company_name ?? parsed.data.counterpartyLabel
        } : {
          seller_name: orgName ?? null,
          buyer_name: selectedCounterparty?.company_name ?? parsed.data.counterpartyLabel
        }),
        metadata: {
          initiated_via: "desk.new-trade",
          initiating_side: parsed.data.side,
          counterparty_id: selectedCounterparty?.id ?? null,
          counterparty_label: parsed.data.counterpartyLabel
        }
      };
      const {
        data,
        error
      } = await supabase.from("matches").insert(insertRow as any).select("id").single();
      if (error) throw error;
      if (!data?.id) throw new Error("Match created but no id returned");
      draft.clearDraft();
      toast.success("Trade initiated. Routing to the Match Compiler.");
      navigate(`/desk/match/${data.id}`, {
        replace: true
      });
    } catch (err) {
      console.error("[new-trade] insert failed", err);
      toast.error(err instanceof Error ? err.message : "Failed to initiate trade");
      setSubmitting(false);
    }
  }
  return <PageContainer size="wide">
      <header className="mb-12">
        <div className="mb-4">
          <ActiveOrgIndicator />
        </div>
        <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-muted-foreground/70 mb-3">
          Commercial Trading · State Machine Entry
        </p>
        <h1 className="text-4xl font-semibold text-foreground tracking-tight">Start New Trade</h1>
        <p className="mt-4 text-base text-muted-foreground leading-relaxed max-w-2xl">
          Capture the minimum viable intent. The system will open the deal in
          <span className="font-mono text-muted-foreground"> discovery</span> state, anchor it to a deterministic hash, and drop you straight into the Match Compiler to negotiate terms.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="bg-card rounded-md border border-border p-8 max-w-3xl space-y-8">
        {/* Commodity */}
        <div className="space-y-2">
          <Label htmlFor="commodity" className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
            §01 · Commodity
          </Label>
          <CommoditySelect value={commodity} onChange={setCommodity} placeholder="Select or type a commodity (e.g. Copper Cathode, Brent Crude)" />
        </div>

        {/* Side */}
        <div className="space-y-2">
          <Label className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
            §02 · Your Side
          </Label>
          <div className="grid grid-cols-2 gap-3">
            {(["buyer", "seller"] as const).map(s => <button key={s} type="button" onClick={() => setSide(s)} className={`px-5 py-4 text-left rounded-md border transition-colors ${side === s ? "border-slate-900 bg-slate-900 text-white" : "border-border bg-card text-muted-foreground hover:border-slate-400"}`}>
                <p className="font-mono text-[10px] tracking-[0.2em] uppercase opacity-70">
                  I am the
                </p>
                <p className="mt-1 text-base font-medium capitalize">{s}</p>
              </button>)}
          </div>
        </div>

        {/* Counterparty */}
        <div className="space-y-2 relative">
          <Label htmlFor="counterparty" className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
            §03 · Target Counterparty
          </Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70 pointer-events-none" />
            <Input id="counterparty" value={counterpartyLabel} onChange={e => {
            setCounterpartyLabel(e.target.value);
            if (selectedCounterparty && e.target.value !== selectedCounterparty.company_name) {
              setSelectedCounterparty(null);
            }
          }} placeholder="Search registered counterparties or type a name" className="pl-9" maxLength={160} autoComplete="off" />
            {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70 animate-spin" />}
          </div>
          {hits.length > 0 && !selectedCounterparty && <ul className="mt-1 border border-border rounded-md bg-card shadow-sm divide-y divide-border max-h-56 overflow-y-auto">
              {hits.map(hit => <li key={hit.id}>
                  <button type="button" onClick={() => {
              setSelectedCounterparty(hit);
              setCounterpartyLabel(hit.company_name);
              setHits([]);
            }} className="w-full text-left px-4 py-2.5 hover:bg-muted transition-colors">
                    <p className="text-sm text-foreground">{hit.company_name}</p>
                    {hit.jurisdiction && <p className="font-mono text-[10px] tracking-wider text-muted-foreground mt-0.5">
                        {hit.jurisdiction}
                      </p>}
                  </button>
                </li>)}
            </ul>}
          {selectedCounterparty ? <p className="font-mono text-[10px] text-[hsl(var(--emerald))] mt-1">
              ✓ matched to registered counterparty {selectedCounterparty.id.slice(0, 8)}
            </p> : counterpartyLabel.trim().length >= 2 && !searching && hits.length === 0 ? <p className="font-mono text-[10px] text-muted-foreground mt-1"> No registered counterparty found: will store as a free-text label for later resolution. </p> : null}
        </div>

        {/* Submit */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <p className="font-mono text-[10px] tracking-wider text-muted-foreground">
            Initiates state: <span className="text-muted-foreground">discovery</span> · poi_state: <span className="text-muted-foreground">DRAFT</span>
          </p>
          <Button type="submit" disabled={!canSubmit} className="gap-2">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {submitting ? "Initiating…" : "Initiate Trade"}
          </Button>
        </div>
      </form>
    </PageContainer>;
}