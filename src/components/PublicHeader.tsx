import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { ThemeToggle } from "@/components/ThemeToggle";

interface PublicHeaderProps {
  /** Show the "Try Demo" link (only on Landing) */
  showDemo?: boolean;
  /** Show theme toggle (useful on docs) */
  showThemeToggle?: boolean;
}

/**
 * Shared header for all standalone (non-dashboard) pages:
 * Landing, Pricing, Docs, Demo, ConsoleWelcome.
 *
 * Enforces consistent logo, nav links, and CTA across the public face.
 */
export function PublicHeader({ showDemo, showThemeToggle }: PublicHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { getAuthUrl, isPreview } = useCrossDomainUrls();
  const authUrl = getAuthUrl();

  const AuthLink = ({ children, className }: { children: React.ReactNode; className?: string }) => {
    if (isPreview) {
      return <Link to="/auth" className={className}>{children}</Link>;
    }
    return <a href={authUrl} className={className}>{children}</a>;
  };

  return (
    <nav className="border-b border-border bg-background sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Logo — always identical */}
        <Link to="/" className="flex items-center gap-2">
          <div className="h-7 w-7 rounded bg-foreground flex items-center justify-center">
            <span className="text-background font-bold text-xs">CM</span>
          </div>
          <span className="font-semibold text-sm tracking-tight">Compliance Matching API</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6">
          <Link
            to="/docs"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Documentation
          </Link>
          <Link
            to="/pricing"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Pricing
          </Link>
          {showDemo && (
            <a
              href="#try-it"
              className="text-sm font-medium text-foreground"
            >
              Try Demo
            </a>
          )}
          {showThemeToggle && <ThemeToggle />}
          <AuthLink className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors">
            Sign in
            <ArrowRight className="h-3.5 w-3.5" />
          </AuthLink>
        </div>

        {/* Mobile toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-border bg-background px-4 py-4 space-y-3">
          <Link
            to="/docs"
            className="block text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
            onClick={() => setMobileMenuOpen(false)}
          >
            Documentation
          </Link>
          <Link
            to="/pricing"
            className="block text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
            onClick={() => setMobileMenuOpen(false)}
          >
            Pricing
          </Link>
          {showDemo && (
            <a
              href="#try-it"
              className="block text-sm font-medium text-foreground py-2"
              onClick={() => setMobileMenuOpen(false)}
            >
              Try Demo
            </a>
          )}
          <AuthLink className="block text-sm font-medium text-foreground py-2">
            Sign in
          </AuthLink>
        </div>
      )}
    </nav>
  );
}
