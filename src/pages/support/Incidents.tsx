/**
 * Public status page — lists current + past incidents and their updates.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FullPageLoader } from "@/components/ui/full-page-loader";
import {
  listIncidents,
  listIncidentUpdates,
  type SupportIncident,
  type SupportIncidentUpdate,
} from "@/lib/support/client";
import { format, formatDistanceToNow } from "date-fns";

export default function Incidents() {
  const [rows, setRows] = useState<SupportIncident[] | null>(null);
  const [updates, setUpdates] = useState<Record<string, SupportIncidentUpdate[]>>(
    {}
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      const inc = await listIncidents().catch(() => []);
      if (!alive) return;
      setRows(inc);
      const map: Record<string, SupportIncidentUpdate[]> = {};
      await Promise.all(
        inc.map(async (i) => {
          map[i.id] = await listIncidentUpdates(i.id).catch(() => []);
        })
      );
      if (alive) setUpdates(map);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!rows) return <FullPageLoader />;

  const active = rows.filter(
    (r) =>
      !["resolved", "completed"].includes(r.status) &&
      r.severity !== "maintenance"
  );
  const scheduled = rows.filter(
    (r) => r.severity === "maintenance" && r.status !== "completed"
  );
  const past = rows.filter(
    (r) =>
      ["resolved", "completed"].includes(r.status) &&
      r.severity !== "maintenance"
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div>
          <Link
            to="/support"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Support centre
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Platform status</h1>
        </div>

        <Section title="Active incidents" empty="All systems operational." rows={active} updates={updates} />
        <Section title="Scheduled maintenance" empty="No maintenance scheduled." rows={scheduled} updates={updates} />
        <Section title="Recent history" empty="Nothing to show." rows={past.slice(0, 20)} updates={updates} />
      </div>
    </div>
  );
}

function Section({
  title,
  empty,
  rows,
  updates,
}: {
  title: string;
  empty: string;
  rows: SupportIncident[];
  updates: Record<string, SupportIncidentUpdate[]>;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {rows.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm">{empty}</CardContent>
        </Card>
      ) : (
        rows.map((i) => (
          <Card key={i.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base">{i.title}</CardTitle>
                <Badge
                  variant={
                    ["resolved", "completed"].includes(i.status)
                      ? "secondary"
                      : i.severity === "critical"
                        ? "destructive"
                        : "default"
                  }
                >
                  {i.status.replace(/_/g, " ")}
                </Badge>
              </div>
              <CardDescription>
                <span className="font-mono text-xs">{i.incident_number}</span> ·{" "}
                {i.severity} · started{" "}
                {format(new Date(i.started_at), "PPpp")} ·{" "}
                {formatDistanceToNow(new Date(i.started_at), { addSuffix: true })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {i.summary && <p>{i.summary}</p>}
              {i.affected_components.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {i.affected_components.map((c) => (
                    <Badge key={c} variant="outline" className="text-xs">
                      {c}
                    </Badge>
                  ))}
                </div>
              )}
              {(updates[i.id] ?? []).length > 0 && (
                <div className="border-t pt-2 space-y-2">
                  {(updates[i.id] ?? []).map((u) => (
                    <div key={u.id} className="text-xs">
                      <div className="text-muted-foreground">
                        {format(new Date(u.created_at), "PPpp")} · {u.status}
                      </div>
                      <div>{u.body}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
