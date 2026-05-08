/**
 * InboundReview, The counterparty-side review of a sealed Proof of Intent.
 *
 * Hardened (Prompt 34): no more mock data, no more hollow buttons.
 * - Fetches the real `matches` row + linked `poi_engagements` + `match_documents`
 *   for `:matchId`, scoped by RLS.
 * - "Decline & Release" → POST /poi-engagements/respond/:matchId { action: "declined" }
 * - "Counter-Sign & Seal" → POST /poi-engagements/respond/:matchId { action: "accepted" }
 *   (The accept handler atomically fills the vacant buyer/seller slot on the match,
 *    enabling the initiator to chain through to POI generation.)
 *
 * The right pane renders a live WaD certificate populated from the database row,
 * with the asymmetric seal: initiator hash sealed in green, counterparty slot
 * pulsing amber until the user counter-signs.
 */
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowLeft, FileText, Download, Check, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { ErrorState } from "@/components/ui/error-state";
import { fetchEngagementReadModelByMatchId, legacyEngagementAlias } from "@/lib/engagement-read-model";
interface InboundDoc {
  name: string;
  hash: string;
}
interface InboundData {
  matchRef: string;
  matchId: string;
  initiator: string;
  initiatorOrgId: string | null;
  initiatorHash: string;
  receivedAt: string;
  expiresIn: string;
  commodity: string;
  volume: string;
  price: string;
  incoterms: string;
  notes: string;
  documents: InboundDoc[];
  engagementId: string | null;
  engagementStatus: string | null;
  callerIsCounterparty: boolean;
  callerOrgId: string;
}
function formatRelativeExpiry(expiresAt: string | null): string {
  if (!expiresAt) return "-";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return "-";
  if (ms <= 0) return "expired";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor(ms % 86_400_000 / 3_600_000);
  const mins = Math.floor(ms % 3_600_000 / 60_000);
  return `${days}d ${hours}h ${mins}m`;
}
export function InboundReview() {
  const {
    matchId
  } = useParams<{
    matchId: string;
  }>();
  const navigate = useNavigate();
  const {
    user
  } = useAuth();
  const queryClient = useQueryClient();
  const {
    data,
    isLoading,
    isError,
    error,
    refetch
  } = useQuery({
    queryKey: ["inbound-review", matchId, user?.id],
    enabled: !!matchId && !!user,
    queryFn: async (): Promise<InboundData | null> => {
      if (!matchId || !user) return null;

      // Resolve caller's org via their profile.
      const {
        data: callerProfile,
        error: profileErr
      } = await supabase.from("profiles").select("org_id").eq("id", user.id).maybeSingle();
      if (profileErr) throw new Error(`Profile lookup failed: ${profileErr.message}`);
      const callerOrgId = callerProfile?.org_id ?? "";

      // Match row, RLS scopes us to participating orgs.
      const {
        data: match,
        error: matchErr
      } = await supabase.from("matches").select("id, org_id, buyer_org_id, seller_org_id, buyer_name, seller_name, commodity, quantity_amount, quantity_unit, price_amount, price_currency, terms, state, status, event_chain_hash, created_at").eq("id", matchId).maybeSingle();
      if (matchErr) throw matchErr;
      if (!match) throw new Error("Match not found or you do not have access.");

      // Engagement (counterparty hold-point record).
      // Phase 1.5: read via canonical resolver — never `.maybeSingle()` on
      // poi_engagements by match_id. Once Phase 2 allows multiple rows per
      // match (expired parent + renewed child), this surface must show the
      // renewed-child row to the counterparty, not the expired parent.
      const engagementEnvelope = await fetchEngagementReadModelByMatchId(
        supabase as never,
        matchId,
        "id, engagement_status, expires_at, counterparty_org_id, counterparty_email, created_at",
      );
      if (engagementEnvelope.error) throw new Error(`Engagement lookup failed: ${(engagementEnvelope.error as { message?: string })?.message ?? "unknown"}`);
      const engagement = legacyEngagementAlias(engagementEnvelope.envelope) as unknown as {
        id: string;
        engagement_status: string;
        expires_at: string | null;
        counterparty_org_id: string | null;
        counterparty_email: string | null;
        created_at: string;
      } | null;

      // Initiating-org name (for display).
      let initiatorName = match.org_id === match.buyer_org_id ? match.buyer_name : match.seller_name;
      if (!initiatorName) {
        const {
          data: org,
          error: orgErr
        } = await supabase.from("organizations").select("name").eq("id", match.org_id).maybeSingle();
        if (orgErr) throw new Error(`Organisation lookup failed: ${orgErr.message}`);
        initiatorName = org?.name ?? "Counterparty";
      }

      // Sealed evidence documents on the match.
      const {
        data: docs,
        error: docsErr
      } = await supabase.from("match_documents").select("filename, sha256_hash, doc_type, title").eq("match_id", matchId).eq("is_current_version", true).order("created_at", {
        ascending: true
      });
      if (docsErr) throw new Error(`Could not load evidence documents: ${docsErr.message}`);
      const documents: InboundDoc[] = (docs ?? []).map(d => ({
        name: d.title || d.filename || d.doc_type || "Document",
        hash: d.sha256_hash ?? ""
      }));

      // Caller is the counterparty if engagement.counterparty_org_id matches
      // OR if they're a party to the match but NOT the initiator.
      const isCounterparty = engagement?.counterparty_org_id && engagement.counterparty_org_id === callerOrgId || match.org_id !== callerOrgId && (match.buyer_org_id === callerOrgId || match.seller_org_id === callerOrgId);
      const volume = match.quantity_amount != null ? `${Number(match.quantity_amount).toLocaleString()}${match.quantity_unit ? ` ${match.quantity_unit}` : ""}` : "-";
      const price = match.price_amount != null ? `${Number(match.price_amount).toLocaleString()}${match.price_currency ? ` ${match.price_currency}` : ""}` : "-";
      return {
        matchRef: `WAD-${match.id.slice(0, 8).toUpperCase()}`,
        matchId: match.id,
        initiator: initiatorName ?? "Counterparty",
        initiatorOrgId: match.org_id,
        initiatorHash: match.event_chain_hash ?? "-",
        receivedAt: new Date(match.created_at).toISOString().replace("T", " ").slice(0, 19) + " UTC",
        expiresIn: formatRelativeExpiry(engagement?.expires_at ?? null),
        commodity: match.commodity ?? "-",
        volume,
        price,
        incoterms: "-",
        notes: match.terms ?? "",
        documents,
        engagementId: engagement?.id ?? null,
        engagementStatus: engagement?.engagement_status ?? null,
        callerIsCounterparty: !!isCounterparty,
        callerOrgId
      };
    }
  });
  const respond = useMutation({
    mutationFn: async (action: "accepted" | "declined") => {
      if (!matchId) throw new Error("Missing match id");
      const {
        data: result,
        error: invokeErr
      } = await supabase.functions.invoke(`poi-engagements/respond/${matchId}`, {
        body: {
          action
        }
      });
      if (invokeErr) throw invokeErr;
      return {
        action,
        result
      };
    },
    onSuccess: ({
      action
    }) => {
      queryClient.invalidateQueries({
        queryKey: ["inbound-review", matchId]
      });
      queryClient.invalidateQueries({
        queryKey: ["desk-attention"]
      });
      queryClient.invalidateQueries({
        queryKey: ["desk-pipeline"]
      });
      if (action === "accepted") {
        toast({
          title: "Trade counter-signed",
          description: "The deal is sealed bilaterally and queued for POI generation."
        });
        navigate(`/desk/match/${matchId}`);
      } else {
        toast({
          title: "Inbound request declined",
          description: "The match has been released. The counterparty has been notified."
        });
        navigate("/desk");
      }
    },
    onError: (err: any) => {
      toast({
        title: "Action failed",
        description: err?.message ?? "Please try again.",
        variant: "destructive"
      });
    }
  });
  const notional = useMemo(() => {
    if (!data) return "-";
    const q = parseFloat(data.volume.replace(/[^0-9.]/g, ""));
    const p = parseFloat(data.price.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(q) || !Number.isFinite(p)) return "-";
    return (q * p).toLocaleString("en-US");
  }, [data]);
  if (!matchId) {
    return <ErrorState title="No match selected" message="Open this view from a pipeline item." onRetry={() => navigate("/desk")} />;
  }
  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/70" />
      </div>;
  }
  if (isError || !data) {
    return <ErrorState title="Unable to load inbound request" message={(error as Error)?.message ?? "Please try again."} onRetry={() => {
      refetch();
    }} />;
  }
  const alreadyResponded = data.engagementStatus === "accepted" || data.engagementStatus === "declined";
  const canAct = data.callerIsCounterparty && !alreadyResponded;
  return <div className="fixed inset-y-0 inset-x-0 md:left-[250px] md:right-0 flex flex-col md:flex-row bg-card pb-16 md:pb-0">
      {/* ── LEFT PANE: Review & Action ─────────────────────────── */}
      <motion.section initial={{
      opacity: 0,
      y: 10
    }} animate={{
      opacity: 1,
      y: 0
    }} transition={{
      duration: 0.4,
      ease: "easeOut"
    }} className="w-full md:w-1/2 flex flex-col md:border-r border-border bg-card">
        <div className="flex-1 overflow-y-auto">
          <div className="px-16 pt-12 pb-12 max-w-2xl">
            <Link to="/desk" className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-10">
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
              Back to Pipeline
            </Link>

            <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200">
              <span className="relative flex h-1.5 w-1.5">
                <motion.span className="absolute inset-0 rounded-full bg-amber-400" animate={{
                opacity: [0.4, 1, 0.4]
              }} transition={{
                duration: 1.8,
                repeat: Infinity,
                ease: "easeInOut"
              }} />
                <span className="relative h-1.5 w-1.5 rounded-full bg-amber-500" />
              </span>
              <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-amber-800 font-medium">
                {alreadyResponded ? `Engagement ${data.engagementStatus}` : "Action Required · Inbound Request"}
              </span>
            </div>

            <h1 className="text-4xl lg:text-5xl font-semibold text-foreground tracking-tight leading-[1.1]">
              Review Trade Intent
            </h1>
            <p className="mt-6 text-base text-muted-foreground leading-relaxed max-w-lg">
              <span className="text-foreground font-medium">{data.initiator}</span> has generated
              a tamper-proofally sealed Proof of Intent and proposed the following terms.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] text-muted-foreground">
              <span>
                <span className="text-muted-foreground/70">Ref ·</span> {data.matchRef}
              </span>
              <span className="text-muted-foreground/50">|</span>
              <span>
                <span className="text-muted-foreground/70">Received ·</span> {data.receivedAt}
              </span>
              <span className="text-muted-foreground/50">|</span>
              <span>
                <span className="text-muted-foreground/70">Expires in ·</span>{" "}
                <span className="text-amber-700 font-medium">{data.expiresIn}</span>
              </span>
            </div>

            {/* ── Locked Terms ─────────────────────────────── */}
            <section className="relative mt-16">
              <span className="absolute -left-12 top-1.5 font-mono text-[10px] tracking-[0.25em] text-muted-foreground/70 select-none">
                01
              </span>
              <h2 className="text-base font-medium text-foreground tracking-tight pb-4 border-b border-border">
                Proposed Terms
              </h2>

              <dl className="mt-8 grid grid-cols-2 gap-x-10 gap-y-7">
                <LockedField label="Counterparty" value={data.initiator} wide />
                <LockedField label="Commodity" value={data.commodity} wide />
                <LockedField label="Volume" value={data.volume} mono />
                <LockedField label="Price" value={data.price} mono />
                <LockedField label="Incoterms" value={data.incoterms} mono />
                <LockedField label="Notional" value={notional} mono />
                {data.notes && <LockedField label="Notes" value={data.notes} wide />}
              </dl>
            </section>

            {/* ── Document Review ──────────────────────────── */}
            <section className="relative mt-16">
              <span className="absolute -left-12 top-1.5 font-mono text-[10px] tracking-[0.25em] text-muted-foreground/70 select-none">
                02
              </span>
              <h2 className="text-base font-medium text-foreground tracking-tight pb-4 border-b border-border">
                Attached Evidence
              </h2>

              {data.documents.length === 0 ? <p className="mt-8 text-sm text-muted-foreground italic">
                  No documents attached to this proof of intent.
                </p> : <ul className="mt-8 space-y-3">
                  {data.documents.map((d, i) => <li key={i} className="flex items-center gap-4 rounded-md border border-border bg-card px-4 py-3">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground truncate font-medium">{d.name}</p>
                        <p className="font-mono text-[11px] text-muted-foreground truncate">
                          sha256:{d.hash || "-"}
                        </p>
                      </div>
                    </li>)}
                </ul>}

              {data.documents.length > 0 && <button onClick={() => navigate(`/desk/match/${data.matchId}`)} className="mt-5 inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground border border-border hover:border-slate-400 rounded-md px-4 py-2.5 transition-colors">
                  <Download className="h-3.5 w-3.5" strokeWidth={2} />
                  Open Match Workspace
                </button>}
            </section>
          </div>
        </div>

        {/* ── Sticky Bilateral Action Footer ────────────────── */}
        <div className="shrink-0 border-t border-border bg-card p-6">
          <div className="max-w-2xl mx-auto flex items-stretch gap-4">
            <button onClick={() => respond.mutate("declined")} disabled={!canAct || respond.isPending} className="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md text-sm font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed">
              {respond.isPending && respond.variables === "declined" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" strokeWidth={2} />}
              Decline &amp; Release Match
            </button>
            <motion.button onClick={() => respond.mutate("accepted")} disabled={!canAct || respond.isPending} whileHover={canAct ? {
            scale: 0.99
          } : undefined} whileTap={canAct ? {
            scale: 0.985
          } : undefined} transition={{
            type: "spring",
            stiffness: 400,
            damping: 30
          }} className="flex-1 inline-flex items-center justify-center gap-3 rounded-md bg-primary px-6 py-3.5 text-sm font-medium text-primary-foreground shadow-sm hover:shadow-md transition-shadow disabled:opacity-50 disabled:cursor-not-allowed">
              {respond.isPending && respond.variables === "accepted" ? <>
                  Sealing… <Loader2 className="h-4 w-4 animate-spin" />
                </> : <>
                  Counter-Sign &amp; Seal Trade <Check className="h-4 w-4" strokeWidth={2.5} />
                </>}
            </motion.button>
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground leading-relaxed max-w-xl mx-auto">
            {canAct ? "Signing this locks the commercial intent bilaterally and submits the payload to the 9-Gate validation engine." : alreadyResponded ? `This engagement has already been ${data.engagementStatus}. No further action required.` : "Only the named counterparty may respond to this engagement."}
          </p>
        </div>
      </motion.section>

      {/* ── RIGHT PANE: Live WaD Certificate ────────────────────── */}
      <motion.section initial={{
      opacity: 0,
      y: 10
    }} animate={{
      opacity: 1,
      y: 0
    }} transition={{
      duration: 0.4,
      ease: "easeOut",
      delay: 0.05
    }} className="hidden md:block w-1/2 bg-muted overflow-hidden">
        <div className="h-full p-12 overflow-y-auto flex items-start justify-center">
          <div className="w-full max-w-xl">
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-4 text-center">
              Inbound · Pending Your Signature
            </p>

            <article className="bg-card rounded-sm shadow-md border border-border p-12">
              <header className="text-center pb-8 border-b border-border">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-foreground"> Izenzo Governance Infrastructure, Deal Record </p>
                <h2 className="mt-6 text-xl font-semibold tracking-[0.3em] uppercase text-foreground">
                  Certificate of Intent
                </h2>
                <p className="mt-3 font-mono text-[11px] text-muted-foreground">Ref · {data.matchRef}</p>
              </header>

              <dl className="py-8 space-y-1">
                <CertRow label="Counterparty" value={data.initiator} />
                <CertRow label="Commodity" value={data.commodity} />
                <CertRow label="Volume" value={data.volume} mono />
                <CertRow label="Price" value={data.price} mono />
                <CertRow label="Incoterms" value={data.incoterms} mono />
                <CertRow label="Notional" value={notional} mono />
              </dl>

              {data.notes && <div className="border-t border-border py-6">
                  <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-foreground mb-3">
                    Notes
                  </p>
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                    {data.notes}
                  </p>
                </div>}

              {data.documents.length > 0 && <div className="py-6 border-t border-border">
                  <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-foreground mb-3">
                    Attached Evidence
                  </p>
                  <ul className="space-y-2">
                    {data.documents.map((d, i) => <li key={i} className="flex items-baseline gap-3">
                        <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs text-foreground truncate font-medium">{d.name}</p>
                          <p className="font-mono text-[10px] text-muted-foreground truncate">{d.hash || "-"}</p>
                        </div>
                      </li>)}
                  </ul>
                </div>}

              {/* ── Asymmetric Seal Section ─────────────────── */}
              <div className="mt-2 pt-6 border-t border-border">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-foreground mb-5">
                  Bilateral Tamper-Proof Seal
                </p>

                <div className="space-y-3">
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
                      Initiator · {data.initiator}
                    </p>
                    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.2em] text-[hsl(var(--emerald))] font-medium">
                      <Check className="h-3 w-3" strokeWidth={3} />
                      SEALED
                    </span>
                  </div>
                  <p className="font-mono text-[11px] leading-relaxed break-all text-foreground">
                    {data.initiatorHash}
                  </p>
                </div>

                <div className="mt-6 pt-5 border-t border-dashed border-border space-y-3">
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
                      Counterparty · You
                    </p>
                    <span className={`font-mono text-[10px] tracking-[0.2em] font-medium ${alreadyResponded ? "text-muted-foreground" : "text-amber-700"}`}>
                      {alreadyResponded ? data.engagementStatus?.toUpperCase() : "AWAITING"}
                    </span>
                  </div>
                  <motion.div animate={alreadyResponded ? undefined : {
                  opacity: [0.55, 1, 0.55]
                }} transition={{
                  duration: 2.4,
                  repeat: Infinity,
                  ease: "easeInOut"
                }} className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="font-mono text-[11px] tracking-[0.15em] text-amber-800 text-center">
                      {alreadyResponded ? `[ COUNTERPARTY ${data.engagementStatus?.toUpperCase()} ]` : "[ AWAITING YOUR TAMPER-PROOF SIGNATURE ]"}
                    </p>
                  </motion.div>
                </div>
              </div>

              <footer className="mt-8 pt-6 border-t border-border text-center">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
                  {alreadyResponded ? "Engagement Closed" : "Half-Sealed · Binding Upon Counter-signature"}
                </p>
              </footer>
            </article>

            <p className="mt-6 text-center text-[11px] text-muted-foreground leading-relaxed">
              Counter-signing triggers the 9-Gate validation engine and releases the trade to
              governance.
            </p>
          </div>
        </div>
      </motion.section>
    </div>;
}

/* ────────────────────────────────────────────────────────────── */

function LockedField({
  label,
  value,
  mono,
  wide
}: {
  label: string;
  value: string;
  mono?: boolean;
  wide?: boolean;
}) {
  return <div className={wide ? "col-span-2" : ""}>
      <dt className="block text-[11px] font-mono tracking-[0.2em] uppercase text-muted-foreground mb-2">
        {label}
      </dt>
      <dd className={`text-base text-foreground font-medium leading-relaxed ${mono ? "font-mono tracking-wide" : ""}`}>
        {value}
      </dd>
    </div>;
}
function CertRow({
  label,
  value,
  mono
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return <div className="flex items-baseline gap-4 -mx-2 px-2 py-2 rounded-sm">
      <dt className="font-mono text-[10px] tracking-[0.25em] uppercase text-foreground w-32 shrink-0">
        {label}
      </dt>
      <dd className={`flex-1 text-sm text-foreground font-medium ${mono ? "font-mono" : ""}`}>
        {value}
      </dd>
    </div>;
}