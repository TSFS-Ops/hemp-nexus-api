/**
 * MatchCompiler, Split-screen Deal Editor + WaD Certificate preview.
 *
 * Editorial layout: numbered marginalia, fillable contract-style inputs,
 * inline signature CTA at the foot of the document, and Framer Motion
 * micro-interactions linking left-pane focus to right-pane highlight.
 *
 * Cryptography: real SHA-256 via Web Crypto (`src/lib/crypto.ts`). Hashes
 * are deterministic over canonicalised commercial terms + per-file digests.
 */

import { useEffect, useMemo, useState, useRef, ChangeEvent, DragEvent, ReactNode } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, UploadCloud, FileText, X, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { CreditProvisioningPanel } from "./CreditProvisioningPanel";
import { ProofDrawer } from "@/components/mobile/ProofDrawer";
import { useMatchDetails } from "@/hooks/use-match-details";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { sha256Hex, sha256HexOfBlob, canonicalTermsPayload, shortHash } from "@/lib/crypto";
import { DEMO_MATCH_ID, DEMO_COMPILER_TERMS, DEMO_COMPILER_DOCS, DEMO_COMPILER_SEAL } from "@/components/desk/_demo/fixtures";
type AttachedDoc = {
  name: string;
  size: number;
  hash: string; // real SHA-256 digest of file bytes
};
export interface MatchCompilerProps {
  /**
   * Marketing-mockup mode. When true, all data fetching, auth, and
   * mutations are bypassed and the component renders a static, high-fidelity
   * fixture so the live UI can be used in landing pages / screenshots.
   */
  demoMode?: boolean;
}
type FieldKey = "counterparty" | "commodity" | "volume" | "price" | "incoterms" | "notional" | "notes" | "evidence" | null;
const PLACEHOLDER = "[ Awaiting Input ]";
export function MatchCompiler({
  demoMode = false
}: MatchCompilerProps = {}) {
  const params = useParams<{
    matchId: string;
  }>();
  const matchId = demoMode ? DEMO_MATCH_ID : params.matchId;
  const navigate = useNavigate();
  const {
    session
  } = useAuth();

  // ── Hydrate from real match record (skipped in demo mode) ────
  const {
    match,
    loading: matchLoading,
    confirming,
    handleSettle
  } = useMatchDetails(demoMode ? undefined : matchId);
  const [commodity, setCommodity] = useState(demoMode ? DEMO_COMPILER_TERMS.commodity : "");
  const [volume, setVolume] = useState(demoMode ? DEMO_COMPILER_TERMS.volume : "");
  const [price, setPrice] = useState(demoMode ? DEMO_COMPILER_TERMS.price : "");
  const [incoterms, setIncoterms] = useState(demoMode ? DEMO_COMPILER_TERMS.incoterms : "");
  const [counterparty, setCounterparty] = useState(demoMode ? DEMO_COMPILER_TERMS.counterparty : "");
  const [notes, setNotes] = useState(demoMode ? DEMO_COMPILER_TERMS.notes : "");
  const [docs, setDocs] = useState<AttachedDoc[]>(demoMode ? [...DEMO_COMPILER_DOCS] : []);
  const [dragOver, setDragOver] = useState(false);
  const [focusedField, setFocusedField] = useState<FieldKey>(null);
  const [provisioningOpen, setProvisioningOpen] = useState(false);
  const [certDrawerOpen, setCertDrawerOpen] = useState(false);
  const [certSeal, setCertSeal] = useState<string | null>(demoMode ? DEMO_COMPILER_SEAL : null);
  const [hashing, setHashing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hydrate inputs once the real match arrives (skipped in demo mode).
  useEffect(() => {
    if (demoMode || !match) return;
    setCommodity(cur => cur || String(match.commodity || ""));
    setVolume(cur => cur || (match.quantity_amount != null ? String(match.quantity_amount) : ""));
    setPrice(cur => cur || (match.price_amount != null ? String(match.price_amount) : ""));
    const m = match as unknown as Record<string, unknown>;
    setIncoterms(cur => cur || String(m.incoterms || m.delivery_terms || ""));
    setCounterparty(cur => cur || String(m.counterparty_name || m.seller_name || m.buyer_name || ""));
    setNotes(cur => cur || String(m.notes || ""));
  }, [match, demoMode]);

  // ── Live token balance (replaces hardcoded `creditBalance = 0`) ─
  const {
    data: tokenData
  } = useQuery({
    queryKey: ["token-balance-compiler", session?.user?.id],
    queryFn: async () => {
      if (!session?.user?.id) return null;
      const {
        data: prof
      } = await supabase.from("profiles").select("org_id").eq("id", session.user.id).maybeSingle();
      if (!prof?.org_id) return null;
      const {
        data: bal
      } = await supabase.from("token_balances").select("balance").eq("org_id", prof.org_id).maybeSingle();
      return bal?.balance ?? 0;
    },
    enabled: !demoMode && !!session?.user?.id,
    staleTime: 30_000
  });
  const creditBalance = demoMode ? 250 : tokenData ?? 0;
  const matchRef = useMemo(() => matchId && matchId !== "new" ? matchId.slice(0, 8).toUpperCase() : "DRAFT-000", [matchId]);

  // ── Real cryptographic seal, SHA-256 over canonical payload ──
  // In demo mode the seal is pre-baked so we never run hashing.
  useEffect(() => {
    if (demoMode) return;
    let cancelled = false;
    const payload = canonicalTermsPayload({
      counterparty,
      commodity,
      volume,
      price,
      incoterms,
      notes,
      documents: docs.map(d => ({
        name: d.name,
        size: d.size,
        hash: d.hash
      }))
    });
    const empty = !counterparty.trim() && !commodity.trim() && !volume.trim() && !price.trim() && !incoterms.trim() && !notes.trim() && docs.length === 0;
    if (empty) {
      setCertSeal(null);
      return;
    }
    setHashing(true);
    sha256Hex(payload).then(h => {
      if (!cancelled) setCertSeal(h);
    }).catch(() => {
      if (!cancelled) setCertSeal(null);
    }).finally(() => {
      if (!cancelled) setHashing(false);
    });
    return () => {
      cancelled = true;
    };
  }, [commodity, volume, price, incoterms, counterparty, notes, docs, demoMode]);
  async function handleFiles(files: FileList | null) {
    if (!files || demoMode) return;
    const next: AttachedDoc[] = [];
    for (const f of Array.from(files)) {
      const hash = await sha256HexOfBlob(f);
      next.push({
        name: f.name,
        size: f.size,
        hash
      });
    }
    setDocs(prev => [...prev, ...next]);
  }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (demoMode) return;
    handleFiles(e.dataTransfer.files);
  }

  // ── Real POI generation: settles via the existing match hook ──
  // In demo mode this is a no-op so marketing pages never mutate state.
  async function generateProof() {
    if (demoMode) return;
    if (creditBalance < 1) {
      setProvisioningOpen(true);
      return;
    }
    if (!matchId || matchId === "new") {
      navigate("/desk/discover");
      return;
    }
    await handleSettle();
  }
  return <div className="fixed inset-y-0 inset-x-0 md:left-[250px] md:right-0 flex flex-col md:flex-row bg-white pb-16 md:pb-0">
      {/* ── LEFT PANE: Deal Editor ─────────────────────────────── */}
      <section className="w-full md:w-1/2 overflow-y-auto md:border-r border-slate-200 bg-white">
        <div className="px-6 md:px-16 pt-8 md:pt-12 pb-24 max-w-2xl">
          <Link to="/desk" tabIndex={demoMode ? -1 : 0} aria-disabled={demoMode} className={`inline-flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors mb-12 ${demoMode ? "pointer-events-none opacity-60" : ""}`}>
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            Back to Pipeline
          </Link>

          <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-slate-500 mb-3">
            Match · {matchRef}
            {matchLoading && <span className="ml-3 inline-flex items-center gap-1 text-slate-400">
                <Loader2 className="h-3 w-3 animate-spin" /> loading
              </span>}
          </p>
          <h1 className="text-4xl lg:text-5xl font-semibold text-slate-900 tracking-tight leading-[1.1]">
            Draft Commercial Terms
          </h1>
          <p className="mt-6 text-base text-slate-600 leading-relaxed max-w-lg">
            Structure the trade in three movements. Each entry is mirrored in the Certificate of
            Intent to your right and sealed when you generate the Proof.
          </p>

          {/* ── STEP 1: Commercial Terms ──────────────────────── */}
          <StepSection number={1} title="Commercial Terms">
            <EditorField label="Counterparty" hint="Must exactly match the verified legal entity name." value={counterparty} onChange={setCounterparty} onFocus={() => setFocusedField("counterparty")} onBlur={() => setFocusedField(null)} placeholder="Enter the legal name of your counterparty" readOnly={demoMode} />
            <EditorField label="Commodity" hint="Specific grade or product description, including quality spec." value={commodity} onChange={setCommodity} onFocus={() => setFocusedField("commodity")} onBlur={() => setFocusedField(null)} placeholder="e.g. Copper Cathode, LME Grade A" readOnly={demoMode} />
            <div className="grid grid-cols-2 gap-10">
              <EditorField label="Volume (MT)" hint="Metric tonnes. Numeric only." value={volume} onChange={setVolume} onFocus={() => setFocusedField("volume")} onBlur={() => setFocusedField(null)} placeholder="500" mono readOnly={demoMode} />
              <EditorField label="Price (USD / MT)" hint="Unit price per metric tonne." value={price} onChange={setPrice} onFocus={() => setFocusedField("price")} onBlur={() => setFocusedField(null)} placeholder="9,420" mono readOnly={demoMode} />
            </div>
            <EditorField label="Delivery Incoterms" hint="Incoterms 2020 standard (e.g. FOB, CIF, DAP, with named port)." value={incoterms} onChange={setIncoterms} onFocus={() => setFocusedField("incoterms")} onBlur={() => setFocusedField(null)} placeholder="e.g. CIF Rotterdam" readOnly={demoMode} />
          </StepSection>

          {/* ── STEP 2: Supporting Documents ──────────────────── */}
          <StepSection number={2} title="Supporting Documents">
            <p className="text-sm text-slate-600 leading-relaxed -mt-2"> Attach evidence: each file is hashed (SHA-256) on attach and bound to the certificate. </p>
            <div onDragOver={e => {
            if (demoMode) return;
            e.preventDefault();
            setDragOver(true);
          }} onDragLeave={() => setDragOver(false)} onDrop={onDrop} onClick={() => {
            if (demoMode) return;
            fileInputRef.current?.click();
          }} onMouseEnter={() => setFocusedField("evidence")} onMouseLeave={() => setFocusedField(null)} aria-disabled={demoMode} className={`rounded-md border border-dashed p-10 text-center transition-colors ${demoMode ? "cursor-default border-slate-200 bg-slate-50/50 opacity-80" : dragOver ? "cursor-pointer border-primary bg-primary/5" : "cursor-pointer border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50"}`}>
              <UploadCloud className="h-6 w-6 mx-auto text-slate-500" strokeWidth={1.5} />
              <p className="mt-4 text-sm text-slate-700 font-medium">
                {demoMode ? "Evidence sealed · 3 documents bound" : "Drag and drop supporting documents"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                PDF, DOCX · Each file is hashed on attach
              </p>
              <input ref={fileInputRef} type="file" multiple accept=".pdf,.docx,.doc" disabled={demoMode} className="hidden" onChange={(e: ChangeEvent<HTMLInputElement>) => handleFiles(e.target.files)} />
            </div>

            {docs.length > 0 && <ul className="mt-6 space-y-3">
                <AnimatePresence initial={false}>
                  {docs.map((d, i) => <motion.li key={`${d.name}-${i}`} initial={{
                opacity: 0,
                y: -4
              }} animate={{
                opacity: 1,
                y: 0
              }} exit={{
                opacity: 0,
                y: -4
              }} transition={{
                duration: 0.2
              }} className="flex items-center gap-4 rounded-md border border-slate-200 bg-white px-4 py-3">
                      <FileText className="h-4 w-4 text-slate-500 shrink-0" strokeWidth={1.5} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-900 truncate font-medium">{d.name}</p>
                        <p className="font-mono text-[11px] text-slate-500 truncate">
                          sha256:{shortHash(d.hash)}
                        </p>
                      </div>
                      <button onClick={e => {
                  e.stopPropagation();
                  if (demoMode) return;
                  setDocs(prev => prev.filter((_, idx) => idx !== i));
                }} disabled={demoMode} tabIndex={demoMode ? -1 : 0} className={`text-slate-500 hover:text-slate-900 transition-colors ${demoMode ? "pointer-events-none opacity-40" : ""}`} aria-label={`Remove ${d.name}`}>
                        <X className="h-4 w-4" strokeWidth={2} />
                      </button>
                    </motion.li>)}
                </AnimatePresence>
              </ul>}
          </StepSection>

          {/* ── STEP 3: Additional Notes ──────────────────────── */}
          <StepSection number={3} title="Additional Notes">
            <div>
              <label className="block text-[11px] font-mono tracking-[0.2em] uppercase text-slate-600 mb-3">
                Notes
              </label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} onFocus={() => setFocusedField("notes")} onBlur={() => setFocusedField(null)} placeholder="Inspection by SGS at load port. Payment via L/C at sight." rows={4} readOnly={demoMode} aria-readonly={demoMode} tabIndex={demoMode ? -1 : 0} className={`w-full bg-white border-0 border-b border-slate-300 px-0 py-2 text-base text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-0 transition-colors resize-none ${demoMode ? "pointer-events-none cursor-default select-text" : ""}`} />
              <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                Optional. Notes are included in the sealed payload and visible to your counterparty.
              </p>
            </div>
          </StepSection>

          {/* ── Inline signature footer ───────────────────────── */}
          <div className="mt-32 pt-12 border-t border-slate-200">
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-500 mb-6">
              Execute
            </p>
            <motion.button whileHover={demoMode ? undefined : {
            scale: 0.99
          }} whileTap={demoMode ? undefined : {
            scale: 0.985
          }} transition={{
            type: "spring",
            stiffness: 400,
            damping: 30
          }} onClick={generateProof} disabled={demoMode || confirming || matchLoading} aria-disabled={demoMode || confirming || matchLoading} tabIndex={demoMode ? -1 : 0} className={`w-full inline-flex items-center justify-center gap-3 rounded-md bg-primary px-6 py-4 text-sm font-medium text-primary-foreground shadow-sm hover:shadow-md transition-shadow disabled:opacity-60 disabled:cursor-not-allowed ${demoMode ? "pointer-events-none" : ""}`}>
              {confirming ? <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sealing Proof of Intent…
                </> : <>
                  Generate Proof of Intent
                  <span className="font-mono text-[11px] tracking-wider opacity-80">1 CREDIT</span>
                </>}
            </motion.button>
            <p className="mt-4 text-center text-xs text-slate-500 leading-relaxed max-w-md mx-auto">
              This action atomically consumes 1 credit and permanently seals the trade intent.
              Balance: <span className="font-mono">{creditBalance}</span> credits available.
            </p>
          </div>
        </div>
      </section>

      {/* ── RIGHT PANE: Certificate Preview ─────────────────────── */}
      <section className="hidden md:block w-1/2 bg-slate-50 overflow-hidden">
        <div className="h-full p-12 overflow-y-auto flex items-start justify-center">
          <div className="w-full max-w-xl">
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-600 mb-4 text-center">
              Live Preview · Mirrors Left Pane
            </p>

            <article className="bg-white rounded-sm shadow-md border border-slate-200 p-12">
              <header className="text-center pb-8 border-b border-slate-200">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-800"> Izenzo Governance Infrastructure, Deal Record </p>
                <h2 className="mt-6 text-xl font-semibold tracking-[0.3em] uppercase text-slate-900">
                  Certificate of Intent
                </h2>
                <p className="mt-3 font-mono text-[11px] text-slate-600">Ref · {matchRef}</p>
              </header>

              <dl className="py-8 space-y-1">
                <CertRow label="Counterparty" value={counterparty} highlight={focusedField === "counterparty"} fieldKey="counterparty" />
                <CertRow label="Commodity" value={commodity} highlight={focusedField === "commodity"} fieldKey="commodity" />
                <CertRow label="Volume" value={volume ? `${volume} MT` : ""} mono highlight={focusedField === "volume"} fieldKey="volume" />
                <CertRow label="Price" value={price ? `USD ${price} / MT` : ""} mono highlight={focusedField === "price"} fieldKey="price" />
                <CertRow label="Incoterms" value={incoterms} mono highlight={focusedField === "incoterms"} fieldKey="incoterms" />
                <CertRow label="Notional" value={volume && price ? `USD ${(Number(volume.replace(/,/g, "")) * Number(price.replace(/,/g, ""))).toLocaleString("en-US")}` : ""} mono highlight={focusedField === "volume" || focusedField === "price"} fieldKey="notional" />
              </dl>

              <AnimatePresence>
                {notes.trim().length > 0 && <motion.div initial={{
                opacity: 0,
                height: 0
              }} animate={{
                opacity: 1,
                height: "auto"
              }} exit={{
                opacity: 0,
                height: 0
              }} transition={{
                duration: 0.25
              }} className={`overflow-hidden border-t border-slate-200 transition-colors ${focusedField === "notes" ? "bg-slate-100" : ""}`}>
                    <div className="py-6">
                      <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-800 mb-3">Notes</p>
                      <p className="text-sm text-slate-900 leading-relaxed whitespace-pre-wrap">{notes}</p>
                    </div>
                  </motion.div>}
              </AnimatePresence>

              <div className={`py-6 border-t border-slate-200 transition-colors -mx-2 px-2 rounded-sm ${focusedField === "evidence" ? "bg-slate-100" : ""}`}>
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-800 mb-4">
                  Attached Evidence
                </p>
                {docs.length === 0 ? <p className="font-mono text-xs italic text-slate-500">{PLACEHOLDER}</p> : <ul className="space-y-2">
                    <AnimatePresence initial={false}>
                      {docs.map((d, i) => <motion.li key={`${d.hash}-${i}`} initial={{
                    opacity: 0,
                    y: -3
                  }} animate={{
                    opacity: 1,
                    y: 0
                  }} exit={{
                    opacity: 0,
                    y: -3
                  }} transition={{
                    duration: 0.2
                  }} className="flex items-baseline gap-3">
                          <span className="font-mono text-[10px] text-slate-600 shrink-0">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs text-slate-900 truncate font-medium">{d.name}</p>
                            <p className="font-mono text-[10px] text-slate-600 truncate">{d.hash}</p>
                          </div>
                        </motion.li>)}
                    </AnimatePresence>
                  </ul>}
              </div>

              <div className="mt-2 pt-6 border-t border-slate-200">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-800 mb-5">
                  Security & Integrity
                </p>
                <ul className="space-y-3 font-mono text-[11px]">
                  <SealRow label="Jurisdiction Check" status="PENDING" />
                  <SealRow label="UBO Validation" status="PENDING" />
                  <SealRow label="Sanctions Screen" status="PENDING" />
                  <SealRow label="Authority Bind" status="PENDING" />
                </ul>

                <div className="mt-6 pt-5 border-t border-dashed border-slate-200">
                  <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-800 mb-3">
                    SHA-256 Seal
                    {hashing && <span className="ml-2 inline-flex items-center gap-1 text-slate-500 normal-case tracking-normal">
                        <Loader2 className="h-3 w-3 animate-spin" />
                      </span>}
                  </p>
                  <p className={`font-mono text-[11px] leading-relaxed break-all transition-colors ${certSeal ? "text-slate-900" : "text-slate-400"}`}>
                    {certSeal ?? "0".repeat(64)}
                  </p>
                </div>
              </div>

              <footer className="mt-8 pt-6 border-t border-slate-200 text-center">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-600">
                  Unsealed Draft · Not Yet Binding
                </p>
              </footer>
            </article>

            <p className="mt-6 text-center text-[11px] text-slate-600 leading-relaxed">
              The Certificate becomes immutable upon Proof of Intent generation.
            </p>
          </div>
        </div>
      </section>

      <CreditProvisioningPanel open={provisioningOpen} onClose={() => setProvisioningOpen(false)} currentBalance={creditBalance} />

      {/* ── Mobile: Slide-up Certificate Drawer ───────────────────── */}
      <ProofDrawer open={certDrawerOpen} onOpenChange={setCertDrawerOpen} triggerLabel="View Certificate" triggerKicker={matchRef} title="Certificate of Intent" subtitle="Live preview · mirrors editor" tone="ink">
        <div className="px-5 py-6">
          <article className="bg-white border border-slate-200 rounded-sm p-6">
            <header className="text-center pb-6 border-b border-slate-200">
              <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-slate-800"> Izenzo, Deal Record </p>
              <h2 className="mt-4 text-base font-semibold tracking-[0.3em] uppercase text-slate-900">
                Certificate of Intent
              </h2>
              <p className="mt-2 font-mono text-[10px] text-slate-600">Ref · {matchRef}</p>
            </header>
            <dl className="py-6 space-y-2">
              <CertRow label="Counterparty" value={counterparty} fieldKey="counterparty" />
              <CertRow label="Commodity" value={commodity} fieldKey="commodity" />
              <CertRow label="Volume" value={volume ? `${volume} MT` : ""} mono fieldKey="volume" />
              <CertRow label="Price" value={price ? `USD ${price} / MT` : ""} mono fieldKey="price" />
              <CertRow label="Incoterms" value={incoterms} mono fieldKey="incoterms" />
            </dl>
            <div className="pt-4 border-t border-dashed border-slate-200">
              <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-slate-700 mb-2">
                SHA-256 Seal
              </p>
              <p className={`font-mono text-[10px] leading-relaxed break-all ${certSeal ? "text-slate-900" : "text-slate-400"}`}>
                {certSeal ?? "0".repeat(64)}
              </p>
            </div>
          </article>
        </div>
      </ProofDrawer>
    </div>;
}

