/**
 * ComplianceProfile — Trade User identity vault.
 *
 * Editorial layout: header + ghost action, full-width status banner,
 * three airy white cards (Registered Identity · Ownership · Regulatory
 * Evidence). Slate-50 page background lets the white cards lift.
 */

import { Check } from "lucide-react";

const LEGAL = [
  { label: "Legal Name", value: "Aurubis AG" },
  { label: "Trading As", value: "Aurubis Copper Trading" },
  { label: "Reg Number", value: "HRB 6789 — Hamburg", mono: true },
  { label: "VAT Number", value: "DE 814 184 419", mono: true },
  {
    label: "Registered Address",
    value: "Hovestraße 50, 20539 Hamburg, Germany",
    full: true,
  },
  { label: "Jurisdiction", value: "Federal Republic of Germany" },
];

const OWNERS = [
  { name: "Salzgitter AG", role: "Institutional Holder · DE", pct: "29.99" },
  { name: "BlackRock, Inc.", role: "Asset Manager · US", pct: "5.21" },
  { name: "Free Float (Public)", role: "Public Markets", pct: "64.80" },
];

const DOCS = [
  {
    title: "SAHPRA Section 22C Licence",
    expires: "2026-11-11",
    hash: "0x7f3a2b918c4d4e6f9a12b3c4d5e6f7a8b9c0d1e2",
  },
  {
    title: "KYC Export Pack",
    expires: "2026-09-04",
    hash: "0x4d5e6f7a8b9c0d1e27f3a2b918c4d4e6f9a12b3c",
  },
  {
    title: "Beneficial Ownership Declaration",
    expires: "2027-01-22",
    hash: "0xa12b3c4d5e6f7a8b9c0d1e27f3a2b918c4d4e6f9",
  },
  {
    title: "Sanctions & PEP Clearance",
    expires: "2026-08-18",
    hash: "0xc0d1e27f3a2b918c4d4e6f9a12b3c4d5e6f7a8b9",
  },
];

export function ComplianceProfile() {
  return (
    <>
      {/* ── HEADER ────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-8 mb-10">
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
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors border-b border-transparent hover:border-slate-900"
        >
          Request Data Update
        </button>
      </header>

      {/* ── STATUS BANNER ─────────────────────────────────────── */}
      <div className="mb-12 flex items-center justify-between gap-6 px-6 py-4 bg-white border border-slate-200 rounded-sm">
        <div className="flex items-baseline gap-4">
          <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-500">
            Entity Status
          </p>
          <span className="font-mono text-[10px] text-slate-400">
            Last review · 2026-04-15 09:14 UTC
          </span>
        </div>
        <span
          className="inline-flex items-center gap-2 rounded-sm px-3 py-1.5"
          style={{
            backgroundColor: "hsl(38 92% 50% / 0.08)",
            color: "hsl(28 80% 30%)",
          }}
        >
          <span className="relative flex h-1.5 w-1.5">
            <span
              className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-50"
              style={{ backgroundColor: "hsl(38 92% 50%)" }}
            />
            <span
              className="relative inline-flex rounded-full h-1.5 w-1.5"
              style={{ backgroundColor: "hsl(28 80% 40%)" }}
            />
          </span>
          <span className="font-mono text-[10px] tracking-[0.25em] uppercase font-medium">
            Provisionally Verified
          </span>
        </span>
      </div>

      {/* ── CARDS ─────────────────────────────────────────────── */}
      <div className="space-y-6">
        {/* Card 1 · Registered Identity */}
        <article className="bg-white border border-slate-200 rounded-sm p-8 lg:p-10">
          <CardHeader index="01" title="Registered Identity" kicker="Statutory Record" />
          <dl className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-7">
            {LEGAL.map((item) => (
              <div
                key={item.label}
                className={`border-b border-slate-100 pb-4 ${
                  item.full ? "sm:col-span-2" : ""
                }`}
              >
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

        {/* Card 2 · Ownership (UBO) */}
        <article className="bg-white border border-slate-200 rounded-sm p-8 lg:p-10">
          <CardHeader
            index="02"
            title="Ownership (UBO)"
            kicker="Ultimate Beneficial Owners"
          />
          <ul className="mt-8 divide-y divide-slate-100">
            {OWNERS.map((owner) => (
              <li
                key={owner.name}
                className="grid grid-cols-12 gap-4 items-center py-5 first:pt-0 last:pb-0"
              >
                <div className="col-span-12 sm:col-span-7 flex items-center gap-3 min-w-0">
                  <span
                    className="inline-flex items-center justify-center h-5 w-5 rounded-full shrink-0"
                    style={{
                      backgroundColor: "hsl(155 35% 28% / 0.1)",
                      color: "hsl(155 35% 25%)",
                    }}
                    aria-label="Verified"
                  >
                    <Check className="h-3 w-3" strokeWidth={2.5} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-base text-slate-900 font-medium truncate">
                      {owner.name}
                    </p>
                    <p className="mt-1 font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500">
                      {owner.role}
                    </p>
                  </div>
                </div>
                <div className="col-span-12 sm:col-span-5 sm:text-right">
                  <p className="font-mono text-base text-slate-900 tabular-nums font-medium">
                    {owner.pct}%
                  </p>
                  <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 mt-0.5">
                    Ownership
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

        {/* Card 3 · Regulatory Evidence */}
        <article className="bg-white border border-slate-200 rounded-sm p-8 lg:p-10">
          <CardHeader index="03" title="Regulatory Evidence" kicker="Active Licences" />
          <ul className="mt-8 divide-y divide-slate-100">
            {DOCS.map((doc) => (
              <li
                key={doc.title}
                className="grid grid-cols-12 gap-4 items-start py-5 first:pt-0 last:pb-0"
              >
                <div className="col-span-12 sm:col-span-5 min-w-0">
                  <p className="text-sm text-slate-900 font-medium truncate">
                    {doc.title}
                  </p>
                  <p className="mt-1 font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500">
                    Expires {doc.expires}
                  </p>
                </div>

                <div className="col-span-12 sm:col-span-6">
                  <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-slate-400 mb-1">
                    SHA-256
                  </p>
                  <p className="font-mono text-[10px] text-slate-700 break-all leading-snug">
                    {doc.hash}
                  </p>
                </div>

                <div className="col-span-12 sm:col-span-1 sm:text-right">
                  <span
                    className="inline-flex items-center justify-center h-5 w-5 rounded-full"
                    style={{
                      backgroundColor: "hsl(155 35% 28% / 0.1)",
                      color: "hsl(155 35% 25%)",
                    }}
                    aria-label="Sealed"
                  >
                    <Check className="h-3 w-3" strokeWidth={2.5} />
                  </span>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between gap-4">
            <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-500">
              Vault Integrity · Chain Verified
            </p>
            <p className="font-mono text-[11px] text-slate-900">
              4 documents sealed
            </p>
          </div>
        </article>
      </div>

      {/* Footer attestation */}
      <footer className="mt-12 pt-8 border-t border-slate-200">
        <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-400">
          Custodian
        </p>
        <p className="mt-2 text-sm text-slate-700 leading-relaxed max-w-2xl">
          This profile is held by the Izenzo Sovereign Registry under jurisdiction ZA-01.
          Counterparties may request cryptographic proof of any field via the
          Without-a-Doubt attestation endpoint.
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
        <h2 className="text-lg font-medium text-slate-900 tracking-tight">{title}</h2>
      </div>
      <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-400">
        {kicker}
      </p>
    </div>
  );
}
