/**
 * OnboardingChecklist
 *
 * Small four-step checklist for a new API client. Persists tick state in
 * localStorage per browser so it stays out of the way once complete.
 *
 * Steps are intentionally tied to surfaces that already exist in the
 * Developer Centre - no fictional "click here to verify" automation.
 */

import { useEffect, useState } from "react";
import { Check, Circle } from "lucide-react";
import { Link } from "react-router-dom";
import { PanelStatusBadge } from "./PanelStatusBadge";

const STORAGE_KEY = "izenzo:dev-onboarding-v1";

type StepId = "issue_key" | "health_check" | "sample_match" | "sandbox_poi";

interface Step {
  id: StepId;
  title: string;
  body: string;
  cta?: { label: string; to?: string; href?: string };
}

const STEPS: Step[] = [
  {
    id: "issue_key",
    title: "Issue an API key",
    body:
      "Pick scopes the integration actually needs. The secret is shown once. Save it in your secrets manager before closing the dialog.",
    cta: { label: "Open API Keys", to: "/developer/keys" },
  },
  {
    id: "health_check",
    title: "Run a health check",
    body:
      "Hit /healthz with your new key. A 200 response confirms the key works and your network can reach the API.",
  },
  {
    id: "sample_match",
    title: "Record a sample match in sandbox",
    body:
      "Switch the mode toggle to Sandbox, then POST a Match using the snippet on this page. No credits burned, no counterparties contacted.",
  },
  {
    id: "sandbox_poi",
    title: "Generate a Proof of Intent in sandbox",
    body:
      "Run the POI mint flow against your sandbox match. Confirm the response includes a sealed_at timestamp and signature_valid: true.",
    cta: { label: "POI reference", to: "/docs/matches" },
  },
];

function loadState(): Record<StepId, boolean> {
  if (typeof window === "undefined") return {} as Record<StepId, boolean>;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {} as Record<StepId, boolean>;
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<StepId, boolean>)
      : ({} as Record<StepId, boolean>);
  } catch {
    return {} as Record<StepId, boolean>;
  }
}

export function OnboardingChecklist() {
  const [done, setDone] = useState<Record<StepId, boolean>>(loadState);
  const [hidden, setHidden] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(`${STORAGE_KEY}:hidden`) === "1";
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(done));
    } catch {
      /* non-fatal */
    }
  }, [done]);

  const toggle = (id: StepId) => setDone((prev) => ({ ...prev, [id]: !prev[id] }));

  const completed = STEPS.filter((s) => done[s.id]).length;

  if (hidden) {
    return (
      <button
        onClick={() => {
          setHidden(false);
          try {
            window.localStorage.setItem(`${STORAGE_KEY}:hidden`, "0");
          } catch {
            /* non-fatal */
          }
        }}
        className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500 hover:text-slate-300 transition-colors"
      >
        ▸ Show onboarding checklist ({completed}/{STEPS.length})
      </button>
    );
  }

  return (
    <section
      className="rounded-sm border border-slate-800 bg-slate-900/40"
      style={{ fontFamily: "Inter, sans-serif" }}
    >
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
        <div className="flex items-center gap-3 min-w-0">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
              // first-day checklist
            </div>
            <div className="text-[13.5px] text-slate-100">
              Get a new integration to a working POI in four steps
            </div>
          </div>
          <PanelStatusBadge kind="informational" />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-mono text-[11px] text-slate-400">
            {completed} / {STEPS.length} done
          </span>
          <button
            onClick={() => {
              setHidden(true);
              try {
                window.localStorage.setItem(`${STORAGE_KEY}:hidden`, "1");
              } catch {
                /* non-fatal */
              }
            }}
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500 hover:text-slate-200 transition-colors"
          >
            Hide
          </button>
        </div>
      </div>

      <ol className="divide-y divide-slate-800">
        {STEPS.map((step, i) => {
          const isDone = !!done[step.id];
          return (
            <li key={step.id} className="px-5 py-4 grid grid-cols-[24px_1fr_auto] gap-4 items-start">
              <button
                onClick={() => toggle(step.id)}
                aria-pressed={isDone}
                className="mt-0.5 text-slate-500 hover:text-emerald-400 transition-colors"
                title={isDone ? "Mark as not done" : "Mark as done"}
              >
                {isDone ? (
                  <Check className="h-4 w-4 text-emerald-400" strokeWidth={2} />
                ) : (
                  <Circle className="h-4 w-4" strokeWidth={1.5} />
                )}
              </button>

              <div className="min-w-0">
                <div
                  className={[
                    "text-[13px] font-medium",
                    isDone ? "text-slate-500 line-through" : "text-slate-100",
                  ].join(" ")}
                >
                  {String(i + 1).padStart(2, "0")} · {step.title}
                </div>
                <p className="mt-0.5 text-[12.5px] text-slate-400 leading-relaxed">{step.body}</p>
              </div>

              {step.cta &&
                (step.cta.to ? (
                  <Link
                    to={step.cta.to}
                    className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-300 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500/50 px-2.5 py-1 rounded-sm transition-colors"
                  >
                    {step.cta.label} →
                  </Link>
                ) : (
                  <a
                    href={step.cta.href}
                    className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-300 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500/50 px-2.5 py-1 rounded-sm transition-colors"
                  >
                    {step.cta.label} →
                  </a>
                ))}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
