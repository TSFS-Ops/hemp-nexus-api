/**
 * MatchCompiler — Split-screen Deal Editor + WaD Certificate preview.
 *
 * Editorial layout: numbered marginalia, fillable contract-style inputs,
 * inline signature CTA at the foot of the document, and Framer Motion
 * micro-interactions linking left-pane focus to right-pane highlight.
 */

import { useMemo, useState, useRef, ChangeEvent, DragEvent, ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, UploadCloud, FileText, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { CreditProvisioningPanel } from "./CreditProvisioningPanel";

type AttachedDoc = {
  name: string;
  size: number;
  hash: string; // mocked SHA-256
};

type FieldKey =
  | "counterparty"
  | "commodity"
  | "volume"
  | "price"
  | "incoterms"
  | "notional"
  | "notes"
  | "evidence"
  | null;

// Deterministic mock SHA-256 (visual only — not a real hash)
function mockSha256(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const hex = h.toString(16).padStart(8, "0");
  return (hex + hex + hex + hex + hex + hex + hex + hex).slice(0, 64);
}

function shortHash(h: string) {
  return `${h.slice(0, 10)}…${h.slice(-10)}`;
}

const PLACEHOLDER = "[ Awaiting Input ]";

export function MatchCompiler() {
  const { matchId } = useParams<{ matchId: string }>();

  const [commodity, setCommodity] = useState("");
  const [volume, setVolume] = useState("");
  const [price, setPrice] = useState("");
  const [incoterms, setIncoterms] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [notes, setNotes] = useState("");
  const [docs, setDocs] = useState<AttachedDoc[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [focusedField, setFocusedField] = useState<FieldKey>(null);
  const [provisioningOpen, setProvisioningOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mocked: in production this comes from the user's token balance
  const creditBalance = 0;

  const matchRef = useMemo(
    () => (matchId && matchId !== "new" ? matchId.slice(0, 8).toUpperCase() : "DRAFT-000"),
    [matchId]
  );

  const certSeal = useMemo(() => {
    const payload = [commodity, volume, price, incoterms, counterparty, notes, ...docs.map((d) => d.hash)].join("|");
    return payload.trim().length > 0 ? mockSha256(payload) : null;
  }, [commodity, volume, price, incoterms, counterparty, notes, docs]);

  function handleFiles(files: FileList | null) {
    if (!files) return;
    const next: AttachedDoc[] = Array.from(files).map((f) => ({
      name: f.name,
      size: f.size,
      hash: mockSha256(`${f.name}:${f.size}:${f.lastModified}`),
    }));
    setDocs((prev) => [...prev, ...next]);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div className="fixed inset-y-0 left-[250px] right-0 flex bg-white">
      {/* ── LEFT PANE: Deal Editor ─────────────────────────────── */}
      <section className="w-1/2 overflow-y-auto border-r border-slate-200 bg-white">
        <div className="px-16 pt-12 pb-24 max-w-2xl">
          <Link
            to="/desk"
            className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors mb-12"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            Back to Pipeline
          </Link>

          <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-slate-500 mb-3">
            Match · {matchRef}
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
            <EditorField
              label="Counterparty"
              hint="Must exactly match the verified legal entity name."
              value={counterparty}
              onChange={setCounterparty}
              onFocus={() => setFocusedField("counterparty")}
              onBlur={() => setFocusedField(null)}
              placeholder="Aurubis AG"
            />
            <EditorField
              label="Commodity"
              hint="Specific grade or product description, including quality spec."
              value={commodity}
              onChange={setCommodity}
              onFocus={() => setFocusedField("commodity")}
              onBlur={() => setFocusedField(null)}
              placeholder="Copper Cathode, LME Grade A"
            />
            <div className="grid grid-cols-2 gap-10">
              <EditorField
                label="Volume (MT)"
                hint="Metric tonnes. Numeric only."
                value={volume}
                onChange={setVolume}
                onFocus={() => setFocusedField("volume")}
                onBlur={() => setFocusedField(null)}
                placeholder="500"
                mono
              />
              <EditorField
                label="Price (USD / MT)"
                hint="Unit price per metric tonne."
                value={price}
                onChange={setPrice}
                onFocus={() => setFocusedField("price")}
                onBlur={() => setFocusedField(null)}
                placeholder="9,420"
                mono
              />
            </div>
            <EditorField
              label="Delivery Incoterms"
              hint="Incoterms 2020 standard — e.g. FOB, CIF, DAP, with named port."
              value={incoterms}
              onChange={setIncoterms}
              onFocus={() => setFocusedField("incoterms")}
              onBlur={() => setFocusedField(null)}
              placeholder="CIF Rotterdam"
            />
          </StepSection>

          {/* ── STEP 2: Supporting Documents ──────────────────── */}
          <StepSection number={2} title="Supporting Documents">
            <p className="text-sm text-slate-600 leading-relaxed -mt-2">
              Attach evidence — each file is hashed on attach and bound to the certificate.
            </p>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              onMouseEnter={() => setFocusedField("evidence")}
              onMouseLeave={() => setFocusedField(null)}
              className={`cursor-pointer rounded-md border border-dashed p-10 text-center transition-colors ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50"
              }`}
            >
              <UploadCloud className="h-6 w-6 mx-auto text-slate-500" strokeWidth={1.5} />
              <p className="mt-4 text-sm text-slate-700 font-medium">
                Drag and drop supporting documents
              </p>
              <p className="mt-1 text-xs text-slate-500">
                PDF, DOCX · Each file is hashed on attach
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.doc"
                className="hidden"
                onChange={(e: ChangeEvent<HTMLInputElement>) => handleFiles(e.target.files)}
              />
            </div>

            {docs.length > 0 && (
              <ul className="mt-6 space-y-3">
                <AnimatePresence initial={false}>
                  {docs.map((d, i) => (
                    <motion.li
                      key={`${d.name}-${i}`}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.2 }}
                      className="flex items-center gap-4 rounded-md border border-slate-200 bg-white px-4 py-3"
                    >
                      <FileText className="h-4 w-4 text-slate-500 shrink-0" strokeWidth={1.5} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-900 truncate font-medium">{d.name}</p>
                        <p className="font-mono text-[11px] text-slate-500 truncate">
                          sha256:{shortHash(d.hash)}
                        </p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDocs((prev) => prev.filter((_, idx) => idx !== i));
                        }}
                        className="text-slate-500 hover:text-slate-900 transition-colors"
                        aria-label={`Remove ${d.name}`}
                      >
                        <X className="h-4 w-4" strokeWidth={2} />
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </StepSection>

          {/* ── STEP 3: Additional Notes ──────────────────────── */}
          <StepSection number={3} title="Additional Notes">
            <div>
              <label className="block text-[11px] font-mono tracking-[0.2em] uppercase text-slate-600 mb-3">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onFocus={() => setFocusedField("notes")}
                onBlur={() => setFocusedField(null)}
                placeholder="Inspection by SGS at load port. Payment via L/C at sight."
                rows={4}
                className="w-full bg-white border-0 border-b border-slate-300 px-0 py-2 text-base text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-0 transition-colors resize-none"
              />
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
            <motion.button
              whileHover={{ scale: 0.99 }}
              whileTap={{ scale: 0.985 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              onClick={() => {
                if (creditBalance < 1) {
                  setProvisioningOpen(true);
                  return;
                }
                // TODO: real POI generation flow
              }}
              className="w-full inline-flex items-center justify-center gap-3 rounded-md bg-primary px-6 py-4 text-sm font-medium text-primary-foreground shadow-sm hover:shadow-md transition-shadow"
            >
              Generate Proof of Intent
              <span className="font-mono text-[11px] tracking-wider opacity-80">1 CREDIT</span>
            </motion.button>
            <p className="mt-4 text-center text-xs text-slate-500 leading-relaxed max-w-md mx-auto">
              This action atomically consumes 1 credit and permanently seals the trade intent.
            </p>
          </div>
        </div>
      </section>

      {/* ── RIGHT PANE: Certificate Preview ─────────────────────── */}
      <section className="w-1/2 bg-slate-50 overflow-hidden">
        <div className="h-full p-12 overflow-y-auto flex items-start justify-center">
          <div className="w-full max-w-xl">
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-600 mb-4 text-center">
              Live Preview · Mirrors Left Pane
            </p>

            {/* Physical document card */}
            <article className="bg-white rounded-sm shadow-md border border-slate-200 p-12">
              {/* Header */}
              <header className="text-center pb-8 border-b border-slate-200">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-800">
                  Izenzo Sovereign Infrastructure — Deal Record
                </p>
                <h2 className="mt-6 text-xl font-semibold tracking-[0.3em] uppercase text-slate-900">
                  Certificate of Intent
                </h2>
                <p className="mt-3 font-mono text-[11px] text-slate-600">
                  Ref · {matchRef}
                </p>
              </header>

              {/* Dynamic data */}
              <dl className="py-8 space-y-1">
                <CertRow label="Counterparty" value={counterparty} highlight={focusedField === "counterparty"} fieldKey="counterparty" />
                <CertRow label="Commodity" value={commodity} highlight={focusedField === "commodity"} fieldKey="commodity" />
                <CertRow label="Volume" value={volume ? `${volume} MT` : ""} mono highlight={focusedField === "volume"} fieldKey="volume" />
                <CertRow label="Price" value={price ? `USD ${price} / MT` : ""} mono highlight={focusedField === "price"} fieldKey="price" />
                <CertRow label="Incoterms" value={incoterms} mono highlight={focusedField === "incoterms"} fieldKey="incoterms" />
                <CertRow
                  label="Notional"
                  value={
                    volume && price
                      ? `USD ${(Number(volume.replace(/,/g, "")) * Number(price.replace(/,/g, ""))).toLocaleString("en-US")}`
                      : ""
                  }
                  mono
                  highlight={focusedField === "volume" || focusedField === "price"}
                  fieldKey="notional"
                />
              </dl>

              {/* Notes */}
              <AnimatePresence>
                {notes.trim().length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25 }}
                    className={`overflow-hidden border-t border-slate-200 transition-colors ${
                      focusedField === "notes" ? "bg-slate-100" : ""
                    }`}
                  >
                    <div className="py-6">
                      <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-800 mb-3">
                        Notes
                      </p>
                      <p className="text-sm text-slate-900 leading-relaxed whitespace-pre-wrap">
                        {notes}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Document hashes */}
              <div
                className={`py-6 border-t border-slate-200 transition-colors -mx-2 px-2 rounded-sm ${
                  focusedField === "evidence" ? "bg-slate-100" : ""
                }`}
              >
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-800 mb-4">
                  Attached Evidence
                </p>
                {docs.length === 0 ? (
                  <p className="font-mono text-xs italic text-slate-500">{PLACEHOLDER}</p>
                ) : (
                  <ul className="space-y-2">
                    <AnimatePresence initial={false}>
                      {docs.map((d, i) => (
                        <motion.li
                          key={`${d.hash}-${i}`}
                          initial={{ opacity: 0, y: -3 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -3 }}
                          transition={{ duration: 0.2 }}
                          className="flex items-baseline gap-3"
                        >
                          <span className="font-mono text-[10px] text-slate-600 shrink-0">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs text-slate-900 truncate font-medium">{d.name}</p>
                            <p className="font-mono text-[10px] text-slate-600 truncate">
                              {d.hash}
                            </p>
                          </div>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                )}
              </div>

              {/* Cryptographic Seal */}
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
                  </p>
                  <p
                    className={`font-mono text-[11px] leading-relaxed break-all transition-colors ${
                      certSeal ? "text-slate-900" : "text-slate-400"
                    }`}
                  >
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
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

function StepSection({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="relative mt-20">
      {/* Marginalia number — pulled into left margin */}
      <span className="absolute -left-12 top-1.5 font-mono text-[10px] tracking-[0.25em] text-slate-400 select-none">
        {String(number).padStart(2, "0")}
      </span>
      <h2 className="text-base font-medium text-slate-900 tracking-tight pb-4 border-b border-slate-200">
        {title}
      </h2>
      <div className="mt-8 space-y-8">{children}</div>
    </section>
  );
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
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-[11px] font-mono tracking-[0.2em] uppercase text-slate-600 mb-3">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        className={`w-full bg-white border-0 border-b border-slate-300 px-0 py-2 text-lg text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-0 transition-colors ${
          mono ? "font-mono" : ""
        }`}
      />
      {hint && <p className="mt-2 text-xs text-slate-500 leading-relaxed">{hint}</p>}
    </div>
  );
}

function CertRow({
  label,
  value,
  mono,
  highlight,
  fieldKey,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
  fieldKey: string;
}) {
  const filled = value.trim().length > 0;
  return (
    <div
      className={`flex items-baseline gap-4 -mx-2 px-2 py-2 rounded-sm transition-colors duration-300 ${
        highlight ? "bg-slate-100" : ""
      }`}
    >
      <dt className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-800 w-32 shrink-0">
        {label}
      </dt>
      <dd className={`flex-1 text-sm relative min-h-[1.25rem] ${mono ? "font-mono" : ""}`}>
        <AnimatePresence mode="wait" initial={false}>
          {filled ? (
            <motion.span
              key={`filled-${fieldKey}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="text-slate-900 font-medium"
            >
              {value}
            </motion.span>
          ) : (
            <motion.span
              key={`empty-${fieldKey}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="text-slate-500 italic font-mono text-xs"
            >
              {PLACEHOLDER}
            </motion.span>
          )}
        </AnimatePresence>
      </dd>
    </div>
  );
}

function SealRow({ label, status }: { label: string; status: string }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-slate-800 tracking-wide">{label}</span>
      <span className="text-amber-700 font-medium tracking-[0.2em] text-[10px]">{status}</span>
    </li>
  );
}
