/**
 * Point 6 — Dashboard-visible alert badges (compute-on-read).
 *
 * Strictly read-only. No new tables, no cron, no email, no alert rows.
 * Surfaces the P-4 alerts David approved:
 *   • low balance / zero balance
 *   • API key expiring (≤ 14d)
 *   • suspended or revoked key present
 *   • failed production calls above a reasonable threshold
 *
 * All thresholds are derived from props the parent already loaded — this
 * component does not perform additional database reads.
 */
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CircleSlash, Clock4, ShieldX, ServerCrash } from "lucide-react";

export interface BadgeInputs {
  balance?: number | null;
  minimumRequired?: number | null;
  nextKeyExpiry?: string | null; // ISO
  suspendedOrRevokedKeys?: number | null;
  failedProductionCalls?: number | null;
  failedProductionThreshold?: number;
}

const DEFAULT_FAILED_PROD_THRESHOLD = 25;
const KEY_EXPIRY_WARNING_DAYS = 14;
const LOW_BALANCE_MULTIPLIER = 1.25;

interface BadgeDef {
  key: string;
  label: string;
  tone: "amber" | "red" | "slate";
  Icon: typeof AlertTriangle;
}

export function computeBadges(i: BadgeInputs): BadgeDef[] {
  const out: BadgeDef[] = [];
  const min = i.minimumRequired ?? 0;
  const bal = i.balance ?? null;
  if (bal !== null) {
    if (bal <= 0) {
      out.push({ key: "zero_balance", label: "Zero balance", tone: "red", Icon: CircleSlash });
    } else if (bal <= Math.max(min, 1) * LOW_BALANCE_MULTIPLIER) {
      out.push({ key: "low_balance", label: "Low balance", tone: "amber", Icon: AlertTriangle });
    }
  }
  if (i.nextKeyExpiry) {
    const days = (new Date(i.nextKeyExpiry).getTime() - Date.now()) / 86_400_000;
    if (days <= KEY_EXPIRY_WARNING_DAYS) {
      out.push({ key: "key_expiring", label: days <= 0 ? "API key expired" : `API key expires in ${Math.max(0, Math.ceil(days))}d`, tone: days <= 0 ? "red" : "amber", Icon: Clock4 });
    }
  }
  if ((i.suspendedOrRevokedKeys ?? 0) > 0) {
    out.push({ key: "suspended_or_revoked", label: "Suspended / revoked key present", tone: "red", Icon: ShieldX });
  }
  const threshold = i.failedProductionThreshold ?? DEFAULT_FAILED_PROD_THRESHOLD;
  if ((i.failedProductionCalls ?? 0) > threshold) {
    out.push({ key: "high_failed_prod", label: `Failed prod calls > ${threshold}`, tone: "amber", Icon: ServerCrash });
  }
  return out;
}

const TONE: Record<BadgeDef["tone"], string> = {
  amber: "bg-amber-50 text-amber-900 border-amber-300",
  red: "bg-red-50 text-red-800 border-red-300",
  slate: "bg-slate-100 text-slate-700 border-slate-300",
};

export function Point6DashboardBadges(props: BadgeInputs) {
  const badges = computeBadges(props);
  if (badges.length === 0) {
    return (
      <div data-testid="point6-badges" className="flex items-center gap-2">
        <Badge variant="outline" className="bg-emerald-50 text-emerald-800 border-emerald-300">No active alerts</Badge>
      </div>
    );
  }
  return (
    <div data-testid="point6-badges" className="flex flex-wrap items-center gap-2">
      {badges.map((b) => (
        <Badge key={b.key} variant="outline" className={`gap-1 ${TONE[b.tone]}`} data-testid={`badge-${b.key}`}>
          <b.Icon className="h-3 w-3" strokeWidth={1.75} />
          {b.label}
        </Badge>
      ))}
    </div>
  );
}

export default Point6DashboardBadges;
