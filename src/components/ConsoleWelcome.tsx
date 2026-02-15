import { Link } from "react-router-dom";
import { ArrowRight, Shield, Key, FileText, BarChart3 } from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";

/**
 * Welcome interstitial shown to unauthenticated visitors on the console domain.
 * Replaces the empty dashboard with a clear value prop and sign-in CTA.
 */
export function ConsoleWelcome() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PublicHeader />

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="max-w-lg w-full text-center">
          {/* Value prop */}
          <div className="mb-10">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-3">
              Compliance Matching API
            </h1>
            <p className="text-muted-foreground leading-relaxed">
              Manage API keys, view request logs, and download tamper-evident evidence packs — all from one console.
            </p>
          </div>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-12">
            <Link
              to="/auth"
              className="inline-flex items-center justify-center gap-2 px-6 py-2.5 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors w-full sm:w-auto"
            >
              Sign in
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/auth"
              className="inline-flex items-center justify-center gap-2 px-6 py-2.5 text-sm font-medium rounded-md border border-border bg-background hover:bg-accent transition-colors w-full sm:w-auto"
            >
              Create account
            </Link>
          </div>

          {/* What you get */}
          <div className="grid grid-cols-2 gap-4 text-left">
            {[
              { icon: Key, label: "API Keys", desc: "Create and manage keys with scoped permissions" },
              { icon: BarChart3, label: "Request Logs", desc: "Monitor every API call with full telemetry" },
              { icon: FileText, label: "Evidence Packs", desc: "Download tamper-evident proof-of-intent records" },
              { icon: Shield, label: "Audit Trail", desc: "SHA-256 hashed, chain-linked event history" },
            ].map((item) => (
              <div key={item.label} className="p-4 border border-border rounded-lg bg-muted/30">
                <item.icon className="h-4 w-4 text-muted-foreground mb-2" />
                <p className="text-sm font-medium text-foreground">{item.label}</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* Subtle footer link */}
          <p className="mt-8 text-xs text-muted-foreground">
            Already have an API key?{" "}
            <Link to="/auth" className="text-foreground hover:underline">Sign in</Link>{" "}
            to access your dashboard.
          </p>
        </div>
      </main>
    </div>
  );
}
