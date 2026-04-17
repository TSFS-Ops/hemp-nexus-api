/**
 * TriageInbox — Governor's risk-weighted command surface.
 *
 * Layout: 40 / 60 split.
 *   LEFT  — Triage Queue. White surface, hairline divider, dense rows.
 *   RIGHT — 9-Gate Verification Matrix on slate-50 with sticky sovereign actions.
 *
 * Pure presentational mockup. No backend mutations are performed; the actions
 * surface confirmation dialogs only.
 */

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, AlertTriangle, FileText, Stamp, Flag } from "lucide-react";
import { toast } from "sonner";

/* ───────────── Types & Mock Data ───────────── */

type Risk = "high" | "medium" | "low";
type GateState = "passed" | "alert" | "pending";
type FilterKey = "all" | "high" | "cross-border";

type QueueItem = {
  id: string;
  matchUuid: string;
  partyA: string;
  partyB: string;
  commodity: string;
  notional: string;
  jurisdictionRoute: string;
  riskScore: number;
  risk: Risk;
  crossBorder: boolean;
  flag: string;
};

type EvidenceDoc = {
  label: string;
  filename: string;
  size: string;
  hash: string;
  sealed: boolean;
};

const QUEUE: QueueItem[] = [
  {
    id: "wad-7f2a91c8",
    matchUuid: "7f2a91c8-4b3d-4e21-9c11-8a3f0d2bce17",
    partyA: "Kruger Trading",
    partyB: "Aurubis AG",
    commodity: "Copper Cathode · 500 MT",
    notional: "USD 4,710,000",
    jurisdictionRoute: "ZA → DE",
    riskScore: 88,
    risk: "high",
    crossBorder: true,
    flag: "Cross-border · Non-SADC",
  },
  {
    id: "wad-3b1f04ae",
    matchUuid: "3b1f04ae-7c92-4ad5-bb02-1e6c9f4870aa",
    partyA: "KSB Mining",
    partyB: "Trafigura Pte",
    commodity: "Manganese Ore · 12,000 MT",
    notional: "USD 2,160,000",
    jurisdictionRoute: "ZA → SG",
    riskScore: 74,
    risk: "high",
    crossBorder: true,
    flag: "PEP-adjacent UBO",
  },
  {
    id: "wad-9c5d23ef",
    matchUuid: "9c5d23ef-2a18-4f0b-8d77-b3c01ea66f29",
    partyA: "BHP Billiton",
    partyB: "Glencore International",
    commodity: "Iron Ore Fines · 80,000 MT",
    notional: "USD 8,400,000",
    jurisdictionRoute: "AU → CH",
    riskScore: 62,
    risk: "medium",
    crossBorder: true,
    flag: "High notional",
  },
  {
    id: "wad-1e8a47bc",
    matchUuid: "1e8a47bc-6d34-4392-a5fc-9b8e4f2c1d05",
    partyA: "Rio Tinto",
    partyB: "Norsk Hydro",
    commodity: "Bauxite · 25,000 MT",
    notional: "USD 1,875,000",
    jurisdictionRoute: "AU → NO",
    riskScore: 55,
    risk: "medium",
    crossBorder: true,
    flag: "Sanctions watchlist proximity",
  },
  {
    id: "wad-4f0c91d2",
    matchUuid: "4f0c91d2-8e76-4a91-bc41-2f53d8b91e0c",
    partyA: "Sasol Chemicals",
    partyB: "Engen Petroleum",
    commodity: "Polypropylene · 1,200 MT",
    notional: "ZAR 18,400,000",
    jurisdictionRoute: "ZA → ZA",
    riskScore: 24,
    risk: "low",
    crossBorder: false,
    flag: "Domestic · Low risk",
  },
];

const GATES: Array<{ id: string; label: string; state: GateState; note?: string }> = [
  { id: "01", label: "GATE_01_BILATERAL_SEAL", state: "passed" },
  { id: "02", label: "GATE_02_PAYLOAD_HASH", state: "passed" },
  { id: "03", label: "GATE_03_SANCTIONS_SCREEN", state: "passed" },
  {
    id: "04",
    label: "GATE_04_JURISDICTION",
    state: "alert",
    note: "Manual Review Required — Non-SADC route flagged.",
  },
  { id: "05", label: "GATE_05_UBO_VALIDATION", state: "passed" },
  { id: "06", label: "GATE_06_AUTHORITY_BIND", state: "passed" },
  { id: "07", label: "GATE_07_DOC_INTEGRITY", state: "passed" },
  { id: "08", label: "GATE_08_GOVERNOR_SIGNATURE", state: "pending" },
  { id: "09", label: "GATE_09_WAD_ISSUANCE", state: "pending" },
];

