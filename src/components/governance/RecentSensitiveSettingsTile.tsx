/**
 * RecentSensitiveSettingsTile - Batch G Fix 5.
 *
 * Read-only operator surface for recent platform-setting flips. Sources:
 *
 *   - admin_audit_logs.action = 'admin_settings.changed'  (generic trigger)
 *   - admin_audit_logs.action IN ('maintenance_mode.enabled',
 *                                 'maintenance_mode.disabled')
 *
 * Renders the last 10 rows so operators can see at a glance whether
 * billing was just disabled, test-mode bypass was just flipped, or
 * maintenance mode was just toggled - without dropping to raw SQL.
 *
 * RLS on admin_audit_logs already restricts reads to admins, so this
 * component shows an empty state for everyone else.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface AuditRow {
  id: string;
  action: string;
  admin_user_id: string | null;
  created_at: string;
  details: Record<string, unknown> | null;
}

const ACTIONS = [
  "admin_settings.changed",
  "maintenance_mode.enabled",
  "maintenance_mode.disabled",
];

function formatTs(iso: string): string {
  try {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  } catch {
    return iso;
  }
}

function shortActor(id: string | null): string {
  if (!id) return "system";
  return id.slice(0, 8);
}

function summarise(row: AuditRow): { key: string; before: string; after: string; sensitive: boolean } {
  const d = row.details ?? {};
  const key =
    (d.key as string | undefined) ??
    (row.action === "maintenance_mode.enabled" || row.action === "maintenance_mode.disabled"
      ? "general.maintenanceMode"
      : row.action);
  const sensitive = (d.sensitive as boolean | undefined) ?? true;
  const before = JSON.stringify(d.previous_value ?? d.previous_state ?? null);
  const after = JSON.stringify(d.new_value ?? d.new_state ?? null);
  return { key, before, after, sensitive };
}

export function RecentSensitiveSettingsTile() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["recent-sensitive-settings"],
    queryFn: async (): Promise<AuditRow[]> => {
      const { data, error } = await supabase
        .from("admin_audit_logs")
        .select("id, action, admin_user_id, created_at, details")
        .in("action", ACTIONS)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
    refetchInterval: 60_000,
  });

  return (
    <section className="mt-10" data-testid="recent-sensitive-settings-tile">
      <div className="flex items-baseline justify-between pb-3 border-b border-border mb-0">
        <h2 className="text-base font-medium text-foreground tracking-tight">
          Recent Sensitive Setting Changes
        </h2>
        <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground/70">
          billing · test-mode · maintenance · last 10
        </p>
      </div>
      <ul className="divide-y divide-border border border-border border-t-0 bg-card">
        {isLoading ? (
          <li className="px-5 py-6 text-sm text-muted-foreground">loading audit feed…</li>
        ) : error ? (
          <li className="px-5 py-6 text-sm text-muted-foreground">
            Unable to load audit feed (admin access required).
          </li>
        ) : !data || data.length === 0 ? (
          <li className="px-5 py-6 text-sm text-muted-foreground">
            No sensitive setting changes recorded.
          </li>
        ) : (
          data.map((row) => {
            const s = summarise(row);
            return (
              <li
                key={row.id}
                className="grid grid-cols-[180px_180px_80px_1fr] gap-4 items-start px-5 py-3"
                data-testid="recent-sensitive-settings-row"
              >
                <p className="font-mono text-[11px] text-muted-foreground">
                  {formatTs(row.created_at)}
                </p>
                <p className="text-[13px] text-foreground truncate" title={s.key}>
                  {s.key}
                </p>
                <p
                  className={`font-mono text-[10px] tracking-[0.2em] uppercase ${
                    s.sensitive ? "text-amber-700" : "text-muted-foreground"
                  }`}
                  title={`actor ${shortActor(row.admin_user_id)}`}
                >
                  {s.sensitive ? "SENSITIVE" : "info"}
                </p>
                <p
                  className="font-mono text-[11px] text-muted-foreground truncate"
                  title={`before: ${s.before}\nafter:  ${s.after}\nactor: ${row.admin_user_id ?? "system"}`}
                >
                  {s.before} → {s.after}
                </p>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}

export default RecentSensitiveSettingsTile;
