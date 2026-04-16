import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { FileText, Code, Share2, ShieldCheck, Check } from "lucide-react";
import { useMemo } from "react";

/* ----------------------------- mock data ----------------------------- */

const MOCK_TERMS = [
  { label: "COMMODITY", value: "Copper Cathode, Grade A (LME)" },
  { label: "VOLUME", value: "500 MT (±2%)" },
  { label: "UNIT PRICE", value: "USD 9,420.00 / MT" },
  { label: "TOTAL CONSIDERATION", value: "USD 4,710,000.00" },
  { label: "INCOTERMS", value: "CIF Rotterdam (Incoterms® 2020)" },
  { label: "PAYMENT TERMS", value: "Irrevocable LC at Sight" },
  { label: "INITIATOR", value: "Aurubis AG (DE / HRB 6789)" },
  { label: "COUNTERPARTY", value: "Kruger Trading (Pty) Ltd (ZA / 2018/123456/07)" },
  { label: "EXECUTION DATE", value: "16 April 2026, 21:14 UTC" },
  { label: "JURISDICTION", value: "England & Wales (Arbitration: LCIA)" },
];

const GATES = [
  { id: "GATE_01", label: "Bilateral Signatures Verified" },
  { id: "GATE_02", label: "Token Burn Recorded (R10 ZAR)" },
  { id: "GATE_03", label: "KYB Status Cleared (Both Parties)" },
  { id: "GATE_04", label: "Jurisdiction & Sanctions Reviewed" },
  { id: "GATE_05", label: "UBO & Authority Records Bound" },
  { id: "GATE_06", label: "Commercial Terms Hash-Locked" },
  { id: "GATE_07", label: "Document Integrity Verified" },
  { id: "GATE_08", label: "Audit Trail Sealed (NTP Anchored)" },
  { id: "GATE_09", label: "WaD Certificate Issued by Governor" },
];

function mockHash(seed: string, length = 64) {
  // Deterministic mock SHA-256 (visual only).
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h << 5) - h + seed.charCodeAt(i);
    h |= 0;
  }
  const base = Math.abs(h).toString(16).padStart(8, "0");
  let out = "";
  while (out.length < length) {
    out += base + (out.length).toString(16).padStart(2, "0");
  }
  return "0x" + out.slice(0, length);
}

/* ----------------------------- view ----------------------------- */

