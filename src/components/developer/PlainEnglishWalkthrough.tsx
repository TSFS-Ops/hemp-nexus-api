import { useState } from "react";
import { useLocation } from "react-router-dom";
import { ChevronDown, BookOpenCheck } from "lucide-react";

/**
 * PlainEnglishWalkthrough
 *
 * A collapsible, page-aware panel that sits at the top of every Developer
 * Centre view and explains - in plain English, no jargon - what each visible
 * card and button does, in the order an operator encounters them.
 *
 * Why this lives in the Developer Centre (not in /docs):
 *   The /docs site is a reference for engineers integrating against the API.
 *   This panel is for *anyone internal* (product, ops, compliance, sales)
 *   who opens the Developer Centre and needs to understand what they are
 *   looking at without reading code or API specs.
 *
 * Content is keyed off the current route so the walkthrough always matches
 * the cards rendered below it.
 */

type Step = {
  label: string;
  body: string;
};

type PageGuide = {
  title: string;
  intro: string;
  steps: Step[];
  footnote?: string;
};

const GUIDES: Record<string, PageGuide> = {
  keys: {
    title: "API Keys - what you are looking at",
    intro:
      "This page is where machines (your back-office system, a partner integration, a script) get permission to talk to Izenzo on your behalf. Read top-to-bottom; each card builds on the one above it.",
    steps: [
      {
        label: "Environment switcher (top right)",
        body:
          "Toggles between Sandbox and Live. Sandbox is a safe playground - no real records, no billing. Live affects real trades, real counterparties, and real credit balances. Always confirm which side you are on before clicking anything.",
      },
      {
        label: "API Keys panel",
        body:
          "Lists the credentials issued to your organisation. Each key has a prefix (sk_live_ or sk_test_) you can share freely for support, and a secret half that is shown ONCE at creation. Treat the secret like a password: paste it into your secrets manager immediately, then close the dialog. If you lose it, revoke and reissue - there is no recovery.",
      },
      {
        label: "Create key button",
        body:
          "Issues a new credential. You will be asked to name it (e.g. ‘Back-office sync - production’) and pick scopes (the specific things this key is allowed to do, like read matches or write webhooks). Default to least privilege - only tick what the integration actually needs.",
      },
      {
        label: "Revoke",
        body:
          "Immediately disables a key. Use this the moment a key is suspected to be exposed, when an integration is decommissioned, or when an employee leaves. Revocation is instant and irreversible.",
      },
      {
        label: "Quick-Start (left)",
        body:
          "A copy-paste shell snippet that proves your key works. It hits the /healthz endpoint and expects a ‘ledger synchronised’ reply. If this fails, the rest of the API will fail too - fix this first.",
      },
      {
        label: "System Diagnostics (right)",
        body:
          "Live readout of platform health: database, edge functions, latency. Green across the board means the platform is fine and any error you are seeing is in your own integration. Amber or red means the issue is on our side - check Status before debugging your code.",
      },
      {
        label: "Live Activity Feed",
        body:
          "A real-time log of API calls made with your keys. Use this to confirm a request actually reached us, see the HTTP status it returned, and copy the request ID for support tickets. This is the single most useful debugging tool on the page.",
      },
      {
        label: "Quick Schema",
        body:
          "A condensed view of the most-used request and response shapes - match objects, POI payloads, webhook envelopes. Full reference lives under Schema Explorer.",
      },
    ],
    footnote:
      "If a key stops working, check three things in order: (1) is it revoked? (2) is the environment switcher on the right side? (3) does the key have the scope for the endpoint you are calling?",
  },
  webhooks: {
    title: "Webhook Logs - what you are looking at",
    intro:
      "Webhooks are how Izenzo pushes events to your systems (a counterparty accepted a trade request, a POI was sealed, a credit balance changed). This page proves whether those pushes are arriving and being acknowledged.",
    steps: [
      {
        label: "Logs table",
        body:
          "Every webhook attempt we have made to your endpoints, newest first. Each row shows the event type, the destination URL, the HTTP status your server returned, and a delivery ID. A 2xx status means your server accepted it; anything else means we will retry on an exponential schedule.",
      },
      {
        label: "Status column",
        body:
          "Green ‘delivered’ = your server returned 200–299. Amber ‘retrying’ = transient failure, scheduled for another attempt. Red ‘failed’ = exhausted retries; the event is in the dead-letter queue and your endpoint may have been auto-disabled (which itself blocks WaD sealing - see Gate 10).",
      },
      {
        label: "Replay button",
        body:
          "Manually re-sends a single webhook. Use after you have fixed a bug on your side and want to confirm the payload now processes cleanly, without waiting for the next real event.",
      },
      {
        label: "Inspect / payload viewer",
        body:
          "Opens the exact JSON body we sent and the headers, including the signature header your server should verify. If something on your side is misbehaving, copy this payload into your local test rig.",
      },
    ],
    footnote:
      "Webhooks are protected by replay guards - if you re-deliver an event your server has already processed, you will get a 409 WEBHOOK_REPLAY response. That is by design, not an error.",
  },
  schema: {
    title: "Schema Explorer - what you are looking at",
    intro:
      "A browsable map of every public API endpoint, the fields it accepts, and the fields it returns. Think of it as the menu and the recipe book combined.",
    steps: [
      {
        label: "Endpoint list (left)",
        body:
          "Grouped by resource - matches, counterparties, POIs, webhooks, billing. Click one to load its full definition on the right. Endpoints marked with a credit icon will burn credits when called in Live; everything else is free.",
      },
      {
        label: "Definition panel (right)",
        body:
          "For each endpoint: the HTTP method, the path, the required and optional fields, the possible response codes, and a sample response. Use this as the source of truth - it is generated from the live OpenAPI spec, not hand-written.",
      },
      {
        label: "Try-it (where shown)",
        body:
          "Lets you fire a real request from the browser using the currently selected key and environment. Treat with care on Live - a successful trade.create is a real trade.",
      },
    ],
    footnote:
      "If a field appears in this explorer it is supported and stable. If it does not appear, do not rely on it even if it works today.",
  },
  docs: {
    title: "Integration Docs - what you are looking at",
    intro:
      "Narrative guides for common integration patterns: authenticating, creating a match, generating a POI, handling webhooks, and recovering from errors. Where Schema Explorer answers ‘what fields exist’, this section answers ‘in what order do I call them and why’.",
    steps: [
      {
        label: "Quickstart",
        body:
          "Start here on day one. Walks from issuing a key to making a first authenticated call to recording a match - about five minutes end-to-end.",
      },
      {
        label: "Authentication",
        body:
          "Explains the X-API-Key header, scope reference, and rate limits (1,000 req/min default per organisation). Read this before scaling traffic.",
      },
      {
        label: "Matches",
        body:
          "The full state machine for a bilateral trade - from draft, through engagement, to POI sealed. Includes the exact preconditions for each transition.",
      },
      {
        label: "Webhooks",
        body:
          "Event catalogue, signature verification, retry behaviour, replay protection. Required reading before you point a production endpoint at us.",
      },
      {
        label: "Errors",
        body:
          "Every error code we return, what it means in plain language, and the recommended client-side response (retry, surface to user, escalate to support).",
      },
    ],
    footnote:
      "All examples in this section are runnable as-is against Sandbox with a sk_test_ key - no setup required beyond the snippet on the page.",
  },
};

