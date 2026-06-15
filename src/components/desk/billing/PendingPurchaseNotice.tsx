/**
 * PendingPurchaseNotice - Batch C / Fix 4.
 *
 * Soft UX warning surfaced near the Purchase CTAs when this device has
 * a recent Paystack attempt that has not been confirmed credited yet
 * (e.g. the user opened a second tab and is about to start another
 * checkout while the first is still settling).
 *
 * This is purely advisory:
 *   - It does NOT block purchase. Two-tab checkouts produce distinct
 *     Paystack references and are individually safe; the ledger and
 *     audit guards (request_id UNIQUE + credits.purchased UNIQUE) make
 *     double-credit impossible regardless of what the user does.
 *   - It does NOT claim the previous purchase failed.
 *   - It disappears as soon as the ledger shows the credit landed, or
 *     when the attempt ages out of the warning window.
 */

import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  readRecentPendingAttempts,
  type PaystackAttempt,
} from "./PaymentReferenceStatus";

interface PendingPurchaseNoticeProps {
  orgId: string | null;
}

export function PendingPurchaseNotice({ orgId }: PendingPurchaseNoticeProps) {
  const [pending, setPending] = useState<PaystackAttempt[]>([]);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const creditedRefs = new Set<string>();
      if (orgId) {
        const { data } = await supabase
          .from("token_ledger")
          .select("request_id")
          .eq("org_id", orgId)
          .eq("action_type", "credit_purchase")
          .order("created_at", { ascending: false })
          .limit(20);
        for (const row of data ?? []) {
          if (row.request_id) creditedRefs.add(row.request_id);
        }
      }
      if (cancelled) return;
      setPending(readRecentPendingAttempts(creditedRefs));
    };

    void refresh();
    // Re-check every 30s so the notice disappears once settlement lands.
    const handle = window.setInterval(() => void refresh(), 30_000);
    // React to storage events from sibling tabs.
    const onStorage = () => void refresh();
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
      window.removeEventListener("storage", onStorage);
    };
  }, [orgId]);

  if (pending.length === 0) return null;

  const latest = pending[0];

  return (
    <div
      role="status"
      data-testid="pending-purchase-notice"
      className="mb-6 flex items-start gap-3 rounded-sm border border-amber-200 bg-amber-50 px-4 py-3"
    >
      <Clock3
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700"
        strokeWidth={2.5}
      />
      <div className="space-y-1">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-amber-900">
          Purchase pending verification
        </p>
        <p className="text-[13px] leading-snug text-amber-900/90">
          You have a recent payment ({" "}
          <span className="font-mono text-[12px]">{latest.reference}</span>{" "}
          ) that has not yet been confirmed as credited. Complete or verify
          that payment before starting another - otherwise you may be charged
          twice for the same intent.
        </p>
      </div>
    </div>
  );
}
