/**
 * EvidencePackView, Sovereign-vault rendering of a real evidence pack.
 *
 * Pulls the deterministic, server-signed pack from the `evidence-pack`
 * Edge Function (which computes SHA-256 over a canonical JSON payload of
 * the match, its event chain, documents, and audit log). The UI presents
 * verified commercial terms and the actual gate progression, no mocks.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FileText, Code, Share2, ShieldCheck, Check, Circle, Loader2, AlertTriangle, ArrowLeft, FileSearch, Copy } from "lucide-react";
import { fetchEdgeFunction } from "@/lib/edge-invoke";
import { downloadFile } from "@/lib/download-utils";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DEMO_EVIDENCE_PACK, DEMO_MATCH_ID } from "@/components/desk/_demo/fixtures";
export interface EvidencePackViewProps {
  /**
   * Marketing-mockup mode. When true, the component renders a static,
   * high-fidelity fixture pack instead of fetching from the edge function.
   * Use this for landing pages, screenshots, and marketing visuals so the
   * production UI can be reused without auth or live data.
   */
  demoMode?: boolean;
}

// ──────────────────────────────────────────────────────────────────────
// Types

interface EvidencePack {
  metadata: {
    packId: string;
    generatedAt: string;
    format: string;
  };
  packHash: string;
  hashAlgorithm: string;
  signatureValidation: {
    hasCollapseRecord: boolean;
    signatureValid: boolean | null;
    signatureKeyId: string | null;
  };
  timestampMetadata: {
    serverTimestampUtc: string;
    matchCreatedAt: string;
    matchSettledAt: string | null;
    collapseClientTimestamp: string | null;
    collapseServerTimestamp: string | null;
    timestampSource: string;
  };
  chainVerification: {
    valid: boolean;
    eventCount: number;
  };
  canonical: {
    match?: Record<string, unknown>;
    documents?: Array<Record<string, unknown>>;
    events?: Array<{
      event_type: string;
      payload_hash: string;
      created_at: string;
    }>;
    collapse?: Record<string, unknown> | null;
  };
}
type GateStatus = "verified" | "pending" | "blocked";
interface Gate {
  id: string;
  label: string;
  status: GateStatus;
  hash?: string;
}

// ──────────────────────────────────────────────────────────────────────
// Gate derivation, maps real match/event state to the 9-gate WaD model

function deriveGates(pack: EvidencePack | null): Gate[] {
  const match = (pack?.canonical?.match ?? {}) as Record<string, unknown>;
  const events = pack?.canonical?.events ?? [];
  const documents = pack?.canonical?.documents ?? [];
  const collapse = pack?.canonical?.collapse;
  const eventTypes = new Set(events.map(e => String(e.event_type)));
  const matchState = String(match.state || "");
  const matchStatus = String(match.status || "");
  const isSettled = matchStatus === "settled" || matchStatus === "completed";
  const hasCollapse = !!collapse;
  const sigValid = pack?.signatureValidation?.signatureValid === true;
  const docCount = documents.length;
  const chainValid = pack?.chainVerification?.valid === true;
  const gateOf = (status: GateStatus, hashSeed?: string): GateStatus => status;
  const hashFor = (idx: number) => events[idx]?.payload_hash;
  return [{
    id: "GATE_01",
    label: "Bilateral Signatures Verified",
    status: gateOf(hasCollapse && sigValid ? "verified" : isSettled ? "pending" : "blocked"),
    hash: collapse ? String((collapse as {
      payload_hash?: string;
    }).payload_hash || "") : undefined
  }, {
    id: "GATE_02",
    label: "Token Burn Recorded",
    status: gateOf(isSettled ? "verified" : "pending"),
    hash: hashFor(0)
  }, {
    id: "GATE_03",
    label: "KYB Status Cleared (Both Parties)",
    status: gateOf(eventTypes.has("kyc_verified") || isSettled ? "verified" : "pending")
  }, {
    id: "GATE_04",
    label: "Jurisdiction & Sanctions Reviewed",
    status: gateOf(eventTypes.has("sanctions_screened") || eventTypes.has("jurisdiction_resolved") || isSettled ? "verified" : "pending")
  }, {
    id: "GATE_05",
    label: "UBO & Authority Records Bound",
    status: gateOf(eventTypes.has("authority_bound") || eventTypes.has("ubo_verified") ? "verified" : "pending")
  }, {
    id: "GATE_06",
    label: "Commercial Terms Hash-Locked",
    status: gateOf(matchState && matchState !== "discovery" ? "verified" : "pending"),
    hash: pack?.packHash
  }, {
    id: "GATE_07",
    label: "Document Integrity Verified",
    status: gateOf(docCount > 0 ? "verified" : "pending"),
    hash: documents[0] ? String((documents[0] as {
      sha256_hash?: string;
    }).sha256_hash || "") : undefined
  }, {
    id: "GATE_08",
    label: "Audit Trail Sealed (NTP Anchored)",
    status: gateOf(chainValid && events.length > 0 ? "verified" : "pending"),
    hash: events.length ? events[events.length - 1].payload_hash : undefined
  }, {
    id: "GATE_09",
    label: "WaD Certificate Issued",
    status: gateOf(matchState === "completed" ? "verified" : "pending")
  }];
}