const EVIDENCE: EvidenceDoc[] = [
  {
    label: "SAHPRA Section 22C License",
    filename: "sahpra-22c-2026.pdf",
    size: "412 KB",
    hash: "8f3c7e1a9b04d2f6c8e7a1b3d5f2a4c9e1b8d7c6a5f4e3b2d1c0a9b8e7d6c5f4",
    sealed: true,
  },
  {
    label: "Bill of Lading · MAEU-983412",
    filename: "bol-maeu-983412.pdf",
    size: "187 KB",
    hash: "9a3f8c1e5d72bc04ef02a8f7c1e3d5b6a4f2e1c8d7b0a9e6f5d4c3b2a1f0e9d8",
    sealed: true,
  },
  {
    label: "Commercial Invoice",
    filename: "invoice-kt-aurubis-2026.pdf",
    size: "94 KB",
    hash: "c1e4d8b3f7a902e5d6c8b7a1f4e3d2c5b8a7e6f5d4c3b2a1e0d9c8b7a6f5e4d3",
    sealed: true,
  },
  {
    label: "KYC Export Pack",
    filename: "kyc-export-aurubis.zip",
    size: "1.4 MB",
    hash: "e2d5b8f1c4a7039d6e8b1f4c7a2e5d8b1c4f7a0e3d6b9c2f5a8e1d4c7b0a3f6",
    sealed: true,
  },
];

/* ───────────── Component ───────────── */

