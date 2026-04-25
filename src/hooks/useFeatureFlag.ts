import { useEffect, useState } from "react";
import {
  isFeatureEnabled,
  type FeatureFlagKey,
} from "@/lib/feature-flags";

/**
 * Subscribes to localStorage overrides + same-tab change events so
 * components re-render when an operator flips a flag from devtools.
 */
export function useFeatureFlag(key: FeatureFlagKey): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => isFeatureEnabled(key));

  useEffect(() => {
    const recompute = () => setEnabled(isFeatureEnabled(key));

    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<{ key?: string }>).detail;
      if (!detail?.key || detail.key === key) recompute();
    };
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === `ff:${key}`) recompute();
    };

    window.addEventListener("feature-flags:changed", onCustom as EventListener);
    window.addEventListener("storage", onStorage);
    // Re-sync once on mount in case env / storage changed before subscribe.
    recompute();

    return () => {
      window.removeEventListener(
        "feature-flags:changed",
        onCustom as EventListener
      );
      window.removeEventListener("storage", onStorage);
    };
  }, [key]);

  return enabled;
}
