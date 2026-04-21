import { useCallback, useEffect } from "react";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { PublicHeader } from "@/components/PublicHeader";
import { HeroStripeGlow } from "@/components/landing/HeroStripeGlow";
import { consumePreAuthState } from "@/lib/pre-auth-state";
import { useAuth } from "@/contexts/AuthContext";

export default function Landing() {
  const { getAuthUrl, isPreview } = useCrossDomainUrls();
  const authUrl = getAuthUrl();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  // Honour `?resume=1` after sign-in: route returning users back into the workspace
  useEffect(() => {
    if (authLoading) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("resume") !== "1") return;
    if (!isAuthenticated) return;

    const preAuth = consumePreAuthState();
    if (preAuth?.query) {
      const searchParams = new URLSearchParams({ q: preAuth.query, resume: "1" });
      window.location.assign(`/desk/discover?${searchParams.toString()}`);
    } else {
      window.location.assign("/desk");
    }
  }, [authLoading, isAuthenticated]);

  const navigateToAuth = useCallback(() => {
    if (isPreview) {
      window.location.assign("/auth?returnTo=/");
    } else {
      window.location.href = authUrl;
    }
  }, [isPreview, authUrl]);

  return (
    <div
      className="min-h-screen flex flex-col bg-white"
      style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}
    >
      <PublicHeader />
      <main className="flex-1">
        <HeroStripeGlow
          onGetStarted={isAuthenticated ? () => window.location.assign("/desk") : navigateToAuth}
          onContactSales={() => window.location.assign("/docs")}
        />
      </main>
      <footer className="w-full py-8 border-t border-slate-100">
        <div className="container mx-auto px-4 flex justify-center items-center">
          <p className="text-[11px] sm:text-xs text-slate-500 tracking-wide text-center">
            Izenzo is the trading name of Starfair162 (Pty) Ltd Reg: 2018 / 331720 / 07.
          </p>
        </div>
      </footer>
    </div>
  );
}