// ──────────────────────────────────────────────────────────────────────
// Term derivation, maps real match row to verified-terms grid

function deriveTerms(pack: EvidencePack | null): Array<{
  label: string;
  value: string;
}> {
  const m = (pack?.canonical?.match ?? {}) as Record<string, unknown>;
  if (!Object.keys(m).length) return [];
  const fmt = (v: unknown) => v == null || v === "" ? "-" : String(v);
  const qty = m.quantity_amount ? `${m.quantity_amount} ${fmt(m.quantity_unit)}` : "-";
  const price = m.price_amount != null ? `${fmt(m.price_currency)} ${Number(m.price_amount).toLocaleString("en-US")}` : "-";
  const notional = m.price_amount != null && m.quantity_amount != null ? `${fmt(m.price_currency)} ${(Number(m.price_amount) * Number(m.quantity_amount)).toLocaleString("en-US")}` : "-";
  return [{
    label: "COMMODITY",
    value: fmt(m.commodity)
  }, {
    label: "VOLUME",
    value: qty
  }, {
    label: "UNIT PRICE",
    value: price
  }, {
    label: "TOTAL CONSIDERATION",
    value: notional
  }, {
    label: "INCOTERMS",
    value: fmt(m.incoterms || m.delivery_terms)
  }, {
    label: "PAYMENT TERMS",
    value: fmt(m.payment_terms)
  }, {
    label: "BUYER",
    value: fmt(m.buyer_name)
  }, {
    label: "SELLER",
    value: fmt(m.seller_name)
  }, {
    label: "EXECUTION DATE",
    value: m.settled_at ? new Date(String(m.settled_at)).toUTCString() : "-"
  }, {
    label: "STATUS",
    value: fmt(m.status)
  }];
}

// ──────────────────────────────────────────────────────────────────────
// Component

