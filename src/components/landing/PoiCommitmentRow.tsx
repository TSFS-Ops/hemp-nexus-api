/**
 * POI commitment row — dark terminal toggle + "Proceed with WaD" button.
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
    <div
      className="rounded-md px-4 py-3 flex items-center justify-between gap-4 flex-wrap"
      style={{ backgroundColor: 'var(--lt-surface)', border: '1px solid var(--lt-border)' }}
    >
      <label className="flex items-center gap-3 cursor-pointer select-none">
        <button
          role="switch"
          aria-checked={accepted}
          onClick={() => setAccepted(!accepted)}
          className="relative w-10 h-5 rounded-full transition-colors duration-200 flex-shrink-0"
          style={{ backgroundColor: accepted ? 'var(--lt-emerald-dark)' : 'var(--lt-border-hover)' }}
        >
          <span
            className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow transition-transform duration-200"
            style={{
              backgroundColor: 'white',
              transform: accepted ? 'translateX(20px)' : 'translateX(0)',
            }}
          />
        </button>
        <span className="text-[12px] font-medium" style={{ color: 'var(--lt-text)' }}>
          I understand and commit to the POI terms
        </span>
      </label>
      <button
        onClick={handleProceed}
        disabled={!accepted}
        className="px-6 h-9 font-mono text-[11px] uppercase tracking-wider font-semibold
                 transition-all active:scale-[0.98] rounded-md"
        style={{
          backgroundColor: accepted ? 'var(--lt-emerald-dark)' : 'var(--lt-panel)',
          color: accepted ? 'white' : 'var(--lt-text-dim)',
          cursor: accepted ? 'pointer' : 'not-allowed',
        }}
      >
        Proceed with WaD
      </button>
    </div>
  );
}
