/**
 * ComplianceProfile — Trade User identity vault.
 *
 * Editorial layout: status bar, three airy entity cards
 * (Legal Identity · Ownership & Control · Regulatory Vault),
 * and a single "Update Documentation" affordance.
 */

import { Pencil, ShieldCheck, FileText } from "lucide-react";

const LEGAL = [
  { label: "Registered Name", value: "Aurubis AG" },
  { label: "Trading As", value: "Aurubis Copper Trading" },
  { label: "Tax ID", value: "DE 814 184 419", mono: true },
  { label: "Registration No.", value: "HRB 6789 — Hamburg", mono: true },
  { label: "Jurisdiction", value: "Federal Republic of Germany" },
  { label: "Incorporation", value: "1866-04-28" },
];

const OWNERS = [
  {
    name: "Salzgitter AG",
    role: "Institutional Holder",
    pct: "29.99",
    country: "DE",
  },
  {
    name: "BlackRock, Inc.",
    role: "Asset Manager",
    pct: "5.21",
    country: "US",
  },
  {
    name: "Free Float (Public)",
    role: "Public Markets",
    pct: "64.80",
    country: "—",
  },
];

const DOCS = [
  {
    title: "SAHPRA Trade Licence",
    issued: "2024-11-12",
    expires: "2026-11-11",
    hash: "0x7f3a2b918c4d4e6f9a12b3c4d5e6f7a8b9c0d1e2",
  },
  {
    title: "KYC Export Pack",
    issued: "2025-09-04",
    expires: "2026-09-04",
    hash: "0x4d5e6f7a8b9c0d1e27f3a2b918c4d4e6f9a12b3c",
  },
  {
    title: "Beneficial Ownership Declaration",
    issued: "2025-01-22",
    expires: "2027-01-22",
    hash: "0xa12b3c4d5e6f7a8b9c0d1e27f3a2b918c4d4e6f9",
  },
  {
    title: "Sanctions & PEP Clearance",
    issued: "2026-02-18",
    expires: "2026-08-18",
    hash: "0xc0d1e27f3a2b918c4d4e6f9a12b3c4d5e6f7a8b9",
  },
];

