import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useCrossDomainUrls } from "@/components/HostnameRouter";

/**
 * Minimal header for public pages: logo + sign in. Nothing else.
 */
export function PublicHeader() {
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
        <Link to="/" className="flex items-center gap-2">
          <div className="h-7 w-7 rounded bg-foreground flex items-center justify-center">
            <span className="text-background font-bold text-xs">TI</span>
          </div>
          <span className="font-semibold text-sm tracking-tight">Trade.Izenzo</span>
        </Link>

        <AuthLink className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors">
          Sign in
          <ArrowRight className="h-3.5 w-3.5" />
        </AuthLink>
      </div>
    </nav>
  );
}
