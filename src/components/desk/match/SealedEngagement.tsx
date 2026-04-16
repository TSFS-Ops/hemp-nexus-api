/**
 * SealedEngagement — Post-POI cryptographic ledger view.
 *
 * Left pane: Engagement Hold-Point timeline tracking counterparty movements
 * + locked, read-only commercial terms.
 * Right pane: Live WaD Certificate with sealed values and pending issuance.
 *
 * Pure presentational mockup — uses hard-coded values for demonstration.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, Mail } from "lucide-react";
import { motion } from "framer-motion";

// Mock sealed deal payload — would normally come from URL state / DB
const SEALED = {
  matchRef: "WAD-7F2A91C8",
  counterparty: "Aurubis AG",
  commodity: "Copper Cathode, LME Grade A",
  volume: "500",
  price: "9,420",
  incoterms: "CIF Rotterdam",
  notes: "Inspection by SGS at load port. Payment via L/C at sight.",
  sealedAt: "2025-04-16 14:32:07 UTC",
  notifiedAt: "2025-04-16 14:32:09 UTC",
  payloadHash: "9a3f8c1e4b7d2056f8e9c3a1b2d4e5f6789012345abcdef0123456789abcdef0",
  evidenceCount: 3,
};

const EXPIRES_AT = Date.now() + 30 * 24 * 60 * 60 * 1000 - 60_000; // ~29d 23h 59m

function fmtCountdown(msRemaining: number) {
  if (msRemaining <= 0) return "Expired";
  const totalSec = Math.floor(msRemaining / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

const notional = (
  Number(SEALED.volume.replace(/,/g, "")) * Number(SEALED.price.replace(/,/g, ""))
).toLocaleString("en-US");

export function SealedEngagement() {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const countdown = useMemo(() => fmtCountdown(EXPIRES_AT - now), [now]);

  return (
    <div className="fixed inset-y-0 left-[250px] right-0 flex bg-white">
      {/* ── LEFT PANE: Engagement Tracker ───────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-1/2 overflow-y-auto border-r border-slate-200 bg-white"
      >
        <div className="px-16 pt-12 pb-24 max-w-2xl">
          <Link
            to="/desk"
            className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors mb-12"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            Back to Pipeline
          </Link>

          <div className="flex items-center gap-3 mb-3">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
            <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-slate-500">
              Match · {SEALED.matchRef}
            </p>
          </div>
          <h1 className="text-4xl lg:text-5xl font-semibold text-slate-900 tracking-tight leading-[1.1]">
            Engagement Hold-Point
          </h1>
          <p className="mt-6 text-base text-slate-600 leading-relaxed max-w-lg">
            The Proof of Intent has been cryptographically sealed. The counterparty has been
            notified and the deal is locked pending their response.
          </p>

          <div className="mt-8 inline-flex items-baseline gap-3 rounded-md border border-slate-200 bg-slate-50 px-5 py-3">
            <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-500">
              Auto-expires in
            </span>
            <span className="font-mono text-sm tracking-wider text-slate-900 tabular-nums">
              {countdown}
            </span>
          </div>

          {/* ── Timeline ────────────────────────────────────────── */}
          <section className="relative mt-20">
            <span className="absolute -left-12 top-1.5 font-mono text-[10px] tracking-[0.25em] text-slate-400 select-none">
              01
            </span>
            <h2 className="text-base font-medium text-slate-900 tracking-tight pb-4 border-b border-slate-200">
              Counterparty Tracker
            </h2>

            <ol className="mt-10 relative">
              {/* vertical rail */}
              <div className="absolute left-[11px] top-3 bottom-3 w-px bg-slate-200" aria-hidden />

              <TimelineNode
                state="completed"
                title="Proof of Intent Sealed"
                timestamp={SEALED.sealedAt}
                detail={
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono">−1 CREDIT</span>
                    <span className="text-slate-300">·</span>
                    <span>R10.00 burn receipt</span>
                    <span className="text-slate-300">·</span>
                    <span className="font-mono">{SEALED.matchRef}</span>
                  </div>
                }
              />
              <TimelineNode
                state="completed"
                title="Counterparty Notified"
                timestamp={SEALED.notifiedAt}
                detail={
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Mail className="h-3 w-3" strokeWidth={1.75} />
                    Dual-path email & in-app alerts dispatched
                  </div>
                }
              />
              <TimelineNode
                state="active"
                title="Awaiting Counterparty Acceptance"
                timestamp="In progress"
                detail={
                  <div className="text-xs text-slate-500 leading-relaxed">
                    The initiating party may not self-confirm. The deal is held until{" "}
                    <span className="text-slate-700 font-medium">{SEALED.counterparty}</span>{" "}
                    responds or the 30-day window elapses.
                  </div>
                }
              />
            </ol>
          </section>

          {/* ── Locked Terms ────────────────────────────────────── */}
          <section className="relative mt-20">
            <span className="absolute -left-12 top-1.5 font-mono text-[10px] tracking-[0.25em] text-slate-400 select-none">
              02
            </span>
            <h2 className="text-base font-medium text-slate-900 tracking-tight pb-4 border-b border-slate-200">
              Locked Commercial Terms
            </h2>

            <dl className="mt-10 space-y-7">
              <LockedField label="Counterparty" value={SEALED.counterparty} />
              <LockedField label="Commodity" value={SEALED.commodity} />
              <div className="grid grid-cols-2 gap-10">
                <LockedField label="Volume (MT)" value={SEALED.volume} mono />
                <LockedField label="Price (USD / MT)" value={SEALED.price} mono />
              </div>
              <LockedField label="Delivery Incoterms" value={SEALED.incoterms} mono />
              <LockedField label="Notional (USD)" value={notional} mono />
              <LockedField label="Notes" value={SEALED.notes} />
            </dl>
          </section>
        </div>
      </motion.section>

      {/* ── RIGHT PANE: Live WaD Certificate ────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut", delay: 0.05 }}
        className="w-1/2 bg-slate-50 overflow-hidden"
      >
        <div className="h-full p-12 overflow-y-auto flex items-start justify-center">
          <div className="w-full max-w-xl">
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-600 mb-4 text-center">
              Sealed · Cryptographic Record
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
                <p className="mt-3 font-mono text-[11px] text-slate-600">Ref · {SEALED.matchRef}</p>
              </header>

              {/* Sealed data */}
              <dl className="py-8 space-y-1">
                <CertRow label="Counterparty" value={SEALED.counterparty} />
                <CertRow label="Commodity" value={SEALED.commodity} />
                <CertRow label="Volume" value={`${SEALED.volume} MT`} mono />
                <CertRow label="Price" value={`USD ${SEALED.price} / MT`} mono />
                <CertRow label="Incoterms" value={SEALED.incoterms} mono />
                <CertRow label="Notional" value={`USD ${notional}`} mono />
              </dl>

              {/* Notes */}
              <div className="border-t border-slate-200 py-6">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-800 mb-3">
                  Notes
                </p>
                <p className="text-sm text-slate-900 leading-relaxed whitespace-pre-wrap">
                  {SEALED.notes}
                </p>
              </div>

              {/* Evidence */}
              <div className="py-6 border-t border-slate-200">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-800 mb-3">
                  Attached Evidence
                </p>
                <p className="text-sm text-slate-900">
                  {SEALED.evidenceCount} document{SEALED.evidenceCount === 1 ? "" : "s"} bound to
                  this certificate
                </p>
              </div>

              {/* Cryptographic Seal */}
              <div className="mt-2 pt-6 border-t border-slate-200">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-800 mb-5">
                  Security & Integrity
                </p>
                <ul className="space-y-3 font-mono text-[11px]">
                  <SealRow label="Jurisdiction Check" status="VERIFIED" tone="ok" />
                  <SealRow label="UBO Validation" status="VERIFIED" tone="ok" />
                  <SealRow label="Sanctions Screen" status="CLEARED" tone="ok" />
                  <SealRow label="Authority Bind" status="VERIFIED" tone="ok" />
                </ul>

                <div className="mt-6 pt-5 border-t border-dashed border-slate-200">
                  <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-800 mb-3">
                    POI Payload Hash
                  </p>
                  <p className="font-mono text-[11px] leading-relaxed break-all text-slate-900">
                    {SEALED.payloadHash}
                  </p>
                </div>

                <div className="mt-6 pt-5 border-t border-dashed border-slate-200">
                  <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-800 mb-3">
                    WaD Issuance Status
                  </p>
                  <p className="font-mono text-[11px] tracking-[0.2em] text-amber-700 font-medium">
                    PENDING COUNTERPARTY SIGNATURE
                  </p>
                </div>
              </div>

              <footer className="mt-8 pt-6 border-t border-slate-200 text-center">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-700">
                  Sealed Draft · Binding Upon Counter-signature
                </p>
              </footer>
            </article>

            <p className="mt-6 text-center text-[11px] text-slate-600 leading-relaxed">
              This certificate is immutable. Any amendment requires a new Proof of Intent.
            </p>
          </div>
        </div>
      </motion.section>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

