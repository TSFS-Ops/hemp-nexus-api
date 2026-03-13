/**
 * POI commitment row — toggle + "Proceed with WaD" button.
 * Gate for unauthenticated users to sign in before proceeding.
 */

import { useState } from "react";
import { toast } from "sonner";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { useAuth } from "@/contexts/AuthContext";

export function PoiCommitmentRow() {
  const [accepted, setAccepted] = useState(false);
  const { getAuthUrl, isPreview } = useCrossDomainUrls();
  const { isAuthenticated } = useAuth();

  const handleProceed = () => {
    if (isAuthenticated) {
      window.location.assign("/dashboard");
      return;
    }
    toast.info("Sign in to proceed", {
      description: "Create an account to commit to POI terms and proceed with WaD.",
      action: {
        label: "Sign Up",
        onClick: () => {
          if (isPreview) {
            window.location.assign("/auth");
          } else {
            window.location.href = getAuthUrl();
          }
        },
      },
    });
  };

  return (
    <div className="border border-border bg-background px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
      <label className="flex items-center gap-3 cursor-pointer select-none">
        <button
          role="switch"
          aria-checked={accepted}
          onClick={() => setAccepted(!accepted)}
          className={`relative w-10 h-5 rounded-full transition-colors duration-200 flex-shrink-0
                     ${accepted ? "bg-primary" : "bg-border"}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-background shadow transition-transform duration-200
                       ${accepted ? "translate-x-5" : "translate-x-0"}`}
          />
        </button>
        <span className="text-[12px] text-foreground font-medium">
          I understand and commit to the POI terms
        </span>
      </label>
      <button
        onClick={handleProceed}
        disabled={!accepted}
        className={`px-6 h-9 shadow-inner-metallic
                 font-mono text-[11px] uppercase tracking-widest font-medium
                 transition-all active:scale-[0.98]
                 ${accepted
                   ? "bg-primary text-primary-foreground hover:opacity-90"
                   : "bg-muted text-muted-foreground cursor-not-allowed"
                 }`}
      >
        Proceed with WaD
      </button>
    </div>
  );
}
