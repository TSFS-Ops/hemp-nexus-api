import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Env = "production" | "sandbox";

interface EnvCtx {
  env: Env;
  setEnv: (e: Env) => void;
}

const Ctx = createContext<EnvCtx>({ env: "sandbox", setEnv: () => {} });
const STORAGE_KEY = "izenzo:dev-env";

export function EnvProvider({ children }: { children: ReactNode }) {
  // Sandbox is the safer default. We persist the choice so a hard refresh
  // does not silently flip an operator from Live to Sandbox (or vice-versa).
  const [env, setEnvState] = useState<Env>(() => {
    if (typeof window === "undefined") return "sandbox";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "production" || stored === "sandbox" ? stored : "sandbox";
  });

  const setEnv = (next: Env) => {
    setEnvState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* localStorage unavailable — non-fatal */
    }
  };

  return <Ctx.Provider value={{ env, setEnv }}>{children}</Ctx.Provider>;
}

export const useEnv = () => useContext(Ctx);

/**
 * EnvSwitcher — compact toggle for the page header.
 * The full-width banner + comparison panel live in <EnvModeBanner />
 * and <EnvModeComparison /> below, so the toggle stays small here.
 */
export function EnvSwitcher() {
  const { env, setEnv } = useEnv();
  const isProd = env === "production";

  return (
    <div
      className={[
        "inline-flex items-center rounded-full p-0.5 transition-colors",
        isProd
          ? "border border-red-500/60 bg-red-500/5"
          : "border border-slate-700 bg-slate-900",
      ].join(" ")}
      role="group"
      aria-label="API environment"
    >
      <button
        onClick={() => setEnv("production")}
        aria-pressed={isProd}
        className={[
          "px-3 py-1 rounded-full font-mono text-[10px] uppercase tracking-[0.18em] transition-colors",
          isProd
            ? "border border-red-500/70 text-red-500 bg-red-500/10"
            : "border border-transparent text-slate-500 hover:text-slate-300",
        ].join(" ")}
      >
        ● live
      </button>
      <button
        onClick={() => setEnv("sandbox")}
        aria-pressed={!isProd}
        className={[
          "px-3 py-1 rounded-full font-mono text-[10px] uppercase tracking-[0.18em] transition-colors",
          !isProd
            ? "border border-slate-100/80 text-slate-100 bg-slate-800"
            : "border border-transparent text-slate-500 hover:text-slate-300",
        ].join(" ")}
      >
        ○ sandbox
      </button>
    </div>
  );
}

/**
 * EnvModeBanner — a persistent, full-width strip that sits at the very top
 * of every Developer Centre view. Its job is to make the current mode
 * impossible to miss before any destructive action (creating a key,
 * firing a Try-it request, replaying a webhook, etc.).
 *
 * In Live: red rail, pulsing dot, blunt copy that real records and real
 * billing are in scope.
 * In Sandbox: emerald rail, calmer copy, reassurance that nothing is
 * settled or charged.
 */
export function EnvModeBanner() {
  const { env, setEnv } = useEnv();
  const isProd = env === "production";

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        "rounded-sm border px-4 py-3 flex items-center justify-between gap-4 flex-wrap",
        isProd
          ? "border-red-500/50 bg-red-500/5"
          : "border-emerald-500/40 bg-emerald-500/5",
      ].join(" ")}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          {isProd && (
            <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-60 animate-ping" />
          )}
          <span
            className={[
              "relative inline-flex h-2.5 w-2.5 rounded-full",
              isProd ? "bg-red-500" : "bg-emerald-400",
            ].join(" ")}
          />
        </span>
        <div className="min-w-0">
          <div
            className={[
              "font-mono text-[10px] uppercase tracking-[0.22em]",
              isProd ? "text-red-400" : "text-emerald-400",
            ].join(" ")}
          >
            {isProd ? "live mode · production" : "sandbox mode · safe playground"}
          </div>
          <p
            className="text-[12.5px] text-slate-200 leading-snug mt-0.5"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            {isProd ? (
              <>
                Real records. Real counterparties. <span className="text-red-300 font-medium">Real credit burns.</span>{" "}
                Every write affects production data and may trigger emails, webhooks and billing.
              </>
            ) : (
              <>
                Synthetic data. No real counterparties contacted, no credits burned, no webhooks fired
                to your live endpoints. Safe to experiment freely.
              </>
            )}
          </p>
        </div>
      </div>

      <button
        onClick={() => setEnv(isProd ? "sandbox" : "production")}
        className={[
          "shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] px-3 py-1.5 rounded-sm border transition-colors",
          isProd
            ? "text-red-200 border-red-500/40 hover:bg-red-500/10"
            : "text-emerald-200 border-emerald-500/40 hover:bg-emerald-500/10",
        ].join(" ")}
      >
        Switch to {isProd ? "sandbox" : "live"}
      </button>
    </div>
  );
}