/* ────────────────────────────────────────────────────────────── */

function StepSection({
  number,
  title,
  children
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  return <section className="relative mt-20">
      <span className="absolute -left-12 top-1.5 font-mono text-[10px] tracking-[0.25em] text-slate-400 select-none">
        {String(number).padStart(2, "0")}
      </span>
      <h2 className="text-base font-medium text-slate-900 tracking-tight pb-4 border-b border-slate-200">
        {title}
      </h2>
      <div className="mt-8 space-y-8">{children}</div>
    </section>;
}
function EditorField({
  label,
  hint,
  value,
  onChange,
  onFocus,
  onBlur,
  placeholder,
  mono,
  readOnly
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  mono?: boolean;
  readOnly?: boolean;
}) {
  return <div>
      <label className="block text-[11px] font-mono tracking-[0.2em] uppercase text-slate-600 mb-3">
        {label}
      </label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} onFocus={onFocus} onBlur={onBlur} placeholder={placeholder} readOnly={readOnly} aria-readonly={readOnly} tabIndex={readOnly ? -1 : 0} className={`w-full bg-white border-0 border-b border-slate-300 px-0 py-2 text-lg text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-0 transition-colors ${mono ? "font-mono" : ""} ${readOnly ? "cursor-default pointer-events-none select-text" : ""}`} />
      {hint && <p className="mt-2 text-xs text-slate-500 leading-relaxed">{hint}</p>}
    </div>;
}
function CertRow({
  label,
  value,
  mono,
  highlight,
  fieldKey
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
  fieldKey: string;
}) {
  const filled = value.trim().length > 0;
  return <div className={`flex items-baseline gap-4 -mx-2 px-2 py-2 rounded-sm transition-colors duration-300 ${highlight ? "bg-slate-100" : ""}`}>
      <dt className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-800 w-32 shrink-0">
        {label}
      </dt>
      <dd className={`flex-1 text-sm relative min-h-[1.25rem] ${mono ? "font-mono" : ""}`}>
        <AnimatePresence mode="wait" initial={false}>
          {filled ? <motion.span key={`filled-${fieldKey}`} initial={{
          opacity: 0
        }} animate={{
          opacity: 1
        }} exit={{
          opacity: 0
        }} transition={{
          duration: 0.18
        }} className="text-slate-900 font-medium">
              {value}
            </motion.span> : <motion.span key={`empty-${fieldKey}`} initial={{
          opacity: 0
        }} animate={{
          opacity: 1
        }} exit={{
          opacity: 0
        }} transition={{
          duration: 0.18
        }} className="text-slate-500 italic font-mono text-xs">
              {PLACEHOLDER}
            </motion.span>}
        </AnimatePresence>
      </dd>
    </div>;
}
function SealRow({
  label,
  status
}: {
  label: string;
  status: string;
}) {
  return <li className="flex items-center justify-between">
      <span className="text-slate-800 tracking-wide">{label}</span>
      <span className="text-amber-700 font-medium tracking-[0.2em] text-[10px]">{status}</span>
    </li>;
}