import { useEffect, useState } from "react";
import { Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export const AUTH_REDIRECT_NOTICE_KEY = "izenzo_auth_redirect_notice";

interface AuthRedirectNotice {
  destination: string;
  reason: "expired" | "returnTo";
  at: number;
}

export function AuthRedirectNoticeBanner() {
  const [notice, setNotice] = useState<AuthRedirectNotice | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(AUTH_REDIRECT_NOTICE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as AuthRedirectNotice;
      if (!parsed.destination || Date.now() - parsed.at > 10 * 60 * 1000) {
        sessionStorage.removeItem(AUTH_REDIRECT_NOTICE_KEY);
        return;
      }
      setNotice(parsed);
    } catch {
      sessionStorage.removeItem(AUTH_REDIRECT_NOTICE_KEY);
    }
  }, []);

  if (!notice) return null;

  const dismiss = () => {
    sessionStorage.removeItem(AUTH_REDIRECT_NOTICE_KEY);
    setNotice(null);
  };

  return (
    <div role="status" aria-live="polite" className="fixed top-0 inset-x-0 z-[210] border-b bg-card shadow-sm">
      <div className="mx-auto flex max-w-7xl items-start gap-3 px-4 py-2.5 text-sm text-card-foreground sm:items-center sm:px-6">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary sm:mt-0" />
        <p className="min-w-0 flex-1">
          {notice.reason === "expired"
            ? "You signed in again after your session expired. We returned you to your original page."
            : "You signed in successfully. We opened the page you originally requested."}{" "}
          <span className="font-mono text-xs text-muted-foreground">{notice.destination}</span>
        </p>
        <Button variant="ghost" size="icon" onClick={dismiss} aria-label="Dismiss sign-in redirect notice" className="h-7 w-7 shrink-0">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}