export function ComplianceProfile() {
  return (
    <>
      {/* ── HEADER ────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-8 mb-12">
        <div>
          <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-slate-400 mb-3">
            Identity & Governance
          </p>
          <h1 className="text-4xl lg:text-5xl font-semibold text-slate-900 tracking-tight leading-tight">
            Compliance Profile
          </h1>
          <p className="mt-4 text-base text-slate-500 leading-relaxed max-w-xl">
            Your sovereign identity record. All counterparties verify against this file
            before bilateral signature.
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 inline-flex items-center gap-2 px-5 py-3 rounded-md border border-slate-300 bg-white text-sm font-medium text-slate-900 hover:border-slate-900 transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
          Update Documentation
        </button>
      </header>

      {/* ── STATUS BAR ────────────────────────────────────────── */}
      <div className="mb-16 inline-flex items-center gap-3 rounded-sm bg-amber-50 border border-amber-200 px-4 py-2.5">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-600" />
        </span>
        <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-amber-900">
          Current Status
        </span>
        <span className="h-3 w-px bg-amber-300" />
        <span className="font-mono text-[11px] tracking-[0.2em] uppercase text-amber-900 font-medium">
          Provisionally Verified
        </span>
        <span className="ml-2 font-mono text-[10px] text-amber-700">
          · Pending UBO refresh by 2026-05-01
        </span>
      </div>

      {/* ── CARDS ─────────────────────────────────────────────── */}
      <div className="space-y-8">
        {/* Card 1 · Legal Identity */}
        <article className="bg-white border border-slate-200 rounded-sm p-8 lg:p-10">
          <CardHeader
            index="01"
            title="Legal Identity"
            kicker="Registry of Record"
          />
          <dl className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-7">
            {LEGAL.map((item) => (
              <div key={item.label} className="border-b border-slate-100 pb-4">
                <dt className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-500">
                  {item.label}
                </dt>
                <dd
                  className={`mt-2 text-slate-900 font-medium ${
                    item.mono ? "font-mono text-sm" : "text-base"
                  }`}
                >
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </article>

        {/* Card 2 · Ownership & Control */}
        <article className="bg-white border border-slate-200 rounded-sm p-8 lg:p-10">
          <CardHeader
            index="02"
            title="Ownership & Control"
            kicker="Ultimate Beneficial Owners"
          />
          <ul className="mt-8 divide-y divide-slate-100">
            {OWNERS.map((owner) => (
              <li
                key={owner.name}
                className="grid grid-cols-12 gap-4 items-baseline py-5 first:pt-0 last:pb-0"
              >
                <div className="col-span-12 sm:col-span-6 min-w-0">
                  <p className="text-base text-slate-900 font-medium truncate">
                    {owner.name}
                  </p>
                  <p className="mt-1 font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500">
                    {owner.role} · {owner.country}
                  </p>
                </div>
                <div className="col-span-7 sm:col-span-4">
                  {/* Control bar */}
                  <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-slate-900"
                      style={{ width: `${Math.min(parseFloat(owner.pct), 100)}%` }}
                    />
                  </div>
                </div>
                <div className="col-span-5 sm:col-span-2 text-right">
                  <p className="font-mono text-sm text-slate-900 tabular-nums">
                    {owner.pct}%
                  </p>
                  <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-slate-500 mt-0.5">
                    Control
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between gap-4">
            <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-500">
              Aggregate Verified Ownership
            </p>
            <p className="font-mono text-sm text-slate-900 tabular-nums font-medium">
              100.00%
            </p>
          </div>
        </article>

        {/* Card 3 · Regulatory Vault */}
        <article className="bg-white border border-slate-200 rounded-sm p-8 lg:p-10">
          <CardHeader
            index="03"
            title="Regulatory Vault"
            kicker="Sealed Documents"
          />
          <ul className="mt-8 divide-y divide-slate-100">
            {DOCS.map((doc) => (
              <li
                key={doc.title}
                className="grid grid-cols-12 gap-4 items-start py-5 first:pt-0 last:pb-0"
              >
                <div className="col-span-12 sm:col-span-5 flex items-start gap-3 min-w-0">
                  <FileText
                    className="h-4 w-4 text-slate-400 shrink-0 mt-0.5"
                    strokeWidth={1.5}
                  />
                  <div className="min-w-0">
                    <p className="text-sm text-slate-900 font-medium truncate">
                      {doc.title}
                    </p>
                    <p className="mt-1 font-mono text-[10px] tracking-[0.15em] uppercase text-slate-500">
                      Issued {doc.issued} · Expires {doc.expires}
                    </p>
                  </div>
                </div>

                <div className="col-span-12 sm:col-span-5">
                  <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-slate-400 mb-1">
                    SHA-256
                  </p>
                  <p className="font-mono text-[10px] text-slate-700 break-all">
                    {doc.hash}
                  </p>
                </div>

                <div className="col-span-12 sm:col-span-2 sm:text-right">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1"
                    style={{
                      backgroundColor: "hsl(155 35% 28% / 0.08)",
                      color: "hsl(155 35% 22%)",
                    }}
                  >
                    <ShieldCheck className="h-3 w-3" strokeWidth={2} />
                    <span className="font-mono text-[9px] tracking-[0.25em] uppercase font-medium">
                      Sealed
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between gap-4">
            <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-500">
              Vault Integrity · Last Audit
            </p>
            <p className="font-mono text-[11px] text-slate-900">
              2026-04-15 09:14 UTC · Chain Verified
            </p>
          </div>
        </article>
      </div>

      {/* Footer attestation */}
      <footer className="mt-16 pt-8 border-t border-slate-200">
        <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-400">
          Custodian
        </p>
        <p className="mt-2 text-sm text-slate-700">
          This profile is held by the Izenzo Sovereign Registry under jurisdiction ZA-01.
          Counterparties may request cryptographic proof of any field via the Without-a-Doubt
          attestation endpoint.
        </p>
      </footer>
    </>
  );
}

function CardHeader({
  index,
  title,
  kicker,
}: {
  index: string;
  title: string;
  kicker: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6 pb-4 border-b border-slate-200">
      <div className="flex items-baseline gap-5">
        <span className="font-mono text-[10px] tracking-[0.25em] text-slate-400 select-none">
          {index}
        </span>
        <h2 className="text-lg font-medium text-slate-900 tracking-tight">
          {title}
        </h2>
      </div>
      <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-400">
        {kicker}
      </p>
    </div>
  );
}
