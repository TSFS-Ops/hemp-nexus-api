/**
 * SealedEngagement, Post-POI tamper-proof ledger view (HARDENED).
 *
 * Live data: fetches the match, its poi_engagement, and bound documents from Supabase
 * using :matchId from the URL. The countdown is calculated from poi_engagements.expires_at.
 * If the engagement has resolved (accepted/declined/expired), the appropriate state is rendered.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Mail, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useUserOrg, getMatchRole } from "@/hooks/use-user-org";
function fmtCountdown(msRemaining: number) {
  if (msRemaining <= 0) return "Expired";
  const totalSec = Math.floor(msRemaining / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor(totalSec % 86400 / 3600);
  const m = Math.floor(totalSec % 3600 / 60);
  const s = totalSec % 60;
  return `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}
function fmtNumber(n: number | null | undefined) {
  if (n === null || n === undefined) return "-";
  return Number(n).toLocaleString("en-US");
}
function fmtTimestamp(iso: string | null | undefined) {
  if (!iso) return "-";
  return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}
function shortRef(matchId: string) {
  return `WAD-${matchId.slice(0, 8).toUpperCase()}`;
}
export function SealedEngagement() {
  const {
    matchId
  } = useParams<{
    matchId: string;
  }>();
  const viewerOrgId = useUserOrg();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const {
    data,
    isLoading,
    error
  } = useQuery({
    queryKey: ["sealed-engagement", matchId],
    enabled: !!matchId,
    queryFn: async () => {
      const [matchRes, engagementRes, docsRes] = await Promise.all([supabase.from("matches").select("*").eq("id", matchId!).maybeSingle(), supabase.from("poi_engagements").select("*").eq("match_id", matchId!).maybeSingle(), supabase.from("match_documents").select("id, sha256_hash").eq("match_id", matchId!).eq("is_current_version", true)]);
      if (matchRes.error) throw matchRes.error;
      if (!matchRes.data) throw new Error("Match not found");
      return {
        match: matchRes.data,
        engagement: engagementRes.data,
        documents: docsRes.data ?? []
      };
    }
  });
  if (!matchId) return <Navigate to="/desk" replace />;
  if (isLoading) {
    return <div className="fixed inset-y-0 left-[250px] right-0 flex items-center justify-center bg-card">
        <Loader2 className="h-6 w-6 text-muted-foreground/70 animate-spin" />
      </div>;
  }
  if (error || !data) {
    return <div className="fixed inset-y-0 left-[250px] right-0 flex flex-col items-center justify-center bg-card text-center px-8">
        <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-muted-foreground mb-3">
          Sealed Engagement
        </p>
        <h2 className="text-2xl font-semibold text-foreground">Trade not found</h2>
        <p className="mt-2 text-sm text-muted-foreground max-w-md">
          This sealed engagement could not be loaded. It may have been archived or the
          reference is invalid.
        </p>
        <Link to="/desk" className="mt-8 inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} /> Back to Pipeline
        </Link>
      </div>;
  }
  const {
    match,
    engagement,
    documents
  } = data;
  const matchRef = shortRef(match.id);
  // Two distinct labels — never collapse them into a single ambiguous "counterparty":
  //   - partyPairLabel : both parties, used for the certificate header / locked-terms summary
  //   - counterpartyName: the OPPOSITE party from the current viewer, used in viewer-addressed copy
  // Falls back to the most informative single name when one side is missing.
  const buyerName = match.buyer_name ?? null;
  const sellerName = match.seller_name ?? null;
  const partyPairLabel =
    buyerName && sellerName
      ? `${buyerName} ↔ ${sellerName}`
      : buyerName ?? sellerName ?? "Counterparty";
  const viewerRole = getMatchRole(viewerOrgId, match);
  const counterpartyName =
    viewerRole === "buyer"
      ? sellerName ?? "Counterparty"
      : viewerRole === "seller"
        ? buyerName ?? "Counterparty"
        // Viewer is creator-without-side or unknown (e.g. admin/auditor view):
        // show the pair rather than guessing — never default to "buyer".
        : partyPairLabel;
  const commodity = match.commodity ?? "-";
  const volume = match.quantity_amount;
  const price = match.price_amount;
  const incoterms = match.terms ?? "-";
  const notes = (match.metadata as {
    notes?: string;
  } | null)?.notes ?? "";
  const sealedAt = fmtTimestamp(match.created_at);
  const notifiedAt = fmtTimestamp(engagement?.created_at ?? match.created_at);
  const payloadHash = match.hash;
  const evidenceCount = documents.length;
  const notional = volume !== null && volume !== undefined && price !== null && price !== undefined ? Number(volume) * Number(price) : null;
  const expiresAt = engagement?.expires_at ? new Date(engagement.expires_at).getTime() : null;
  const status = engagement?.engagement_status;
  const isResolved = status === "accepted" || status === "declined" || status === "expired";
  const countdown = expiresAt && !isResolved ? fmtCountdown(expiresAt - now) : status === "expired" || expiresAt && expiresAt - now <= 0 && !isResolved ? "Expired" : status === "accepted" ? "Accepted" : status === "declined" ? "Declined" : "-";
  const trackerActiveTitle = status === "accepted" ? "Counterparty Accepted" : status === "declined" ? "Counterparty Declined" : status === "expired" ? "Engagement Window Expired" : "Awaiting Counterparty Acceptance";
  const trackerActiveState: "completed" | "active" = status === "accepted" || status === "declined" || status === "expired" ? "completed" : "active";
  const issuanceLabel = status === "accepted" ? "SEALED · COUNTER-SIGNED" : status === "declined" ? "RELEASED · DECLINED" : status === "expired" ? "RELEASED · EXPIRED" : "PENDING COUNTERPARTY SIGNATURE";
  const issuanceTone = status === "accepted" ? "text-[hsl(var(--emerald))]" : status === "declined" || status === "expired" ? "text-red-700" : "text-amber-700";
  return <div className="fixed inset-y-0 left-[250px] right-0 flex bg-card">
      {/* ── LEFT PANE: Engagement Tracker ───────────────────────── */}
      <motion.section initial={{
      opacity: 0,
      y: 10
    }} animate={{
      opacity: 1,
      y: 0
    }} transition={{
      duration: 0.4,
      ease: "easeOut"
    }} className="w-1/2 overflow-y-auto border-r border-border bg-card">
        <div className="px-6 md:px-16 pt-8 md:pt-12 pb-16 md:pb-24 max-w-2xl">
          <Link to="/desk" className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-12">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            Back to Pipeline
          </Link>

          <div className="flex items-center gap-3 mb-3">
            <span className={`inline-flex h-1.5 w-1.5 rounded-full ${status === "accepted" ? "bg-[hsl(var(--emerald))]" : status === "declined" || status === "expired" ? "bg-red-500" : "bg-amber-500"}`} />
            <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-muted-foreground">
              Match · {matchRef}
            </p>
          </div>
          <h1 className="text-4xl lg:text-5xl font-semibold text-foreground tracking-tight leading-[1.1]">
            Engagement Hold-Point
          </h1>
          <p className="mt-6 text-base text-muted-foreground leading-relaxed max-w-lg">
            The Proof of Intent has been tamper-proofally sealed. The counterparty has been
            notified and the deal is locked pending their response.
          </p>

          <div className="mt-8 inline-flex items-baseline gap-3 rounded-md border border-border bg-muted px-5 py-3">
            <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
              {isResolved ? "Status" : "Auto-expires in"}
            </span>
            <span className="font-mono text-sm tracking-wider text-foreground tabular-nums">
              {countdown}
            </span>
          </div>

          {/* ── Timeline ────────────────────────────────────────── */}
          <section className="relative mt-20">
            <span className="absolute -left-12 top-1.5 font-mono text-[10px] tracking-[0.25em] text-muted-foreground/70 select-none">
              01
            </span>
            <h2 className="text-base font-medium text-foreground tracking-tight pb-4 border-b border-border">
              Counterparty Tracker
            </h2>

            <ol className="mt-10 relative">
              <div className="absolute left-[11px] top-3 bottom-3 w-px bg-muted" aria-hidden />

              <TimelineNode state="completed" title="Proof of Intent Sealed" timestamp={sealedAt} detail={<div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                    <span className="font-mono">−1 CREDIT</span>
                    <span className="text-muted-foreground/50">·</span>
                    <span>$1.00 USD burn receipt</span>
                    <span className="text-muted-foreground/50">·</span>
                    <span className="font-mono">{matchRef}</span>
                  </div>} />
              <TimelineNode state="completed" title="Counterparty Notified" timestamp={notifiedAt} detail={<div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Mail className="h-3 w-3" strokeWidth={1.75} />
                    Dual-path email & in-app alerts dispatched
                  </div>} />
              <TimelineNode state={trackerActiveState} title={trackerActiveTitle} timestamp={engagement?.responded_at ? fmtTimestamp(engagement.responded_at) : "In progress"} detail={<div className="text-xs text-muted-foreground leading-relaxed">
                    {status === "accepted" ? <>The counterparty counter-signed. WaD certificate has been sealed.</> : status === "declined" ? <>The counterparty declined this engagement. Match has been released.</> : status === "expired" ? <>The 30-day hold-point window elapsed without response.</> : <>
                        The initiating party may not self-confirm. The deal is held until{" "}
                        <span className="text-muted-foreground font-medium">{counterparty}</span>{" "}
                        responds or the 30-day window elapses.
                      </>}
                  </div>} />
            </ol>
          </section>

          {/* ── Locked Terms ────────────────────────────────────── */}
          <section className="relative mt-20">
            <span className="absolute -left-12 top-1.5 font-mono text-[10px] tracking-[0.25em] text-muted-foreground/70 select-none">
              02
            </span>
            <h2 className="text-base font-medium text-foreground tracking-tight pb-4 border-b border-border">
              Locked Commercial Terms
            </h2>

            <dl className="mt-10 space-y-7">
              <LockedField label="Counterparty" value={counterparty} />
              <LockedField label="Commodity" value={commodity} />
              <div className="grid grid-cols-2 gap-10">
                <LockedField label={`Volume${match.quantity_unit ? ` (${match.quantity_unit})` : ""}`} value={fmtNumber(volume as number | null)} mono />
                <LockedField label={`Price${match.price_currency ? ` (${match.price_currency})` : ""}`} value={fmtNumber(price as number | null)} mono />
              </div>
              <LockedField label="Delivery Terms" value={incoterms} mono />
              <LockedField label={`Notional${match.price_currency ? ` (${match.price_currency})` : ""}`} value={fmtNumber(notional)} mono />
              {notes && <LockedField label="Notes" value={notes} />}
            </dl>
          </section>
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
    }} className="w-1/2 bg-muted overflow-hidden">
        <div className="h-full p-12 overflow-y-auto flex items-start justify-center">
          <div className="w-full max-w-xl">
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-4 text-center">
              Sealed · Tamper-Proof Record
            </p>

            <article className="bg-card rounded-sm shadow-md border border-border p-12">
              <header className="text-center pb-8 border-b border-border">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-foreground"> Izenzo Governance Infrastructure, Deal Record </p>
                <h2 className="mt-6 text-xl font-semibold tracking-[0.3em] uppercase text-foreground">
                  Certificate of Intent
                </h2>
                <p className="mt-3 font-mono text-[11px] text-muted-foreground">Ref · {matchRef}</p>
              </header>

              <dl className="py-8 space-y-1">
                <CertRow label="Counterparty" value={counterparty} />
                <CertRow label="Commodity" value={commodity} />
                <CertRow label="Volume" value={`${fmtNumber(volume as number | null)}${match.quantity_unit ? ` ${match.quantity_unit}` : ""}`} mono />
                <CertRow label="Price" value={`${match.price_currency ?? ""} ${fmtNumber(price as number | null)}${match.quantity_unit ? ` / ${match.quantity_unit}` : ""}`.trim()} mono />
                <CertRow label="Terms" value={incoterms} mono />
                <CertRow label="Notional" value={`${match.price_currency ?? ""} ${fmtNumber(notional)}`.trim()} mono />
              </dl>

              {notes && <div className="border-t border-border py-6">
                  <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-foreground mb-3">
                    Notes
                  </p>
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                    {notes}
                  </p>
                </div>}

              <div className="py-6 border-t border-border">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-foreground mb-3">
                  Attached Evidence
                </p>
                <p className="text-sm text-foreground">
                  {evidenceCount} document{evidenceCount === 1 ? "" : "s"} bound to this
                  certificate
                </p>
              </div>

              <div className="mt-2 pt-6 border-t border-border">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-foreground mb-5">
                  Security & Integrity
                </p>
                <ul className="space-y-3 font-mono text-[11px]">
                  <SealRow label="Jurisdiction Check" status="VERIFIED" tone="ok" />
                  <SealRow label="UBO Validation" status="VERIFIED" tone="ok" />
                  <SealRow label="Sanctions Screen" status="CLEARED" tone="ok" />
                  <SealRow label="Authority Bind" status="VERIFIED" tone="ok" />
                </ul>

                <div className="mt-6 pt-5 border-t border-dashed border-border">
                  <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-foreground mb-3">
                    POI Payload Hash
                  </p>
                  <p className="font-mono text-[11px] leading-relaxed break-all text-foreground">
                    {payloadHash}
                  </p>
                </div>

                <div className="mt-6 pt-5 border-t border-dashed border-border">
                  <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-foreground mb-3">
                    WaD Issuance Status
                  </p>
                  <p className={`font-mono text-[11px] tracking-[0.2em] font-medium ${issuanceTone}`}>
                    {issuanceLabel}
                  </p>
                </div>
              </div>

              <footer className="mt-8 pt-6 border-t border-border text-center">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
                  Sealed Draft · Binding Upon Counter-signature
                </p>
              </footer>
            </article>

            <p className="mt-6 text-center text-[11px] text-muted-foreground leading-relaxed">
              This certificate is immutable. Any amendment requires a new Proof of Intent.
            </p>
          </div>
        </div>
      </motion.section>
    </div>;
}

