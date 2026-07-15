/**
 * Admin support queue — the operational cockpit.
 * Filters by status, priority, team; keyword search on subject.
 * SLA badges highlight breaches.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FullPageLoader } from "@/components/ui/full-page-loader";
import { useToast } from "@/hooks/use-toast";
import {
  adminListTickets,
  listTeams,
  type SupportTicketSummary,
} from "@/lib/support/client";
import { formatDistanceToNow } from "date-fns";

const STATUSES = [
  "all",
  "new",
  "in_progress",
  "waiting_for_customer",
  "resolved",
  "closed",
  "reopened",
  "cancelled",
] as const;
const PRIORITIES = ["all", "urgent", "high", "medium", "low"] as const;

export default function AdminSupportQueue() {
  const nav = useNavigate();
  const { toast } = useToast();
  const [rows, setRows] = useState<SupportTicketSummary[] | null>(null);
  const [teams, setTeams] = useState<Array<{ key: string; label: string }>>([]);
  const [filter, setFilter] = useState({
    status: "new" as (typeof STATUSES)[number],
    priority: "all" as (typeof PRIORITIES)[number],
    team: "all" as string,
    q: "",
  });

  useEffect(() => {
    listTeams()
      .then(setTeams)
      .catch(() => setTeams([]));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const t = await adminListTickets({
          status: filter.status,
          priority: filter.priority,
          team: filter.team,
          q: filter.q,
        });
        if (alive) setRows(t);
      } catch (e) {
        toast({
          title: "Queue load failed",
          description: (e as Error).message,
          variant: "destructive",
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [filter, toast]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-6 space-y-4">
        <div>
          <Link
            to="/hq"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← HQ
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Support queue</h1>
          <p className="text-sm text-muted-foreground">
            All open support requests. Click a row to triage, respond, or reassign.
          </p>
        </div>

        <Card>
          <CardContent className="pt-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Select
              value={filter.status}
              onValueChange={(v) =>
                setFilter({ ...filter, status: v as typeof filter.status })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filter.priority}
              onValueChange={(v) =>
                setFilter({ ...filter, priority: v as typeof filter.priority })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filter.team}
              onValueChange={(v) => setFilter({ ...filter, team: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Team" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All teams</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Search subject…"
              value={filter.q}
              onChange={(e) => setFilter({ ...filter, q: e.target.value })}
            />
          </CardContent>
        </Card>

        {!rows ? (
          <FullPageLoader />
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No tickets match these filters.
            </CardContent>
          </Card>
        ) : (
          rows.map((t) => {
            const now = Date.now();
            const dueFR = t.sla_first_response_due_at
              ? new Date(t.sla_first_response_due_at).getTime()
              : null;
            const breachedFR =
              dueFR !== null && !t.first_response_at && dueFR < now;
            return (
              <Card
                key={t.id}
                className="cursor-pointer hover:border-primary/40 transition"
                onClick={() => nav(`/admin/support/tickets/${t.id}`)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-muted-foreground">
                      {t.ticket_number}
                    </span>
                    <Badge>{t.status.replace(/_/g, " ")}</Badge>
                    <Badge variant="outline">{t.priority}</Badge>
                    {t.current_team_key && (
                      <Badge variant="secondary">{t.current_team_key}</Badge>
                    )}
                    {breachedFR && (
                      <Badge variant="destructive">FR breached</Badge>
                    )}
                  </div>
                  <CardTitle className="text-base">{t.subject}</CardTitle>
                  <CardDescription className="text-xs">
                    Updated{" "}
                    {formatDistanceToNow(new Date(t.updated_at), {
                      addSuffix: true,
                    })}
                    {t.sla_first_response_due_at && !t.first_response_at
                      ? ` · FR due ${formatDistanceToNow(new Date(t.sla_first_response_due_at), { addSuffix: true })}`
                      : ""}
                  </CardDescription>
                </CardHeader>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
