import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Handshake, Terminal, ShieldCheck, ArrowRight, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Persona = "trade" | "developer" | "governance";

interface PersonaCard {
  id: Persona;
  icon: typeof Handshake;
  title: string;
  description: string;
  route: string;
  meta: string;
}

const PERSONAS: PersonaCard[] = [
  {
    id: "trade",
    icon: Handshake,
    title: "Commercial Trading",
    description:
      "Search for counterparties, negotiate terms, and record cryptographically hashed Proofs of Intent.",
    route: "/desk",
    meta: "For buyers, sellers & deal originators",
  },
  {
    id: "developer",
    icon: Terminal,
    title: "Developer & API Integration",
    description:
      "Generate API keys, configure webhooks, and connect your ERP to the Izenzo governance ledger.",
    route: "/developers/keys",
    meta: "For engineers & integration teams",
  },
  {
    id: "governance",
    icon: ShieldCheck,
    title: "Compliance & Legal",
    description:
      "Review trade risks, verify KYB/KYC documents, and approve cross-border transactions.",
    route: "/governance/triage",
    meta: "For compliance officers & legal counsel",
  },
];

function WelcomeContent() {
  const navigate = useNavigate();
  const { user, isPlatformAdmin, isOrgAdmin, roles } = useAuth();
  const [submitting, setSubmitting] = useState<Persona | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);

  // Governance is a privileged surface, only auditors / org admins / platform
  // admins may select it. Standard signups never see the option, matching the
  // authorisation matrix used by ContextSwitcher.
  const isAuditor = roles.includes("auditor");
  const canSelectGovernance = isPlatformAdmin || isOrgAdmin || isAuditor;
  const visiblePersonas = PERSONAS.filter(
    (p) => p.id !== "governance" || canSelectGovernance,
  );

  const handleSelect = async (persona: PersonaCard) => {
    if (!user || submitting) return;

    // Defence in depth: client-side check before persisting. Even though the
    // governance card is filtered for non-privileged users, a manipulated
    // client could still call this handler. Block at the source.
    if (persona.id === "governance" && !canSelectGovernance) {
      toast.error("You do not have permission to use the Governance Console.");
      return;
    }

    setSubmitting(persona.id);

    // ── Atomicity fix (#5) ──
    // Persona is a UI preference, not commercial state. Navigate FIRST so the
    // user always reaches their chosen destination. Persistence + audit run as
    // fire-and-forget; failures are logged + toasted but never strand the user.
    // The DB trigger `trg_audit_persona_change` is the durable backstop - even
    // if this client-side audit insert fails, the persona UPDATE itself emits
    // an audit_logs row from inside Postgres.
    navigate(persona.route, { replace: true });

    // Fire-and-forget persistence. Wrapped in IIFE so we don't await it.
    void (async () => {
      try {
        const { data: profileRow } = await supabase
          .from("profiles")
          .select("org_id")
          .eq("id", user.id)
          .maybeSingle();
        const orgId = profileRow?.org_id ?? null;

        const { error } = await supabase
          .from("profiles")
          .update({ selected_persona: persona.id })
          .eq("id", user.id);

        if (error) {
          console.error("[welcome] persona persist failed:", error.message);
          const msg = "We couldn't remember your workspace preference. Your access still works for this session - sign out and back in to retry, or contact support if the problem persists.";
          setPersistError(msg);
          toast.error(msg, { duration: 12000 });
          return;
        }

        // Client-side audit row carries richer context (route, roles, UA) than
        // the DB trigger. Best-effort; trigger guarantees the minimum row.
        if (orgId) {
          const { error: auditError } = await supabase.from("audit_logs").insert({
            org_id: orgId,
            actor_user_id: user.id,
            action: "profile.persona_selected",
            entity_type: "profile",
            entity_id: user.id,
            metadata: {
              persona: persona.id,
              route: persona.route,
              roles_at_selection: roles,
              source: "welcome_ui",
              user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
              selected_at: new Date().toISOString(),
            },
          });
          if (auditError) {
            console.warn("[welcome] client audit insert failed (DB trigger still writes minimum row):", auditError.message);
          }
        }
      } catch (err) {
        console.error("[welcome] background persona persist threw:", err);
      }
    })();
  };

  return (
    <div className="min-h-screen w-full bg-white flex flex-col">
      {/* Top bar */}
      <header className="border-b border-slate-200 px-4 sm:px-8 py-4 sm:py-5">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <div>
            <h2 className="font-mono text-xs font-medium tracking-[0.25em] text-slate-900 uppercase">
              Izenzo
            </h2>
          </div>
          <p className="text-[10px] sm:text-xs text-slate-400 font-mono tracking-wider whitespace-nowrap">
            STEP 1 OF 1
          </p>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 px-4 sm:px-8 py-12 sm:py-24 md:py-32">
        <div className="max-w-6xl mx-auto">
          {/* Heading */}
          <div className="text-center mb-12 sm:mb-20 max-w-3xl mx-auto">
            <p className="font-mono text-[10px] sm:text-[11px] tracking-[0.3em] uppercase text-slate-400 mb-4 sm:mb-6">
              Welcome to the network
            </p>
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight text-slate-900 leading-[1.1]">
              How will you use Izenzo?
            </h1>
            <p className="mt-4 sm:mt-6 text-sm sm:text-base md:text-lg text-slate-500 leading-relaxed max-w-xl mx-auto px-2">
              Choose your primary workspace. Sign out and back in to change it later.
            </p>
          </div>

          {persistError && (
            <div
              role="alert"
              className="mb-6 max-w-3xl mx-auto rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              {persistError}
            </div>
          )}

          {/* Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
            {visiblePersonas.map((p) => {
              const Icon = p.icon;
              const isSubmitting = submitting === p.id;
              const isDisabled = submitting !== null && !isSubmitting;
              return (
                <button
                  key={p.id}
                  onClick={() => handleSelect(p)}
                  disabled={submitting !== null}
                  className={[
                    "group text-left p-6 sm:p-8 lg:p-10",
                    "bg-slate-50 hover:bg-white",
                    "border border-slate-200 hover:border-slate-400",
                    "rounded-md transition-all duration-200",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                    "disabled:cursor-not-allowed",
                    isDisabled ? "opacity-40" : "",
                  ].join(" ")}
                >
                  {/* Icon */}
                  <div className="mb-5 sm:mb-8 inline-flex items-center justify-center w-12 h-12 rounded-md border border-slate-200 bg-white group-hover:border-slate-400 transition-colors">
                    <Icon className="h-5 w-5 text-slate-700 group-hover:text-primary transition-colors" strokeWidth={1.5} />
                  </div>

                  {/* Meta tag */}
                  <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400 mb-2 sm:mb-3">
                    {p.meta}
                  </p>

                  {/* Title */}
                  <h2 className="text-lg sm:text-xl lg:text-2xl font-semibold text-slate-900 tracking-tight mb-3 sm:mb-4 leading-snug">
                    {p.title}
                  </h2>

                  {/* Description */}
                  <p className="text-sm lg:text-[15px] text-slate-500 leading-relaxed mb-6 sm:mb-10">
                    {p.description}
                  </p>

                  {/* CTA row */}
                  <div className="flex items-center justify-between pt-4 sm:pt-6 border-t border-slate-200 group-hover:border-border transition-colors">
                    <span className="text-sm font-medium text-slate-900">
                      {isSubmitting ? "Setting up…" : "Continue"}
                    </span>
                    {isSubmitting ? (
                      <Loader2 className="h-4 w-4 text-slate-700 animate-spin" />
                    ) : (
                      <ArrowRight className="h-4 w-4 text-slate-700 group-hover:translate-x-1 transition-transform" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Footnote */}
          <p className="mt-12 sm:mt-20 text-center text-[10px] sm:text-xs text-slate-400 font-mono tracking-wider px-2 leading-relaxed">
            YOUR SELECTION IS RECORDED · CHANGEABLE FROM SETTINGS · SHA-256 ATTESTED
          </p>

          {/* Internal HQ access, minimal, intentional dev-phase escape hatch.
              The route itself is RBAC-guarded so non-admins receive a 403 on arrival. */}
          <div className="mt-6 sm:mt-8 text-center">
            <button
              type="button"
              onClick={() => navigate("/hq")}
              className="text-xs text-slate-400 hover:text-slate-700 underline-offset-4 hover:underline transition-colors min-h-[44px] inline-flex items-center"
            >
              Internal HQ Access
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function Welcome() {
  return (
    <RequireAuth>
      <WelcomeContent />
    </RequireAuth>
  );
}