export default function TriageInbox() {
  const [activeId, setActiveId] = useState<string>(QUEUE[0].id);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [alertAcknowledged, setAlertAcknowledged] = useState(false);

  const filtered = useMemo(() => {
    if (filter === "high") return QUEUE.filter((q) => q.risk === "high");
    if (filter === "cross-border") return QUEUE.filter((q) => q.crossBorder);
    return QUEUE;
  }, [filter]);

  const active = QUEUE.find((q) => q.id === activeId)!;

  function selectItem(id: string) {
    if (id === activeId) return;
    setActiveId(id);
    setAlertAcknowledged(false);
  }

  function handleReject() {
    toast.error(`${active.matchUuid.slice(0, 8)} flagged. Entity escalated for investigation.`, {
      description: "Counterparties have been notified. POI revoked.",
    });
  }

  function handleSeal() {
    toast.success(`WaD certificate issued for ${active.matchUuid.slice(0, 8)}`, {
      description: "Cryptographically sealed. All counterparties notified.",
    });
  }

  return (
    <div className="fixed inset-y-0 inset-x-0 md:left-[260px] md:right-0 flex flex-col md:flex-row bg-white pb-16 md:pb-0">
      {/* ── LEFT PANE: Risk Queue (40%) ─────────────────────────── */}
      <section className="w-full md:w-2/5 max-h-[40vh] md:max-h-none flex flex-col md:border-r border-b md:border-b-0 border-slate-200 bg-white">
        <div className="px-10 pt-12 pb-6">
          <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-slate-500 mb-3">
            Governance Layer
          </p>
          <h1 className="text-3xl font-semibold text-slate-900 tracking-tight leading-[1.1]">
            Triage Queue
          </h1>

          {/* Status toggle */}
          <div className="mt-6 inline-flex items-center gap-px rounded-sm border border-slate-200 bg-slate-50 p-0.5">
            {([
              { key: "all", label: "All" },
              { key: "high", label: "High Risk" },
              { key: "cross-border", label: "Cross-Border" },
            ] as Array<{ key: FilterKey; label: string }>).map((opt) => {
              const active = filter === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => setFilter(opt.key)}
                  className={`px-3 py-1.5 font-mono text-[10px] tracking-[0.15em] uppercase rounded-sm transition-colors ${
                    active
                      ? "bg-white text-slate-900 shadow-[0_1px_0_rgba(0,0,0,0.04)]"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <p className="mt-4 font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">
            {filtered.length} pending · {QUEUE.filter((q) => q.risk === "high").length} flagged high
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-8">
          {filtered.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="font-mono text-[11px] tracking-wider uppercase text-slate-400">
                No trades match this filter.
              </p>
            </div>
          ) : (
            <ul className="space-y-1">
              {filtered.map((item) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  active={item.id === activeId}
                  onClick={() => selectItem(item.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── RIGHT PANE: 9-Gate Auditor (60%) ────────────────────── */}
      <section className="w-full md:w-3/5 flex-1 flex flex-col bg-slate-50">
        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={active.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="p-12 max-w-4xl"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-8 mb-10 pb-8 border-b border-slate-200">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-500 mb-2">
                    Reviewing
                  </p>
                  <h2 className="text-2xl font-semibold text-slate-900 tracking-tight">
                    {active.partyA} <span className="text-slate-400">↔</span> {active.partyB}
                  </h2>
                  <p className="mt-2 font-mono text-[11px] text-slate-500 tracking-wide break-all">
                    {active.matchUuid}
                  </p>
                  <p className="mt-3 text-sm text-slate-600">
                    {active.commodity} ·{" "}
                    <span className="font-mono text-slate-900">{active.notional}</span> ·{" "}
                    <span className="font-mono text-slate-900">{active.jurisdictionRoute}</span>
                  </p>
                </div>
                <RiskBadge risk={active.risk} score={active.riskScore} large />
              </div>

              {/* Section 01 — 9-Gate Matrix */}
              <Section number="01" title="9-Gate Verification Matrix">
                <div className="grid grid-cols-3 gap-2 md:gap-3">
                  {GATES.map((gate) => (
                    <GateBlock
                      key={gate.id}
                      gate={gate}
                      acknowledged={gate.state === "alert" && alertAcknowledged}
                      onAcknowledge={
                        gate.state === "alert"
                          ? () => setAlertAcknowledged((v) => !v)
                          : undefined
                      }
                    />
                  ))}
                </div>
              </Section>

              {/* Section 02 — Evidence Feed */}
              <Section number="02" title="Evidence Feed">
                <div className="rounded-sm border border-slate-200 bg-white divide-y divide-slate-100">
                  {EVIDENCE.map((doc) => (
                    <div key={doc.filename} className="flex items-start gap-4 p-5">
                      <FileText className="h-4 w-4 mt-0.5 text-slate-400 shrink-0" strokeWidth={1.5} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-4">
                          <p className="text-sm font-medium text-slate-900 truncate">{doc.label}</p>
                          {doc.sealed && (
                            <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-emerald-700">
                              Sealed
                            </span>
                          )}
                        </div>
                        <p className="mt-1 font-mono text-[10px] text-slate-500">
                          {doc.filename} · {doc.size}
                        </p>
                        <p className="mt-2 font-mono text-[10px] text-slate-400 break-all leading-relaxed">
                          sha256: {doc.hash}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Sticky Sovereign Action Footer */}
        <div className="shrink-0 border-t border-slate-200 bg-white px-12 py-6">
          <div className="max-w-4xl flex items-center justify-between gap-6">
            <button
              onClick={handleReject}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-md text-sm font-medium text-red-600 border border-red-200 hover:bg-red-50 transition-colors"
            >
              <Flag className="h-4 w-4" strokeWidth={2} />
              Reject &amp; Flag Entity
            </button>

            <motion.button
              onClick={handleSeal}
              whileHover={alertAcknowledged ? { scale: 0.99 } : undefined}
              whileTap={alertAcknowledged ? { scale: 0.985 } : undefined}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              disabled={!alertAcknowledged}
              className={`inline-flex items-center gap-2.5 rounded-md px-6 py-3 text-sm font-medium transition-all ${
                alertAcknowledged
                  ? "bg-primary text-primary-foreground shadow-sm hover:shadow-md"
                  : "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
              }`}
            >
              <Stamp className="h-4 w-4" strokeWidth={2} />
              Seal &amp; Issue WaD Certificate
            </motion.button>
          </div>
          <p className="mt-3 max-w-4xl font-mono text-[10px] tracking-wider text-slate-500 leading-relaxed">
            {alertAcknowledged
              ? "Clicking Seal will cryptographically sign this record and notify all counterparties."
              : "Acknowledge the Gate 04 alert above to enable WaD issuance."}
          </p>
        </div>
      </section>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

function QueueRow({
  item,
  active,
  onClick,
}: {
  item: QueueItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full text-left relative px-5 py-4 rounded-sm transition-colors ${
          active ? "bg-slate-50" : "hover:bg-slate-50/60"
        }`}
      >
        {active && (
          <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-primary rounded-r-sm" />
        )}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-900 font-medium truncate">
              {item.partyA} <span className="text-slate-400">↔</span> {item.partyB}
            </p>
            <p className="mt-1 text-xs text-slate-600 truncate">
              {item.commodity} · <span className="font-mono">{item.notional}</span>
            </p>
            <div className="mt-2 flex items-center gap-2 font-mono text-[10px] text-slate-500">
              <span className="truncate">{item.matchUuid.slice(0, 18)}…</span>
              <span className="text-slate-300">·</span>
              <span>{item.jurisdictionRoute}</span>
            </div>
          </div>
          <RiskBadge risk={item.risk} score={item.riskScore} />
        </div>
        <p className="mt-2 text-[11px] text-slate-500 italic">{item.flag}</p>
      </button>
    </li>
  );
}

function RiskBadge({
  risk,
  score,
  large,
}: {
  risk: Risk;
  score: number;
  large?: boolean;
}) {
  const tone =
    risk === "high"
      ? { ring: "ring-red-200", text: "text-red-700", bg: "bg-red-50", label: "High Risk" }
      : risk === "medium"
        ? { ring: "ring-amber-200", text: "text-amber-700", bg: "bg-amber-50", label: "Medium Risk" }
        : { ring: "ring-emerald-200", text: "text-emerald-700", bg: "bg-emerald-50", label: "Low Risk" };

  const sizeCircle = large ? "h-14 w-14 text-base" : "h-9 w-9 text-[11px]";

  return (
    <div className="flex flex-col items-end gap-1.5 shrink-0">
      <div
        className={`${sizeCircle} ${tone.bg} ${tone.text} rounded-full ring-1 ${tone.ring} flex items-center justify-center font-mono font-medium tabular-nums`}
      >
        {score}
      </div>
      <span className={`font-mono text-[9px] tracking-[0.2em] uppercase font-medium ${tone.text}`}>
        {tone.label}
      </span>
    </div>
  );
}

function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="relative mt-12 first:mt-0">
      <span className="absolute -left-10 top-1.5 font-mono text-[10px] tracking-[0.25em] text-slate-400 select-none">
        {number}
      </span>
      <h3 className="text-base font-medium text-slate-900 tracking-tight pb-3 border-b border-slate-200 mb-6">
        {title}
      </h3>
      {children}
    </section>
  );
}

