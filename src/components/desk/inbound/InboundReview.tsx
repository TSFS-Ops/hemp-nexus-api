/**
 * InboundReview — The counterparty-side review of a sealed Proof of Intent.
 *
 * Left pane: Read-only locked terms + bilateral action footer (Decline / Counter-Sign).
 * Right pane: Live WaD Certificate with asymmetric seal — initiator sealed in green,
 * counterparty slot pulsing amber awaiting signature.
 *
 * Pure presentational mockup — uses hard-coded values for demonstration.
 */

import { Link } from "react-router-dom";
import { ArrowLeft, FileText, Download, Check, X } from "lucide-react";
import { motion } from "framer-motion";

const INBOUND = {
  matchRef: "WAD-7F2A91C8",
  initiator: "Aurubis AG",
  initiatorRegistration: "REG: HRB 6789 · DE",
  initiatorHash: "9a3f8c1e4b7d2056f8e9c3a1b2d4e5f6789012345abcdef0123456789abcdef0",
  receivedAt: "2025-04-16 14:32:09 UTC",
  expiresIn: "29d 23h 41m",
  commodity: "Copper Cathode, LME Grade A",
  volume: "500",
  price: "9,420",
  incoterms: "CIF Rotterdam",
  notes: "Inspection by SGS at load port. Payment via L/C at sight.",
  documents: [
    {
      name: "Aurubis_Quality_Spec_LME_GradeA.pdf",
      hash: "4f1a8e9c2b7d6053a8e9c3a1b2d4e5f6789012345abcdef0123456789abcdef0",
    },
    {
      name: "Loading_Schedule_Hamburg_Q2.pdf",
      hash: "7d2e5f8a1c4b9056e8d9c3a1b2d4e5f6789012345abcdef0123456789abcdef0",
    },
  ],
};

const notional = (
  Number(INBOUND.volume.replace(/,/g, "")) * Number(INBOUND.price.replace(/,/g, ""))
).toLocaleString("en-US");

