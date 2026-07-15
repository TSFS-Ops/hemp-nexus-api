/**
 * Support portal shell — landing for authenticated end-users.
 * Tabs: Overview (my tickets + banner), Knowledge base, Status.
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { FullPageLoader } from "@/components/ui/full-page-loader";
import { useToast } from "@/hooks/use-toast";
import { SupportStatusBanner } from "@/components/support/StatusBanner";
import {
  listOwnTickets,
  listKbArticles,
  listIncidents,
  type SupportTicketSummary,
  type KbArticleSummary,
  type SupportIncident,
} from "@/lib/support/client";
import { formatDistanceToNow } from "date-fns";

function statusBadgeVariant(
  status: SupportTicketSummary["status"]
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "resolved":
    case "closed":
      return "secondary";
    case "waiting_for_customer":
      return "outline";
    case "reopened":
      return "destructive";
    default:
      return "default";
  }
}

export default function SupportPortal() {
  const nav = useNavigate();
  const { toast } = useToast();
  const [tickets, setTickets] = useState<SupportTicketSummary[] | null>(null);
  const [kb, setKb] = useState<KbArticleSummary[] | null>(null);
  const [incidents, setIncidents] = useState<SupportIncident[] | null>(null);
  const [kbQuery, setKbQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [t, k, i] = await Promise.all([
          listOwnTickets().catch(() => []),
          listKbArticles().catch(() => []),
          listIncidents().catch(() => []),
        ]);
        if (!alive) return;
        setTickets(t);
        setKb(k);
        setIncidents(i);
      } catch (e) {
        toast({
          title: "Could not load support portal",
          description: (e as Error).message,
          variant: "destructive",
        });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [toast]);

  if (loading) return <FullPageLoader />;

  return (
    <div className="min-h-screen bg-background">
      <SupportStatusBanner />
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Support centre</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Raise a request, follow its progress, browse guidance, and check
              platform status. All requests are recorded for audit and only
              seen by authorised Izenzo staff.
            </p>
          </div>
          <Button onClick={() => nav("/support/new")}>New request</Button>
        </div>

        <Tabs defaultValue="tickets" className="space-y-4">
          <TabsList>
            <TabsTrigger value="tickets">My requests</TabsTrigger>
            <TabsTrigger value="kb">Knowledge base</TabsTrigger>
            <TabsTrigger value="status">Platform status</TabsTrigger>
          </TabsList>

          <TabsContent value="tickets" className="space-y-3">
            {!tickets || tickets.length === 0 ? (
              <Card>
                <CardContent className="pt-6 text-sm text-muted-foreground">
                  You have not raised any support requests yet.
                </CardContent>
              </Card>
            ) : (
              tickets.map((t) => (
                <Card
                  key={t.id}
                  className="cursor-pointer hover:border-primary/40 transition"
                  onClick={() => nav(`/support/tickets/${t.id}`)}
                >
                  <CardContent className="pt-5 pb-4 flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-muted-foreground">
                          {t.ticket_number}
                        </span>
                        <Badge variant={statusBadgeVariant(t.status)}>
                          {t.status.replace(/_/g, " ")}
                        </Badge>
                        <Badge variant="outline">{t.priority}</Badge>
                      </div>
                      <div className="font-medium truncate">{t.subject}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Updated{" "}
                        {formatDistanceToNow(new Date(t.updated_at), {
                          addSuffix: true,
                        })}
                      </div>
                    </div>
                    {t.sla_first_response_due_at && !t.first_response_at && (
                      <div className="text-xs text-right">
                        <div className="text-muted-foreground">
                          First response due
                        </div>
                        <div className="font-medium">
                          {formatDistanceToNow(
                            new Date(t.sla_first_response_due_at),
                            { addSuffix: true }
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="kb" className="space-y-3">
            <Input
              placeholder="Search knowledge base…"
              value={kbQuery}
              onChange={(e) => setKbQuery(e.target.value)}
            />
            {(kb ?? [])
              .filter((a) =>
                !kbQuery
                  ? true
                  : a.title.toLowerCase().includes(kbQuery.toLowerCase()) ||
                    (a.summary ?? "").toLowerCase().includes(kbQuery.toLowerCase())
              )
              .map((a) => (
                <Card key={a.id}>
                  <CardHeader>
                    <CardTitle className="text-base">
                      <Link to={`/support/kb/${a.slug}`} className="hover:underline">
                        {a.title}
                      </Link>
                    </CardTitle>
                    {a.summary && (
                      <CardDescription>{a.summary}</CardDescription>
                    )}
                  </CardHeader>
                </Card>
              ))}
            {(kb ?? []).length === 0 && (
              <div className="text-sm text-muted-foreground">
                No published articles yet.
              </div>
            )}
          </TabsContent>

          <TabsContent value="status" className="space-y-3">
            {(incidents ?? []).length === 0 ? (
              <Card>
                <CardContent className="pt-6 text-sm">
                  All systems operational.
                </CardContent>
              </Card>
            ) : (
              (incidents ?? []).map((i) => (
                <Card key={i.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{i.title}</CardTitle>
                      <Badge
                        variant={
                          i.status === "resolved" || i.status === "completed"
                            ? "secondary"
                            : "destructive"
                        }
                      >
                        {i.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <CardDescription>
                      <span className="font-mono text-xs">
                        {i.incident_number}
                      </span>{" "}
                      · severity {i.severity} · started{" "}
                      {formatDistanceToNow(new Date(i.started_at), {
                        addSuffix: true,
                      })}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{i.summary}</p>
                    <Link
                      to={`/support/incidents`}
                      className="text-sm text-primary hover:underline mt-2 inline-block"
                    >
                      View updates
                    </Link>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