function GateBlock({
  gate,
  acknowledged,
  onAcknowledge,
}: {
  gate: { id: string; label: string; state: GateState; note?: string };
  acknowledged?: boolean;
  onAcknowledge?: () => void;
}) {
  const isAlert = gate.state === "alert";
  const isPassed = gate.state === "passed";
  const effectivePassed = isPassed || (isAlert && acknowledged);

  return (
    <div
      className={`rounded-sm border p-4 transition-colors ${
        effectivePassed
          ? "border-emerald-200 bg-white"
          : isAlert
            ? "border-amber-300 bg-amber-50/60"
            : "border-slate-200 bg-slate-50/70 opacity-70"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {effectivePassed ? (
            <div className="h-5 w-5 rounded-full bg-emerald-700 flex items-center justify-center">
              <Check className="h-3 w-3 text-white" strokeWidth={3} />
            </div>
          ) : isAlert ? (
            <div className="relative h-5 w-5 flex items-center justify-center">
              <motion.span
                className="absolute inset-0 rounded-full bg-amber-400/30"
                animate={{ scale: [1, 1.6, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
              />
              <div className="relative h-5 w-5 rounded-full bg-amber-500 flex items-center justify-center">
                <AlertTriangle className="h-2.5 w-2.5 text-white" strokeWidth={3} />
              </div>
            </div>
          ) : (
            <div className="h-5 w-5 rounded-full border border-slate-300" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p
            className={`font-mono text-[10px] tracking-wider font-medium leading-tight ${
              effectivePassed ? "text-slate-900" : isAlert ? "text-amber-900" : "text-slate-500"
            }`}
          >
            {gate.label}
          </p>
          {isAlert && (
            <>
              <p className="mt-1.5 text-[10px] text-amber-800 leading-relaxed">{gate.note}</p>
              {onAcknowledge && (
                <button
                  onClick={onAcknowledge}
                  className="mt-2 text-[10px] font-medium text-amber-900 hover:text-amber-950 underline underline-offset-2"
                >
                  {acknowledged ? "✓ Acknowledged" : "Acknowledge"}
                </button>
              )}
            </>
          )}
          {gate.state === "pending" && !effectivePassed && (
            <p className="mt-1 font-mono text-[9px] tracking-wider uppercase text-slate-400">
              Awaiting Gate 04
            </p>
          )}
        </div>
      </div>
    </div>
  );
}