/**
 * EnvModeComparison — collapsible side-by-side that spells out exactly
 * what is different between sandbox and live, row by row. Sits below the
 * walkthrough panel on the Keys view (where the env switcher lives), so
 * a new operator can decide which mode they actually want before doing
 * anything irreversible.
 */
const COMPARISON: Array<{
  area: string;
  sandbox: string;
  live: string;
}> = [
  {
    area: "Key prefix",
    sandbox: "sk_test_…",
    live: "sk_live_…",
  },
  {
    area: "Counterparties",
    sandbox: "Synthetic / seed only — no real organisations are contacted.",
    live: "Real organisations on the platform. They will see your trade requests and engagements.",
  },
  {
    area: "Credit balance",
    sandbox: "Unlimited test credits. Burns are simulated, no charge.",
    live: "Burns from your actual USD credit balance ($1.00 per credit). Tops up via Paystack.",
  },
  {
    area: "POI generation",
    sandbox: "Mints into a test ledger. Hashes, attestations and seals are real format, not legally binding.",
    live: "Mints into the production ledger. POIs are binding artefacts referenced by WaD evidence packs.",
  },
  {
    area: "Webhooks",
    sandbox: "Delivered only to endpoints you have flagged as test. Replay-protected. Failures do not auto-disable.",
    live: "Delivered to your registered production endpoints. Auto-disable after exhausted retries (blocks WaD Gate 10).",
  },
  {
    area: "Email & Slack",
    sandbox: "Suppressed. No counterparty notifications leave the platform.",
    live: "Real outbound via Resend / Slack. Counterparties are notified per their preferences.",
  },
  {
    area: "Compliance gates",
    sandbox: "May be short-circuited by test-mode bypass for admin users. Every bypass is audited.",
    live: "Full IDV / sanctions / KYB / UBO / ATB enforcement. No bypasses.",
  },
  {
    area: "Audit ledger",
    sandbox: "Tagged test_mode=true. Excluded from regulator-facing exports.",
    live: "Append-only, SHA-256 chained. Included in every audit, evidence pack and 7-year retention export.",
  },
  {
    area: "Rate limits",
    sandbox: "Same headline limit (1,000 req/min) but generous burst tolerance.",
    live: "Strict 1,000 req/min per organisation. 429 with Retry-After on breach.",
  },
  {
    area: "Reversibility",
    sandbox: "Anything created here can be wiped. No long-term consequence.",
    live: "POIs, attestations and audit rows are immutable. Mistakes require a dispute, not a delete.",
  },
];

export function EnvModeComparison() {
  const { env } = useEnv();
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("izenzo:dev-env-compare:open") === "1";
  });

  // Auto-open on first visit so users see the comparison once.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem("izenzo:dev-env-compare:seen") !== "1") {
      setOpen(true);
      window.localStorage.setItem("izenzo:dev-env-compare:seen", "1");
    }
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem("izenzo:dev-env-compare:open", next ? "1" : "0");
    } catch {
      /* non-fatal */
    }
  };

  const isProd = env === "production";

  return (
    <section
      className="rounded-sm border border-slate-800 bg-slate-900/40"
      aria-labelledby="env-compare-heading"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="env-compare-body"
        className="w-full flex items-center justify-between gap-4 px-5 py-3 text-left hover:bg-slate-900/70 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={[
              "shrink-0 inline-flex h-2 w-2 rounded-full",
              isProd ? "bg-red-500" : "bg-emerald-400",
            ].join(" ")}
          />
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
              // sandbox vs live
            </div>
            <div
              id="env-compare-heading"
              className="text-[13.5px] text-slate-100"
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              What changes between modes
            </div>
          </div>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
          {open ? "Hide" : "Show"} table
        </span>
      </button>

      {open && (
        <div
          id="env-compare-body"
          className="border-t border-slate-800 overflow-x-auto"
        >
          <table className="w-full text-[12.5px]" style={{ fontFamily: "Inter, sans-serif" }}>
            <thead>
              <tr className="text-left bg-slate-900/60">
                <th className="px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400 w-[22%]">
                  Area
                </th>
                <th className="px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-400 w-[39%]">
                  ○ Sandbox
                </th>
                <th className="px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-red-400 w-[39%]">
                  ● Live
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row, i) => (
                <tr
                  key={row.area}
                  className={[
                    "align-top border-t border-slate-800",
                    i % 2 === 0 ? "bg-slate-900/20" : "",
                  ].join(" ")}
                >
                  <td className="px-5 py-3 text-slate-100 font-medium">{row.area}</td>
                  <td className="px-5 py-3 text-slate-300 leading-relaxed">{row.sandbox}</td>
                  <td className="px-5 py-3 text-slate-300 leading-relaxed">{row.live}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-5 py-3 border-t border-slate-800 text-[11.5px] text-slate-500 leading-relaxed">
            <span className="font-mono uppercase tracking-[0.16em] text-slate-400 mr-2">rule of thumb</span>
            If you cannot explain in one sentence what your call is about to do in <span className="text-red-300">Live</span>,
            switch to Sandbox first.
          </p>
        </div>
      )}
    </section>
  );
}
