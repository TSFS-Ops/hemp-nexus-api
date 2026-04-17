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
      "Search for verified counterparties, negotiate terms, and execute cryptographically sealed Proofs of Intent.",
    route: "/desk",
    meta: "For buyers, sellers & deal originators",
  },
  {
    id: "developer",
    icon: Terminal,
    title: "Developer & API Integration",
    description:
      "Generate API keys, configure webhooks, and connect your ERP to the Izenzo sovereign ledger.",
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
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState<Persona | null>(null);

  const handleSelect = async (persona: PersonaCard) => {
    if (!user || submitting) return;
    setSubmitting(persona.id);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ selected_persona: persona.id })
        .eq("id", user.id);

      if (error) throw error;
      navigate(persona.route, { replace: true });
    } catch (err) {
      console.error("[welcome] persona save failed:", err);
      toast.error("Couldn't save your choice. Please try again.");
      setSubmitting(null);
    }
  };

  return (
    <div className="min-h-screen w-full bg-white flex flex-col">
      {/* Top bar */}
      <header className="border-b border-slate-200 px-8 py-5">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h2 className="font-mono text-xs font-medium tracking-[0.25em] text-slate-900 uppercase">
              Izenzo
            </h2>
          </div>
          <p className="text-xs text-slate-400 font-mono tracking-wider">
            ONBOARDING · STEP 1 OF 1
          </p>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 px-6 sm:px-8 py-24 sm:py-32">
        <div className="max-w-6xl mx-auto">
          {/* Heading */}
          <div className="text-center mb-20 max-w-3xl mx-auto">
            <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-slate-400 mb-6">
              Welcome to the network
            </p>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-slate-900 leading-[1.1]">
              How will you use Izenzo?
            </h1>
            <p className="mt-6 text-base sm:text-lg text-slate-500 leading-relaxed max-w-xl mx-auto">
              Choose your primary workspace. You can switch contexts at any time from settings.
            </p>
          </div>

          {/* Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
            {PERSONAS.map((p) => {
              const Icon = p.icon;
              const isSubmitting = submitting === p.id;
              const isDisabled = submitting !== null && !isSubmitting;
              return (
                <button
                  key={p.id}
                  onClick={() => handleSelect(p)}
                  disabled={submitting !== null}
                  className={[
                    "group text-left p-8 lg:p-10",
                    "bg-slate-50 hover:bg-white",
                    "border border-slate-200 hover:border-slate-400",
                    "rounded-md transition-all duration-200",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                    "disabled:cursor-not-allowed",
                    isDisabled ? "opacity-40" : "",
                  ].join(" ")}
                >
                  {/* Icon */}
                  <div className="mb-8 inline-flex items-center justify-center w-12 h-12 rounded-md border border-slate-200 bg-white group-hover:border-slate-400 transition-colors">
                    <Icon className="h-5 w-5 text-slate-700 group-hover:text-primary transition-colors" strokeWidth={1.5} />
                  </div>

                  {/* Meta tag */}
                  <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400 mb-3">
                    {p.meta}
                  </p>

                  {/* Title */}
                  <h2 className="text-xl lg:text-2xl font-semibold text-slate-900 tracking-tight mb-4 leading-snug">
                    {p.title}
                  </h2>

                  {/* Description */}
                  <p className="text-sm lg:text-[15px] text-slate-500 leading-relaxed mb-10">
                    {p.description}
                  </p>

                  {/* CTA row */}
                  <div className="flex items-center justify-between pt-6 border-t border-slate-200 group-hover:border-slate-300 transition-colors">
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
          <p className="mt-20 text-center text-xs text-slate-400 font-mono tracking-wider">
            YOUR SELECTION IS RECORDED IN YOUR PROFILE · CHANGEABLE FROM SETTINGS · ATTESTED BY SHA-256
          </p>

          {/* Internal HQ access — minimal, intentional dev-phase escape hatch.
              The route itself is RBAC-guarded so non-admins receive a 403 on arrival. */}
          <div className="mt-8 text-center">
            <button
              type="button"
              onClick={() => navigate("/hq")}
              className="text-xs text-slate-400 hover:text-slate-700 underline-offset-4 hover:underline transition-colors"
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