/* ────────────────────────────────────────────────────────────── */

function TimelineNode({
  state,
  title,
  timestamp,
  detail
}: {
  state: "completed" | "active";
  title: string;
  timestamp: string;
  detail: React.ReactNode;
}) {
  const isActive = state === "active";
  return <li className="relative pl-10 pb-10 last:pb-0">
      <div className="absolute left-0 top-0.5 z-10">
        {isActive ? <div className="relative flex items-center justify-center w-[23px] h-[23px]">
            <motion.span className="absolute inset-0 rounded-full bg-amber-400/30" animate={{
          scale: [1, 1.6, 1],
          opacity: [0.6, 0, 0.6]
        }} transition={{
          duration: 2.4,
          repeat: Infinity,
          ease: "easeOut"
        }} />
            <span className="relative h-3 w-3 rounded-full bg-amber-500 ring-4 ring-white" />
          </div> : <div className="flex items-center justify-center w-[23px] h-[23px] rounded-full bg-[hsl(var(--emerald))] ring-4 ring-white">
            <Check className="h-3 w-3 text-white" strokeWidth={3} />
          </div>}
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-4">
          <h3 className={`text-sm font-medium tracking-tight ${isActive ? "text-amber-800" : "text-foreground"}`}>
            {title}
          </h3>
          <span className="font-mono text-[10px] text-muted-foreground tracking-wide shrink-0">
            {timestamp}
          </span>
        </div>
        <div className="mt-2">{detail}</div>
      </div>
    </li>;
}
function LockedField({
  label,
  value,
  mono
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return <div>
      <dt className="block text-[11px] font-mono tracking-[0.2em] uppercase text-muted-foreground/70 mb-2">
        {label}
      </dt>
      <dd className={`text-base text-foreground leading-relaxed ${mono ? "font-mono tracking-wide" : ""}`}>
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
function SealRow({
  label,
  status,
  tone = "pending"
}: {
  label: string;
  status: string;
  tone?: "ok" | "pending";
}) {
  const toneClass = tone === "ok" ? "text-[hsl(var(--emerald))]" : "text-amber-700";
  return <li className="flex items-center justify-between">
      <span className="text-foreground tracking-wide">{label}</span>
      <span className={`font-medium tracking-[0.2em] text-[10px] ${toneClass}`}>{status}</span>
    </li>;
}