function TimelineNode({
  state,
  title,
  timestamp,
  detail,
}: {
  state: "completed" | "active";
  title: string;
  timestamp: string;
  detail: React.ReactNode;
}) {
  const isActive = state === "active";
  return (
    <li className="relative pl-10 pb-10 last:pb-0">
      {/* Node dot */}
      <div className="absolute left-0 top-0.5 z-10">
        {isActive ? (
          <div className="relative flex items-center justify-center w-[23px] h-[23px]">
            <motion.span
              className="absolute inset-0 rounded-full bg-amber-400/30"
              animate={{ scale: [1, 1.6, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
            />
            <span className="relative h-3 w-3 rounded-full bg-amber-500 ring-4 ring-white" />
          </div>
        ) : (
          <div className="flex items-center justify-center w-[23px] h-[23px] rounded-full bg-emerald-700 ring-4 ring-white">
            <Check className="h-3 w-3 text-white" strokeWidth={3} />
          </div>
        )}
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-4">
          <h3
            className={`text-sm font-medium tracking-tight ${
              isActive ? "text-amber-800" : "text-slate-900"
            }`}
          >
            {title}
          </h3>
          <span className="font-mono text-[10px] text-slate-500 tracking-wide shrink-0">
            {timestamp}
          </span>
        </div>
        <div className="mt-2">{detail}</div>
      </div>
    </li>
  );
}

function LockedField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="block text-[11px] font-mono tracking-[0.2em] uppercase text-slate-400 mb-2">
        {label}
      </dt>
      <dd
        className={`text-base text-slate-900 leading-relaxed ${
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

function SealRow({
  label,
  status,
  tone = "pending",
}: {
  label: string;
  status: string;
  tone?: "ok" | "pending";
}) {
  const toneClass =
    tone === "ok" ? "text-emerald-700" : "text-amber-700";
  return (
    <li className="flex items-center justify-between">
      <span className="text-slate-800 tracking-wide">{label}</span>
      <span className={`font-medium tracking-[0.2em] text-[10px] ${toneClass}`}>{status}</span>
    </li>
  );
}