export function InboundReview() {
  return (
    <div className="fixed inset-y-0 inset-x-0 md:left-[250px] md:right-0 flex flex-col md:flex-row bg-white pb-16 md:pb-0">
      {/* ── LEFT PANE: Review & Action ─────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full md:w-1/2 flex flex-col md:border-r border-slate-200 bg-white"
      >
        <div className="flex-1 overflow-y-auto">
          <div className="px-16 pt-12 pb-12 max-w-2xl">
            <Link
              to="/desk"
              className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors mb-10"
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
              Back to Pipeline
            </Link>

            {/* Action-required badge */}
            <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200">
              <span className="relative flex h-1.5 w-1.5">
                <motion.span
                  className="absolute inset-0 rounded-full bg-amber-400"
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                />
                <span className="relative h-1.5 w-1.5 rounded-full bg-amber-500" />
              </span>
              <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-amber-800 font-medium">
                Action Required · Inbound Request
              </span>
            </div>

            <h1 className="text-4xl lg:text-5xl font-semibold text-slate-900 tracking-tight leading-[1.1]">
              Review Trade Intent
            </h1>
            <p className="mt-6 text-base text-slate-600 leading-relaxed max-w-lg">
              <span className="text-slate-900 font-medium">{INBOUND.initiator}</span> has generated
              a cryptographically sealed Proof of Intent and proposed the following terms.
            </p>

            <div className="mt-6 flex items-center gap-6 font-mono text-[11px] text-slate-500">
              <span>
                <span className="text-slate-400">Ref ·</span> {INBOUND.matchRef}
              </span>
              <span className="text-slate-300">|</span>
              <span>
                <span className="text-slate-400">Received ·</span> {INBOUND.receivedAt}
              </span>
              <span className="text-slate-300">|</span>
              <span>
                <span className="text-slate-400">Expires in ·</span>{" "}
                <span className="text-amber-700 font-medium">{INBOUND.expiresIn}</span>
              </span>
            </div>

            {/* ── Locked Terms ─────────────────────────────── */}
            <section className="relative mt-16">
              <span className="absolute -left-12 top-1.5 font-mono text-[10px] tracking-[0.25em] text-slate-400 select-none">
                01
              </span>
              <h2 className="text-base font-medium text-slate-900 tracking-tight pb-4 border-b border-slate-200">
                Proposed Terms
              </h2>

              <dl className="mt-8 grid grid-cols-2 gap-x-10 gap-y-7">
                <LockedField label="Counterparty" value={INBOUND.initiator} wide />
                <LockedField label="Commodity" value={INBOUND.commodity} wide />
                <LockedField label="Volume (MT)" value={INBOUND.volume} mono />
                <LockedField label="Price (USD / MT)" value={INBOUND.price} mono />
                <LockedField label="Incoterms" value={INBOUND.incoterms} mono />
                <LockedField label="Notional (USD)" value={notional} mono />
                <LockedField label="Notes" value={INBOUND.notes} wide />
              </dl>
            </section>

            {/* ── Document Review ──────────────────────────── */}
            <section className="relative mt-16">
              <span className="absolute -left-12 top-1.5 font-mono text-[10px] tracking-[0.25em] text-slate-400 select-none">
                02
              </span>
              <h2 className="text-base font-medium text-slate-900 tracking-tight pb-4 border-b border-slate-200">
                Attached Evidence
              </h2>

              <ul className="mt-8 space-y-3">
                {INBOUND.documents.map((d, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-4 rounded-md border border-slate-200 bg-white px-4 py-3"
                  >
                    <FileText className="h-4 w-4 text-slate-500 shrink-0" strokeWidth={1.5} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-900 truncate font-medium">{d.name}</p>
                      <p className="font-mono text-[11px] text-slate-500 truncate">
                        sha256:{d.hash}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>

              <button className="mt-5 inline-flex items-center gap-2 text-xs font-medium text-slate-700 hover:text-slate-900 border border-slate-200 hover:border-slate-400 rounded-md px-4 py-2.5 transition-colors">
                <Download className="h-3.5 w-3.5" strokeWidth={2} />
                Download & Verify Evidence
              </button>
            </section>
          </div>
        </div>

        {/* ── Sticky Bilateral Action Footer ────────────────── */}
        <div className="shrink-0 border-t border-slate-200 bg-white p-6">
          <div className="max-w-2xl mx-auto flex items-stretch gap-4">
            <button className="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md text-sm font-medium text-red-600 hover:bg-red-50 transition-colors">
              <X className="h-4 w-4" strokeWidth={2} />
              Decline & Release Match
            </button>
            <motion.button
              whileHover={{ scale: 0.99 }}
              whileTap={{ scale: 0.985 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="flex-1 inline-flex items-center justify-center gap-3 rounded-md bg-primary px-6 py-3.5 text-sm font-medium text-primary-foreground shadow-sm hover:shadow-md transition-shadow"
            >
              Counter-Sign & Seal Trade
              <Check className="h-4 w-4" strokeWidth={2.5} />
            </motion.button>
          </div>
          <p className="mt-3 text-center text-xs text-slate-500 leading-relaxed max-w-xl mx-auto">
            Signing this locks the commercial intent bilaterally and submits the payload to the
            9-Gate validation engine.
          </p>
        </div>
      </motion.section>

      {/* ── RIGHT PANE: Live WaD Certificate ────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut", delay: 0.05 }}
        className="hidden md:block w-1/2 bg-slate-50 overflow-hidden"
      >
        <div className="h-full p-12 overflow-y-auto flex items-start justify-center">
          <div className="w-full max-w-xl">
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-600 mb-4 text-center">
              Inbound · Pending Your Signature
            </p>

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
                  Ref · {INBOUND.matchRef}
                </p>
              </header>

              {/* Populated data */}
              <dl className="py-8 space-y-1">
                <CertRow label="Counterparty" value={INBOUND.initiator} />
                <CertRow label="Commodity" value={INBOUND.commodity} />
                <CertRow label="Volume" value={`${INBOUND.volume} MT`} mono />
                <CertRow label="Price" value={`USD ${INBOUND.price} / MT`} mono />
                <CertRow label="Incoterms" value={INBOUND.incoterms} mono />
                <CertRow label="Notional" value={`USD ${notional}`} mono />
              </dl>

              {/* Notes */}
              <div className="border-t border-slate-200 py-6">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-800 mb-3">
                  Notes
                </p>
                <p className="text-sm text-slate-900 leading-relaxed whitespace-pre-wrap">
                  {INBOUND.notes}
                </p>
              </div>

              {/* Evidence */}
              <div className="py-6 border-t border-slate-200">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-800 mb-3">
                  Attached Evidence
                </p>
                <ul className="space-y-2">
                  {INBOUND.documents.map((d, i) => (
                    <li key={i} className="flex items-baseline gap-3">
                      <span className="font-mono text-[10px] text-slate-600 shrink-0">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs text-slate-900 truncate font-medium">{d.name}</p>
                        <p className="font-mono text-[10px] text-slate-600 truncate">{d.hash}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              {/* ── Asymmetric Seal Section ─────────────────── */}
              <div className="mt-2 pt-6 border-t border-slate-200">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-800 mb-5">
                  Bilateral Cryptographic Seal
                </p>

                {/* Initiator — sealed */}
                <div className="space-y-3">
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-700">
                      Initiator · {INBOUND.initiator}
                    </p>
                    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.2em] text-emerald-700 font-medium">
                      <Check className="h-3 w-3" strokeWidth={3} />
                      SEALED
                    </span>
                  </div>
                  <p className="font-mono text-[11px] leading-relaxed break-all text-slate-900">
                    {INBOUND.initiatorHash}
                  </p>
                </div>

                {/* Counterparty — pending */}
                <div className="mt-6 pt-5 border-t border-dashed border-slate-200 space-y-3">
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-700">
                      Counterparty · You
                    </p>
                    <span className="font-mono text-[10px] tracking-[0.2em] text-amber-700 font-medium">
                      AWAITING
                    </span>
                  </div>
                  <motion.div
                    animate={{ opacity: [0.55, 1, 0.55] }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                    className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-3"
                  >
                    <p className="font-mono text-[11px] tracking-[0.15em] text-amber-800 text-center">
                      [ AWAITING YOUR CRYPTOGRAPHIC SIGNATURE ]
                    </p>
                  </motion.div>
                </div>
              </div>

              <footer className="mt-8 pt-6 border-t border-slate-200 text-center">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-700">
                  Half-Sealed · Binding Upon Counter-signature
                </p>
              </footer>
            </article>

            <p className="mt-6 text-center text-[11px] text-slate-600 leading-relaxed">
              Counter-signing triggers the 9-Gate validation engine and releases the trade to
              governance.
            </p>
          </div>
        </div>
      </motion.section>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

function LockedField({
  label,
  value,
  mono,
  wide,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <dt className="block text-[11px] font-mono tracking-[0.2em] uppercase text-slate-500 mb-2">
        {label}
      </dt>
      <dd
        className={`text-base text-slate-900 font-medium leading-relaxed ${
          mono ? "font-mono tracking-wide" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function CertRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-4 -mx-2 px-2 py-2 rounded-sm">
      <dt className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-800 w-32 shrink-0">
        {label}
      </dt>
      <dd className={`flex-1 text-sm text-slate-900 font-medium ${mono ? "font-mono" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
