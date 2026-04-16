/**
 * MatchCompiler — Split-screen Deal Editor + WaD Certificate preview.
 *
 * Left pane: scrollable, editorial inputs with bottom-border-only fields.
 * Right pane: sticky, monospace-heavy Certificate of Intent that mirrors
 * the user's inputs in real time. Pure presentational mockup — no mutations.
 */

import { useMemo, useState, useRef, ChangeEvent, DragEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, UploadCloud, FileText, X } from "lucide-react";

type AttachedDoc = {
  name: string;
  size: number;
  hash: string; // mocked SHA-256
};

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
  const [docs, setDocs] = useState<AttachedDoc[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const matchRef = useMemo(
    () => (matchId ? matchId.slice(0, 8).toUpperCase() : "DRAFT-000"),
    [matchId]
  );

  const certSeal = useMemo(() => {
    const payload = [commodity, volume, price, incoterms, counterparty, ...docs.map((d) => d.hash)].join("|");
    return payload.trim().length > 0 ? mockSha256(payload) : null;
  }, [commodity, volume, price, incoterms, counterparty, docs]);

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
        <div className="p-12 pb-40 max-w-2xl">
          <Link
            to="/desk"
            className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors mb-10"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            Back to Pipeline
          </Link>

          <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-slate-400 mb-3">
            Match · {matchRef}
          </p>
          <h1 className="text-4xl lg:text-5xl font-semibold text-slate-900 tracking-tight leading-tight">
            Draft Commercial Terms
          </h1>
          <p className="mt-5 text-base text-slate-500 leading-relaxed max-w-lg">
            Structure the trade. Each field below is mirrored in the Certificate of Intent
            to your right and sealed when you generate the Proof.
          </p>

          {/* ── Inputs ───────────────────────────────────────────── */}
          <div className="mt-16 space-y-10">
            <EditorField
              label="Counterparty"
              hint="The legal entity you intend to trade with."
              value={counterparty}
              onChange={setCounterparty}
              placeholder="e.g. Aurubis AG"
            />
            <EditorField
              label="Commodity"
              hint="Specific grade or product description."
              value={commodity}
              onChange={setCommodity}
              placeholder="e.g. Copper Cathode, LME Grade A"
            />
            <div className="grid grid-cols-2 gap-10">
              <EditorField
                label="Volume (MT)"
                hint="Metric tonnes."
                value={volume}
                onChange={setVolume}
                placeholder="500"
                mono
              />
              <EditorField
                label="Price (USD)"
                hint="Per metric tonne."
                value={price}
                onChange={setPrice}
                placeholder="9,420"
                mono
              />
            </div>
            <EditorField
              label="Delivery Incoterms"
              hint="Incoterms 2020 — e.g. FOB, CIF, DAP."
              value={incoterms}
              onChange={setIncoterms}
              placeholder="CIF Rotterdam"
            />
          </div>

          {/* ── Document Upload ──────────────────────────────────── */}
          <div className="mt-16">
            <label className="block text-xs font-mono tracking-[0.2em] uppercase text-slate-500 mb-4">
              Supporting Documents
            </label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`cursor-pointer rounded-md border border-dashed p-10 text-center transition-colors ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-white"
              }`}
            >
              <UploadCloud className="h-6 w-6 mx-auto text-slate-400" strokeWidth={1.5} />
              <p className="mt-4 text-sm text-slate-600 font-medium">
                Drag and drop supporting documents
              </p>
              <p className="mt-1 text-xs text-slate-400">PDF, DOCX · Each file is hashed on attach</p>
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
                {docs.map((d, i) => (
                  <li
                    key={`${d.name}-${i}`}
                    className="flex items-center gap-4 rounded-md border border-slate-200 bg-white px-4 py-3"
                  >
                    <FileText className="h-4 w-4 text-slate-400 shrink-0" strokeWidth={1.5} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-900 truncate">{d.name}</p>
                      <p className="font-mono text-[11px] text-slate-400 truncate">
                        sha256:{shortHash(d.hash)}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDocs((prev) => prev.filter((_, idx) => idx !== i));
                      }}
                      className="text-slate-400 hover:text-slate-900 transition-colors"
                      aria-label={`Remove ${d.name}`}
                    >
                      <X className="h-4 w-4" strokeWidth={2} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* ── Sticky Footer Action ──────────────────────────────── */}
        <div className="sticky bottom-0 left-0 right-0 border-t border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
          <div className="max-w-2xl px-12 py-6 flex items-center justify-between gap-6">
            <p className="text-xs text-slate-500 leading-relaxed max-w-xs">
              This action atomically consumes 1 credit and permanently seals the trade intent.
            </p>
            <button className="shrink-0 inline-flex items-center gap-3 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
              Generate Proof of Intent
              <span className="font-mono text-[11px] tracking-wider opacity-70">1 CREDIT</span>
            </button>
          </div>
        </div>
      </section>

      {/* ── RIGHT PANE: Certificate Preview ─────────────────────── */}
      <section className="w-1/2 bg-[#F8FAFC] overflow-hidden">
        <div className="h-full p-12 overflow-y-auto flex items-start justify-center">
          <div className="w-full max-w-xl">
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-400 mb-4 text-center">
              Live Preview · Mirrors Left Pane
            </p>

            {/* Physical document card */}
            <article className="bg-white rounded-sm shadow-sm border border-slate-200/60 p-12">
              {/* Header */}
              <header className="text-center pb-8 border-b border-slate-200">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-400">
                  Izenzo Sovereign Infrastructure — Deal Record
                </p>
                <h2 className="mt-6 text-xl font-semibold tracking-[0.3em] uppercase text-slate-900">
                  Certificate of Intent
                </h2>
                <p className="mt-3 font-mono text-[11px] text-slate-400">
                  Ref · {matchRef}
                </p>
              </header>

              {/* Dynamic data */}
              <dl className="py-8 space-y-5">
                <CertRow label="Counterparty" value={counterparty} />
                <CertRow label="Commodity" value={commodity} />
                <CertRow label="Volume" value={volume ? `${volume} MT` : ""} mono />
                <CertRow label="Price" value={price ? `USD ${price} / MT` : ""} mono />
                <CertRow label="Incoterms" value={incoterms} mono />
                <CertRow
                  label="Notional"
                  value={
                    volume && price
                      ? `USD ${(Number(volume.replace(/,/g, "")) * Number(price.replace(/,/g, ""))).toLocaleString("en-US")}`
                      : ""
                  }
                  mono
                />
              </dl>

              {/* Document hashes */}
              <div className="py-6 border-t border-slate-200">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-400 mb-4">
                  Attached Evidence
                </p>
                {docs.length === 0 ? (
                  <p className="font-mono text-xs text-slate-400">{PLACEHOLDER}</p>
                ) : (
                  <ul className="space-y-2">
                    {docs.map((d, i) => (
                      <li key={i} className="flex items-baseline gap-3">
                        <span className="font-mono text-[10px] text-slate-400 shrink-0">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs text-slate-700 truncate">{d.name}</p>
                          <p className="font-mono text-[10px] text-slate-400 truncate">
                            {d.hash}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Cryptographic Seal */}
              <div className="mt-2 pt-6 border-t border-slate-200">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-400 mb-5">
                  Security & Integrity
                </p>
                <ul className="space-y-3 font-mono text-[11px]">
                  <SealRow label="Jurisdiction Check" status="PENDING" />
                  <SealRow label="UBO Validation" status="PENDING" />
                  <SealRow label="Sanctions Screen" status="PENDING" />
                  <SealRow label="Authority Bind" status="PENDING" />
                </ul>

                <div className="mt-6 pt-5 border-t border-dashed border-slate-200">
                  <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-400 mb-3">
                    SHA-256 Seal
                  </p>
                  <p
                    className={`font-mono text-[11px] leading-relaxed break-all ${
                      certSeal ? "text-slate-900" : "text-slate-300"
                    }`}
                  >
                    {certSeal ?? "0".repeat(64)}
                  </p>
                </div>
              </div>

              <footer className="mt-8 pt-6 border-t border-slate-200 text-center">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-300">
                  Unsealed Draft · Not Yet Binding
                </p>
              </footer>
            </article>

            <p className="mt-6 text-center text-[11px] text-slate-400 leading-relaxed">
              The Certificate becomes immutable upon Proof of Intent generation.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

function EditorField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-mono tracking-[0.2em] uppercase text-slate-500 mb-3">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-transparent border-0 border-b border-slate-200 px-0 py-2 text-lg text-slate-900 placeholder:text-slate-300 focus:border-primary focus:outline-none focus:ring-0 transition-colors ${
          mono ? "font-mono" : ""
        }`}
      />
      {hint && <p className="mt-2 text-xs text-slate-400 leading-relaxed">{hint}</p>}
    </div>
  );
}

function CertRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const filled = value.trim().length > 0;
  return (
    <div className="flex items-baseline gap-4">
      <dt className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-400 w-32 shrink-0">
        {label}
      </dt>
      <dd
        className={`flex-1 text-sm ${mono ? "font-mono" : ""} ${
          filled ? "text-slate-900" : "text-slate-300 font-mono text-xs"
        }`}
      >
        {filled ? value : PLACEHOLDER}
      </dd>
    </div>
  );
}

function SealRow({ label, status }: { label: string; status: string }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-slate-500 tracking-wide">{label}</span>
      <span className="text-amber-600 tracking-[0.2em] text-[10px]">{status}</span>
    </li>
  );
}
