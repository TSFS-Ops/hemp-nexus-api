/**
 * Global status banner — surfaces active incidents at the top of every
 * authenticated shell. Zero-swallowed-errors compliant.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Wrench } from "lucide-react";
import { listIncidents, type SupportIncident } from "@/lib/support/client";

const ACTIVE_STATUSES: Array<SupportIncident["status"]> = [
  "investigating",
  "identified",
  "monitoring",
  "in_progress",
];

export function SupportStatusBanner() {
  const [incident, setIncident] = useState<SupportIncident | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await listIncidents();
        if (!alive) return;
        const active = rows.find((r) => ACTIVE_STATUSES.includes(r.status));
        setIncident(active ?? null);
      } catch {
        /* silent — banner is best-effort */
      }
    })();
    const t = window.setInterval(async () => {
      try {
        const rows = await listIncidents();
        if (!alive) return;
        const active = rows.find((r) => ACTIVE_STATUSES.includes(r.status));
        setIncident(active ?? null);
      } catch {
        /* silent */
      }
    }, 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  if (!incident) return null;
  const isMaintenance = incident.severity === "maintenance";
  return (
    <div
      className={
        "border-b px-4 py-2 text-sm flex items-center gap-2 " +
        (isMaintenance
          ? "bg-amber-50 border-amber-200 text-amber-900"
          : "bg-red-50 border-red-200 text-red-900")
      }
      data-testid="support-status-banner"
    >
      {isMaintenance ? (
        <Wrench className="h-4 w-4 shrink-0" />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0" />
      )}
      <span className="font-medium">
        {isMaintenance ? "Scheduled maintenance:" : "Active incident:"}
      </span>
      <span className="truncate">{incident.title}</span>
      <Link
        to={`/support/incidents`}
        className="ml-auto underline underline-offset-2 whitespace-nowrap"
      >
        View status
      </Link>
    </div>
  );
}