function activeKey(pathname: string): keyof typeof GUIDES {
  if (pathname.includes("/developer/webhooks")) return "webhooks";
  if (pathname.includes("/developer/schema")) return "schema";
  if (pathname.includes("/developer/docs")) return "docs";
  return "keys";
}

export function PlainEnglishWalkthrough() {
  const { pathname } = useLocation();
  const guide = GUIDES[activeKey(pathname)];
  const storageKey = `izenzo:dev-walkthrough:${activeKey(pathname)}:open`;
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem(storageKey);
    // Default open the first time someone lands on a page; remember choice after.
    return stored === null ? true : stored === "1";
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(storageKey, next ? "1" : "0");
    } catch {
      /* localStorage unavailable - non-fatal */
    }
  };

  return (
    <section
      className="rounded-sm border border-slate-800 bg-slate-900/40"
      aria-labelledby="dev-walkthrough-heading"
    >
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between gap-4 px-5 py-3 text-left hover:bg-slate-900/70 transition-colors"
        aria-expanded={open}
        aria-controls="dev-walkthrough-body"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <BookOpenCheck
            className="h-4 w-4 text-green-400 shrink-0"
            strokeWidth={1.75}
          />
          <span className="min-w-0">
            <span className="block font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
              // plain-english walkthrough
            </span>
            <span
              id="dev-walkthrough-heading"
              className="block text-[13.5px] text-slate-100 truncate"
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              {guide.title}
            </span>
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 text-slate-400 shrink-0 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          strokeWidth={1.75}
        />
      </button>

      {open && (
        <div
          id="dev-walkthrough-body"
          className="border-t border-slate-800 px-5 py-5 space-y-5"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          <p className="text-[13px] leading-relaxed text-slate-300 max-w-3xl">
            {guide.intro}
          </p>

          <ol className="space-y-3.5 max-w-3xl">
            {guide.steps.map((step, i) => (
              <li
                key={step.label}
                className="grid grid-cols-[28px_1fr] gap-3 items-start"
              >
                <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-sm border border-slate-700 bg-slate-950 font-mono text-[10px] text-green-400">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-slate-100">
                    {step.label}
                  </div>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-400">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {guide.footnote && (
            <p className="text-[12px] leading-relaxed text-slate-500 border-t border-slate-800 pt-4 max-w-3xl">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500 mr-2">
                note
              </span>
              {guide.footnote}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
