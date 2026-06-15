import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * DATA-009 Phase 2 - org-side banner.
 * Shows when the org has an open residency_review onboarding hold.
 * Does NOT promise hosting/region change.
 */
export function ResidencyReviewBanner() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!u?.user) return;
        const { data: prof } = await supabase
          .from("profiles").select("org_id").eq("id", u.user.id).maybeSingle();
        const orgId = (prof as { org_id?: string } | null)?.org_id;
        if (!orgId) return;
        const { data: org } = await supabase
          .from("organizations").select("onboarding_hold_reason").eq("id", orgId).maybeSingle();
        if (cancelled) return;
        setActive((org as { onboarding_hold_reason?: string | null } | null)?.onboarding_hold_reason === "residency_review");
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!active) return null;
  return (
    <Alert className="mb-3">
      <AlertTitle>Residency review pending</AlertTitle>
      <AlertDescription>
        A data-residency requirement has been recorded for your organisation and is awaiting Izenzo review.
        Production artefacts, exports and progression are paused while the review is open. This is a policy
        review state only - no hosting, region or storage change is implied.
      </AlertDescription>
    </Alert>
  );
}

export default ResidencyReviewBanner;