export function EvidencePackView() {
  const { id } = useParams();
  const matchId = id || "wad-7f3a2b91-8c4d-4e6f-9a12-b3c4d5e6f7a8";
  const issuedAt = "2026-04-16T21:14:08Z";
  const payloadHash = useMemo(() => mockHash(matchId), [matchId]);

  return (
    <div className="min-h-screen w-full bg-slate-900 py-16 px-6 lg:px-12">
      {/* Vault header strip */}
      <div className="max-w-[920px] mx-auto mb-10 flex items-center justify-between">
        <div className="flex items-center gap-3 text-slate-400">
          <ShieldCheck className="h-4 w-4" strokeWidth={1.5} />
          <span className="font-mono text-[10px] tracking-[0.3em] uppercase">
            Sovereign Vault · Immutable Record
          </span>
        </div>
        <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-500">
          REF · {matchId.slice(0, 8).toUpperCase()}
        </span>
      </div>

      {/* The document — printing animation */}
      <motion.article
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        className="relative max-w-[920px] mx-auto bg-white rounded-none shadow-[0_40px_120px_-30px_rgba(0,0,0,0.6)]"
        style={{
          // Double-line certificate border (1px outer, 3px inset gap, 1px inner)
          boxShadow:
            "0 0 0 1px hsl(215 16% 85%), 0 0 0 4px white, 0 0 0 5px hsl(215 16% 85%), 0 40px 120px -30px rgba(0,0,0,0.6)",
        }}
      >
        <div className="p-10 sm:p-14 lg:p-16">
          {/* Header row */}
          <header className="flex items-start justify-between gap-8 pb-10 border-b border-slate-200">
            <div>
              <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-900 font-medium">
                Izenzo Sovereign Infrastructure
              </p>
              <p className="mt-1 font-mono text-[9px] tracking-[0.25em] uppercase text-slate-400">
                Without-a-Doubt · Issuance Authority
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-slate-400">
                Match UUID
              </p>
              <p className="mt-1 font-mono text-[10px] text-slate-900 break-all max-w-[260px]">
                {matchId}
              </p>
            </div>
          </header>

          {/* Title + seal */}
          <div className="py-14 text-center">
            <p className="font-mono text-[10px] tracking-[0.4em] uppercase text-slate-400 mb-4">
              Certificate Class — WaD/A
            </p>
            <h1 className="text-3xl sm:text-4xl font-semibold text-slate-900 tracking-[0.2em] uppercase leading-tight">
              Attestation of
              <br />
              Commercial Intent
            </h1>

            {/* Stamp */}
            <motion.div
              initial={{ scale: 1.5, opacity: 0, rotate: -8 }}
              animate={{ scale: 1, opacity: 1, rotate: -6 }}
              transition={{
                delay: 0.7,
                duration: 0.45,
                ease: [0.34, 1.56, 0.64, 1],
              }}
              className="mt-12 inline-flex flex-col items-center justify-center"
            >
              <div
                className="relative h-44 w-44 rounded-full flex flex-col items-center justify-center"
                style={{
                  border: "2px solid hsl(155 35% 28%)",
                  boxShadow: "inset 0 0 0 4px white, inset 0 0 0 5px hsl(155 35% 28% / 0.4)",
                }}
              >
                <p
                  className="font-mono text-[9px] tracking-[0.3em] uppercase mb-2"
                  style={{ color: "hsl(155 35% 28%)" }}
                >
                  Issued & Sealed
                </p>
                <p
                  className="text-base font-semibold tracking-[0.15em] uppercase"
                  style={{ color: "hsl(155 35% 28%)" }}
                >
                  Without
                </p>
                <p
                  className="text-base font-semibold tracking-[0.15em] uppercase"
                  style={{ color: "hsl(155 35% 28%)" }}
                >
                  a Doubt
                </p>
                <p
                  className="mt-2 font-mono text-[8px] tracking-[0.2em] uppercase"
                  style={{ color: "hsl(155 35% 28%)" }}
                >
                  {issuedAt}
                </p>
              </div>
            </motion.div>
          </div>

          {/* Verified terms grid */}
          <section className="pt-4 pb-10 border-t border-slate-200">
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-400 mb-6">
              I · Verified Commercial Terms
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-6">
              {MOCK_TERMS.map((t) => (
                <div key={t.label} className="border-b border-slate-100 pb-3">
                  <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-400">
                    {t.label}
                  </p>
                  <p className="mt-1 text-sm text-slate-900 font-medium">
                    {t.value}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* 9-Gate audit trail */}
          <section className="pt-10 pb-4 border-t border-slate-200">
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-400 mb-6">
              II · 9-Gate Cryptographic Proof
            </p>
            <ul className="space-y-3">
              {GATES.map((gate, idx) => (
                <li
                  key={gate.id}
                  className="flex items-start gap-4 py-2 border-b border-slate-100 last:border-b-0"
                >
                  <span
                    className="mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full shrink-0"
                    style={{ backgroundColor: "hsl(155 35% 28%)" }}
                  >
                    <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                  </span>
                  <div className="flex-1 min-w-0 grid grid-cols-12 gap-3 items-center">
                    <div className="col-span-12 sm:col-span-4">
                      <p className="font-mono text-[10px] tracking-[0.15em] uppercase text-slate-900 font-medium">
                        {gate.id}
                      </p>
                    </div>
                    <div className="col-span-12 sm:col-span-4">
                      <p className="text-[11px] text-slate-600">{gate.label}</p>
                    </div>
                    <div className="col-span-12 sm:col-span-4 text-right">
                      <p className="font-mono text-[8px] text-slate-400 break-all">
                        {mockHash(gate.id + matchId, 40)}
                      </p>
                    </div>
                  </div>
                  <span className="font-mono text-[8px] text-slate-300 tabular-nums shrink-0">
                    {String(idx + 1).padStart(2, "0")}/09
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Integrity footer */}
          <footer className="mt-12 pt-8 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-8">
            <div>
              <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-400 mb-2">
                Payload Hash (SHA-256)
              </p>
              <p className="font-mono text-[10px] text-slate-900 break-all">
                {payloadHash}
              </p>
            </div>
            <div className="sm:text-right">
              <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-400 mb-2">
                Issuance Authority
              </p>
              <p className="text-sm text-slate-900 font-medium">
                Izenzo Governor — Node ZA-01
              </p>
              <p className="font-mono text-[10px] text-slate-500 mt-1">
                NTP-anchored · time.cloudflare.com
              </p>
            </div>
          </footer>
        </div>
      </motion.article>

      {/* Floating control bar */}
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1.1, duration: 0.4, ease: "easeOut" }}
        className="sticky bottom-8 mt-12 mx-auto w-fit"
      >
        <div className="bg-slate-800/80 backdrop-blur-md border border-slate-700/60 rounded-full px-3 py-2 flex items-center gap-1 shadow-2xl">
          <VaultAction icon={<FileText className="h-4 w-4" strokeWidth={1.5} />}>
            Download PDF Evidence
          </VaultAction>
          <span className="h-5 w-px bg-slate-700/80" />
          <VaultAction icon={<Code className="h-4 w-4" strokeWidth={1.5} />}>
            Export Raw Ledger (JSON)
          </VaultAction>
          <span className="h-5 w-px bg-slate-700/80" />
          <VaultAction icon={<Share2 className="h-4 w-4" strokeWidth={1.5} />}>
            Share Secure Link
          </VaultAction>
        </div>
      </motion.div>
    </div>
  );
}

function VaultAction({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12px] text-slate-200 hover:bg-slate-700/60 hover:text-white transition-colors"
    >
      {icon}
      <span className="tracking-wide">{children}</span>
    </button>
  );
}