export function EvidencePackView({
  demoMode = false
}: EvidencePackViewProps = {}) {
  const {
    id
  } = useParams();
  const matchId = demoMode ? DEMO_MATCH_ID : id || "";
  const navigate = useNavigate();
  const [pack, setPack] = useState<EvidencePack | null>(demoMode ? DEMO_EVIDENCE_PACK as unknown as EvidencePack : null);
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const canonicalPayload = useMemo(() => pack ? JSON.stringify(pack.canonical, null, 2) : "", [pack]);
  async function handleCopyPayload() {
    if (!canonicalPayload) return;
    try {
      await navigator.clipboard.writeText(canonicalPayload);
      toast.success("Canonical payload copied to clipboard.");
    } catch {
      toast.error("Could not copy payload.");
    }
  }
  useEffect(() => {
    if (demoMode) return; // fixture is already loaded, never hit the network.
    let cancelled = false;
    async function load() {
      if (!matchId) {
        setError("No match identifier provided.");
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError(null);
        const data = await fetchEdgeFunction<EvidencePack>(`evidence-pack/${matchId}`, {
          method: "GET",
          label: "load evidence pack",
        });
        if (!cancelled) setPack(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load evidence pack.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [matchId, demoMode]);
  const gates = useMemo(() => deriveGates(pack), [pack]);
  const terms = useMemo(() => deriveTerms(pack), [pack]);
  const issuedAt = pack?.timestampMetadata?.serverTimestampUtc ?? "";
  const payloadHash = pack?.packHash ?? "";
  async function handleDownloadJson() {
    if (!pack) return;
    downloadFile(JSON.stringify(pack, null, 2), `evidence-pack-${matchId}.json`, "application/json");
    toast.success("Raw ledger downloaded (JSON).");
  }
  async function handleDownloadReport() {
    try {
      const html = await fetchEdgeFunction<string>(`evidence-pack/${matchId}`, {
        method: "GET",
        query: { format: "pdf" },
        label: "download evidence report",
      });
      downloadFile(html, `evidence-pack-${matchId}.html`, "text/html");
      toast.success("Evidence report downloaded.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to download report.");
    }
  }
  function handleShare() {
    const url = `${window.location.origin}/desk/evidence/${matchId}`;
    navigator.clipboard.writeText(url).then(() => toast.success("Secure link copied to clipboard."), () => toast.error("Could not copy link."));
  }

  // ── Loading ──
  if (loading) {
    return <div className="min-h-screen w-full bg-slate-900 flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground/50">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="font-mono text-xs tracking-[0.3em] uppercase">Sealing evidence…</span>
        </div>
      </div>;
  }

  // ── Error / empty ──
  if (error || !pack) {
    return <div className="min-h-screen w-full bg-slate-900 flex items-center justify-center p-8">
        <div className="max-w-md text-center text-muted-foreground/50">
          <AlertTriangle className="h-8 w-8 mx-auto mb-4 text-amber-400" />
          <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted-foreground/70 mb-2">
            Evidence Unavailable
          </p>
          <p className="text-sm">{error || "No pack could be assembled for this match."}</p>
          <button onClick={() => navigate("/desk/deals")} className="mt-6 inline-flex items-center gap-2 text-xs font-medium text-slate-200 hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Deals
          </button>
        </div>
      </div>;
  }
  return <div className={demoMode ? "relative w-full bg-slate-900 py-10 px-6 rounded-2xl overflow-hidden" : "min-h-screen w-full bg-slate-900 py-16 px-6 lg:px-12"}>
      {/* Vault header strip */}
      <div className="max-w-[920px] mx-auto mb-10 flex items-center justify-between">
        {demoMode ? <span className="flex items-center gap-3 text-muted-foreground/70">
            <ShieldCheck className="h-4 w-4" strokeWidth={1.5} />
            <span className="font-mono text-[10px] tracking-[0.3em] uppercase">
              Audit Ledger · Immutable Record
            </span>
          </span> : <Link to="/desk/deals" className="flex items-center gap-3 text-muted-foreground/70 hover:text-slate-200 transition-colors">
            <ShieldCheck className="h-4 w-4" strokeWidth={1.5} />
            <span className="font-mono text-[10px] tracking-[0.3em] uppercase">
              Audit Ledger · Immutable Record
            </span>
          </Link>}
        <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
          REF · {matchId.slice(0, 8).toUpperCase()}
        </span>
      </div>

      <motion.article initial={{
      y: 80,
      opacity: 0
    }} animate={{
      y: 0,
      opacity: 1
    }} transition={{
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1]
    }} className="relative max-w-[920px] mx-auto bg-card rounded-none shadow-[0_40px_120px_-30px_rgba(0,0,0,0.6)]" style={{
      boxShadow: "0 0 0 1px hsl(215 16% 85%), 0 0 0 4px white, 0 0 0 5px hsl(215 16% 85%), 0 40px 120px -30px rgba(0,0,0,0.6)"
    }}>
        <div className="p-10 sm:p-14 lg:p-16">
          {/* Header row */}
          <header className="flex items-start justify-between gap-8 pb-10 border-b border-border">
            <div>
              <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-foreground font-medium">
                Izenzo Governance Infrastructure
              </p>
              <p className="mt-1 font-mono text-[9px] tracking-[0.25em] uppercase text-muted-foreground/70">
                Without-a-Doubt · Issuance Authority
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-muted-foreground/70">
                Match UUID
              </p>
              <p className="mt-1 font-mono text-[10px] text-foreground break-all max-w-[260px]">
                {matchId}
              </p>
            </div>
          </header>

          {/* Title + seal */}
          <div className="py-14 text-center">
            <p className="font-mono text-[10px] tracking-[0.4em] uppercase text-muted-foreground/70 mb-4"> Certificate Class, WaD/A </p>
            <h1 className="text-3xl sm:text-4xl font-semibold text-foreground tracking-[0.2em] uppercase leading-tight">
              Attestation of
              <br />
              Commercial Intent
            </h1>

            <motion.div initial={{
            scale: 1.5,
            opacity: 0,
            rotate: -8
          }} animate={{
            scale: 1,
            opacity: 1,
            rotate: -6
          }} transition={{
            delay: 0.7,
            duration: 0.45,
            ease: [0.34, 1.56, 0.64, 1]
          }} className="mt-12 inline-flex flex-col items-center justify-center">
              <div className="relative h-44 w-44 rounded-full flex flex-col items-center justify-center" style={{
              border: "2px solid hsl(155 35% 28%)",
              boxShadow: "inset 0 0 0 4px white, inset 0 0 0 5px hsl(155 35% 28% / 0.4)"
            }}>
                <p className="font-mono text-[9px] tracking-[0.3em] uppercase mb-2" style={{
                color: "hsl(155 35% 28%)"
              }}>
                  Issued & Sealed
                </p>
                <p className="text-base font-semibold tracking-[0.15em] uppercase" style={{
                color: "hsl(155 35% 28%)"
              }}>
                  Without
                </p>
                <p className="text-base font-semibold tracking-[0.15em] uppercase" style={{
                color: "hsl(155 35% 28%)"
              }}>
                  a Doubt
                </p>
                <p className="mt-2 font-mono text-[8px] tracking-[0.2em] uppercase" style={{
                color: "hsl(155 35% 28%)"
              }}>
                  {issuedAt}
                </p>
              </div>
            </motion.div>
          </div>

          {/* Verified terms grid */}
          <section className="pt-4 pb-10 border-t border-border">
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted-foreground/70 mb-6">
              I · Verified Commercial Terms
            </p>
            {terms.length === 0 ? <p className="text-sm italic text-muted-foreground">
                No commercial terms have been recorded against this match.
              </p> : <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-6">
                {terms.map(t => <div key={t.label} className="border-b border-border pb-3">
                    <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground/70">
                      {t.label}
                    </p>
                    <p className="mt-1 text-sm text-foreground font-medium break-words">{t.value}</p>
                  </div>)}
              </div>}
          </section>

          {/* 9-Gate audit trail (real progression) */}
          <section className="pt-10 pb-4 border-t border-border">
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted-foreground/70 mb-2">
              II · 9-Gate Compliance Trail
            </p>
            {demoMode && (
              <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-emerald-600/80 mb-4">
                Sample gate data
              </p>
            )}
            <ul className="space-y-3">
              {gates.map((gate, idx) => {
              const isVerified = gate.status === "verified";
              const colour = isVerified ? "hsl(155 35% 28%)" : "hsl(215 16% 70%)";
              return <li key={gate.id} className="flex items-start gap-4 py-2 border-b border-border last:border-b-0">
                    <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full shrink-0" style={{
                  backgroundColor: isVerified ? colour : "transparent",
                  border: `1px solid ${colour}`
                }}>
                      {isVerified ? <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} /> : <Circle className="h-1.5 w-1.5" style={{
                    color: colour
                  }} fill={colour} />}
                    </span>
                    <div className="flex-1 min-w-0 grid grid-cols-12 gap-3 items-center">
                      <div className="col-span-12 sm:col-span-4">
                        <p className="font-mono text-[10px] tracking-[0.15em] uppercase text-foreground font-medium">
                          {gate.id}
                        </p>
                      </div>
                      <div className="col-span-12 sm:col-span-4">
                        <p className="text-[11px] text-muted-foreground">{gate.label}</p>
                      </div>
                      <div className="col-span-12 sm:col-span-4 text-right">
                        <p className="font-mono text-[8px] text-muted-foreground/70 break-all">
                          {gate.hash ? gate.hash.slice(0, 40) : isVerified ? "verified" : "pending"}
                        </p>
                      </div>
                    </div>
                    <span className="font-mono text-[8px] text-muted-foreground/50 tabular-nums shrink-0">
                      {String(idx + 1).padStart(2, "0")}/09
                    </span>
                  </li>;
            })}
            </ul>
          </section>

          {/* Integrity footer */}
          <footer className="mt-12 pt-8 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-8">
            <div>
              <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted-foreground/70 mb-2">
                Payload Hash ({pack.hashAlgorithm})
              </p>
              <p className="font-mono text-[10px] text-foreground break-all">{payloadHash}</p>
              <button type="button" onClick={() => setInspectorOpen(true)} className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border border-border bg-muted hover:bg-muted text-muted-foreground hover:text-foreground font-mono text-[10px] tracking-[0.2em] uppercase transition-colors">
                <FileSearch className="h-3 w-3" strokeWidth={1.75} />
                Verify Record Integrity
              </button>
            </div>
            <div className="sm:text-right">
              <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted-foreground/70 mb-2">
                Issuance Authority
              </p>
              <p className="text-sm text-foreground font-medium"> Izenzo Governor, {pack.signatureValidation.signatureKeyId || "Unsigned"}
              </p>
              <p className="font-mono text-[10px] text-muted-foreground mt-1">
                Source · {pack.timestampMetadata.timestampSource}
              </p>
            </div>
          </footer>
        </div>
      </motion.article>

      {/* Integrity Inspector, reveals the canonical SHA-256 input */}
      <Dialog open={inspectorOpen} onOpenChange={setInspectorOpen}>
        <DialogContent className="max-w-3xl bg-slate-950 border-slate-800 text-slate-100 p-0 gap-0 max-h-[90vh] flex flex-col">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-800">
            <DialogTitle className="font-mono text-[11px] tracking-[0.3em] uppercase text-muted-foreground/50">
              Integrity Inspector · Canonical Payload
            </DialogTitle>
            <DialogDescription className="text-muted-foreground/70 text-[12px] leading-relaxed pt-2">
              This JSON object is the canonical input for the SHA-256 algorithm. You can copy this payload and run it through any independent hashing utility (e.g.{" "}
              <span className="font-mono text-muted-foreground/50">sha256sum</span>,{" "}
              <span className="font-mono text-muted-foreground/50">openssl dgst -sha256</span>) to verify it matches the Seal Hash above.
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 py-4 border-b border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-muted-foreground mb-1">
                Algorithm
              </p>
              <p className="font-mono text-[11px] text-slate-200">{pack.hashAlgorithm}</p>
            </div>
            <div>
              <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-muted-foreground mb-1">
                Seal Hash
              </p>
              <p className="font-mono text-[10px] text-emerald-400 break-all">{payloadHash}</p>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-6 bg-slate-900/50">
            <pre className="font-mono text-[11px] leading-relaxed text-slate-200 whitespace-pre-wrap break-words">
              {canonicalPayload || "{}"}
            </pre>
          </div>

          <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-between gap-4">
            <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-muted-foreground">
              {canonicalPayload.length.toLocaleString()} bytes · deterministic input
            </p>
            <button type="button" onClick={handleCopyPayload} className="inline-flex items-center gap-2 px-4 py-2 rounded-sm bg-muted hover:bg-card text-foreground font-mono text-[10px] tracking-[0.2em] uppercase transition-colors">
              <Copy className="h-3 w-3" strokeWidth={2} />
              Copy Payload
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Floating control bar, hidden in demo mode (museum / public page embed) */}
      {!demoMode && <motion.div initial={{
      y: 30,
      opacity: 0
    }} animate={{
      y: 0,
      opacity: 1
    }} transition={{
      delay: 1.1,
      duration: 0.4,
      ease: "easeOut"
    }} className="sticky bottom-8 mt-12 mx-auto w-fit">
        <div className="bg-slate-800/80 backdrop-blur-md border border-slate-700/60 rounded-full px-3 py-2 flex items-center gap-1 shadow-2xl">
          <VaultAction icon={<FileText className="h-4 w-4" strokeWidth={1.5} />} onClick={handleDownloadReport}>
            Download PDF Evidence
          </VaultAction>
          <span className="h-5 w-px bg-slate-700/80" />
          <VaultAction icon={<Code className="h-4 w-4" strokeWidth={1.5} />} onClick={handleDownloadJson}>
            Export Raw Ledger (JSON)
          </VaultAction>
          <span className="h-5 w-px bg-slate-700/80" />
          <VaultAction icon={<Share2 className="h-4 w-4" strokeWidth={1.5} />} onClick={handleShare}>
            Share Secure Link
          </VaultAction>
        </div>
      </motion.div>}
    </div>;
}
function VaultAction({
  icon,
  children,
  onClick
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return <button type="button" onClick={onClick} className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12px] text-slate-200 hover:bg-slate-700/60 hover:text-white transition-colors">
      {icon}
      <span className="tracking-wide">{children}</span>
    </button>;
}