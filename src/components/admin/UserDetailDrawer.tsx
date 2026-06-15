import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, AlertTriangle, UserX, Shield, Building2, Wallet, FileText, Network, Bell, ScrollText } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";

const DELETION_CATEGORY_LABELS: Record<string, string> = {
  no_longer_needed: "No longer needed",
  switched_provider: "Switched provider",
  privacy_concerns: "Privacy concerns",
  missing_features: "Missing features",
  too_complex: "Too complex",
  cost: "Cost",
  other: "Other",
};

interface UserJourney {
  profile: any;
  organisation: any;
  roles: string[];
  wallet: any;
  token_transactions: any[];
  pois: any[];
  matches: any[];
  trade_requests: any[];
  pending_approvals: any[];
  admin_audit_logs: any[];
  audit_logs: any[];
  notifications: any[];
  poi_engagements: any[];
}

interface Props {
  userId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const fmt = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString() : "-";

const fmtMoney = (amount: number | null | undefined, ccy: string | null | undefined) => {
  if (amount == null) return "-";
  const n = Number(amount);
  if (Number.isNaN(n)) return String(amount);
  return `${ccy ?? ""} ${n.toLocaleString()}`.trim();
};

export default function UserDetailDrawer({ userId, open, onOpenChange }: Props) {
  const [data, setData] = useState<UserJourney | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setData(null);
      try {
        const json = await apiFetch<UserJourney>(`admin-user-journey?user_id=${userId}`);
        if (!cancelled) setData(json);
      } catch (err) {
        console.error("user journey fetch failed", err);
        toast.error("Failed to load user journey");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, userId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl lg:max-w-3xl overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            User journey
          </SheetTitle>
          <SheetDescription>
            Read-only audit view of this user's lifecycle. Every open is logged.
          </SheetDescription>
        </SheetHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && data && (
          <div className="mt-6 space-y-6">
            {/* Header summary */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between gap-2">
                  <span className="truncate">
                    {data.profile?.full_name || data.profile?.email || "Unknown user"}
                  </span>
                  {data.profile?.status === "pending_deletion" ? (
                    <Badge variant="destructive">
                      <UserX className="h-3 w-3 mr-1" /> Pending deletion
                    </Badge>
                  ) : (
                    <Badge variant="outline">{data.profile?.status ?? "unknown"}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                  <div><span className="text-muted-foreground">Email:</span> <span className="font-mono text-xs break-all">{data.profile?.email}</span></div>
                  <div><span className="text-muted-foreground">User ID:</span> <span className="font-mono text-xs break-all">{data.profile?.id}</span></div>
                  <div><span className="text-muted-foreground">Registered:</span> {fmt(data.profile?.created_at)}</div>
                  <div><span className="text-muted-foreground">Last sign-in:</span> {fmt(data.profile?.last_sign_in_at)}</div>
                  <div><span className="text-muted-foreground">Email verified:</span> {data.profile?.email_confirmed_at ? "Yes" : "No"}</div>
                  <div><span className="text-muted-foreground">Roles:</span> {data.roles?.length ? data.roles.join(", ") : "-"}</div>
                </div>
                {data.organisation && (
                  <div className="pt-2 mt-2 border-t flex items-center gap-2 text-xs text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5" />
                    <span>{data.organisation.name}</span>
                    <Badge variant="outline" className="text-[10px]">{data.organisation.status}</Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Deletion reason - front and centre */}
            {data.profile?.status === "pending_deletion" && (
              <Card className="border-destructive/40 bg-destructive/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    Why this user left
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div><span className="text-muted-foreground">Requested:</span> {fmt(data.profile.deletion_requested_at)}</div>
                  <div><span className="text-muted-foreground">Category:</span> {data.profile.deletion_category ? (DELETION_CATEGORY_LABELS[data.profile.deletion_category] || data.profile.deletion_category) : "-"}</div>
                  {data.profile.deletion_reason && (
                    <div className="rounded border border-destructive/30 bg-background/60 p-3 whitespace-pre-wrap break-words text-sm">
                      {data.profile.deletion_reason}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Tabbed activity */}
            <Tabs defaultValue="activity" className="w-full">
              <TabsList className="grid grid-cols-3 sm:grid-cols-6 w-full h-auto">
                <TabsTrigger value="activity" className="text-xs"><FileText className="h-3 w-3 mr-1" /> Trades</TabsTrigger>
                <TabsTrigger value="revenue" className="text-xs"><Wallet className="h-3 w-3 mr-1" /> Revenue</TabsTrigger>
                <TabsTrigger value="approvals" className="text-xs"><Shield className="h-3 w-3 mr-1" /> Approvals</TabsTrigger>
                <TabsTrigger value="engagements" className="text-xs"><Network className="h-3 w-3 mr-1" /> Engagements</TabsTrigger>
                <TabsTrigger value="notifications" className="text-xs"><Bell className="h-3 w-3 mr-1" /> Notified</TabsTrigger>
                <TabsTrigger value="audit" className="text-xs"><ScrollText className="h-3 w-3 mr-1" /> Audit</TabsTrigger>
              </TabsList>

              <TabsContent value="activity" className="space-y-4 mt-4">
                <Section title="Trade requests authored" empty={!data.trade_requests?.length}>
                  {data.trade_requests?.map((tr) => (
                    <Row key={tr.id}
                      left={<>
                        <span className="font-medium">{tr.commodity || "-"}</span>
                        <span className="text-xs text-muted-foreground ml-2">{tr.side} · {tr.match_type}</span>
                      </>}
                      right={<>
                        <span className="text-xs">{fmtMoney(tr.price_amount, tr.price_currency)}</span>
                        <Badge variant="outline" className="ml-2 text-[10px]">{tr.status}</Badge>
                      </>}
                      sub={fmt(tr.created_at)}
                    />
                  ))}
                </Section>
                <Section title="POIs (org)" empty={!data.pois?.length}>
                  {data.pois?.map((p) => (
                    <Row key={p.id}
                      left={<><span className="font-mono text-xs">{p.id.slice(0,8)}</span><span className="ml-2 text-xs text-muted-foreground">{p.industry_code} · {p.jurisdiction_code}</span></>}
                      right={<Badge variant="outline" className="text-[10px]">{p.state}</Badge>}
                      sub={`${p.poi_type} · ${fmt(p.created_at)}`}
                    />
                  ))}
                </Section>
                <Section title="Matches (org is party)" empty={!data.matches?.length}>
                  {data.matches?.map((m) => (
                    <Row key={m.id}
                      left={<><span className="font-medium">{m.commodity || "-"}</span><span className="ml-2 text-xs text-muted-foreground">{m.buyer_name} ↔ {m.seller_name}</span></>}
                      right={<Badge variant="outline" className="text-[10px]">{m.state || m.status}</Badge>}
                      sub={`${fmtMoney(m.price_amount, m.price_currency)} · ${fmt(m.created_at)}`}
                    />
                  ))}
                </Section>
              </TabsContent>

              <TabsContent value="revenue" className="space-y-4 mt-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Wallet</CardTitle></CardHeader>
                  <CardContent className="text-sm">
                    {data.wallet ? (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Current balance</span>
                        <span className="font-mono text-base">{Number(data.wallet.balance ?? 0).toLocaleString()} tokens</span>
                      </div>
                    ) : <p className="text-muted-foreground">No wallet for this org.</p>}
                  </CardContent>
                </Card>
                <Section title="Token / credit transactions (org-wide)" empty={!data.token_transactions?.length}>
                  {data.token_transactions?.map((t) => (
                    <Row key={t.id}
                      left={<><Badge variant={t.type === "purchase" || t.type === "credit" ? "default" : "outline"} className="text-[10px]">{t.type}</Badge><span className="ml-2 font-mono text-xs">{t.amount > 0 ? "+" : ""}{t.amount}</span></>}
                      right={<span className="text-xs text-muted-foreground">balance: {t.balance_after}</span>}
                      sub={fmt(t.created_at)}
                    />
                  ))}
                </Section>
              </TabsContent>

              <TabsContent value="approvals" className="space-y-4 mt-4">
                <Section title="Pending approvals" empty={!data.pending_approvals?.length}>
                  {data.pending_approvals?.map((a) => (
                    <Row key={a.id}
                      left={<><span className="font-mono text-xs">{a.id.slice(0,8)}</span><span className="ml-2 text-xs">{a.tier || a.required_role || a.approval_type || "approval"}</span></>}
                      right={<Badge variant="outline" className="text-[10px]">{a.status || a.state || "pending"}</Badge>}
                      sub={fmt(a.created_at)}
                    />
                  ))}
                </Section>
              </TabsContent>

              <TabsContent value="engagements" className="space-y-4 mt-4">
                <Section title="POI engagements" empty={!data.poi_engagements?.length}>
                  {data.poi_engagements?.map((e) => (
                    <Row key={e.id}
                      left={<><span className="font-mono text-xs">{e.id.slice(0,8)}</span><span className="ml-2 text-xs">{e.contact_email || e.invited_email || "-"}</span></>}
                      right={<Badge variant="outline" className="text-[10px]">{e.status || e.state}</Badge>}
                      sub={fmt(e.created_at)}
                    />
                  ))}
                </Section>
              </TabsContent>

              <TabsContent value="notifications" className="space-y-4 mt-4">
                <Section title="Recent notifications" empty={!data.notifications?.length}>
                  {data.notifications?.map((n) => (
                    <Row key={n.id}
                      left={<><span className="font-medium text-xs">{n.title || n.kind}</span></>}
                      right={n.read_at ? <Badge variant="outline" className="text-[10px]">read</Badge> : <Badge className="text-[10px]">unread</Badge>}
                      sub={fmt(n.created_at)}
                    />
                  ))}
                </Section>
              </TabsContent>

              <TabsContent value="audit" className="space-y-4 mt-4">
                <Section title="Admin actions affecting this user" empty={!data.admin_audit_logs?.length}>
                  {data.admin_audit_logs?.map((a) => (
                    <Row key={a.id}
                      left={<><span className="font-medium text-xs">{a.action}</span><span className="ml-2 text-xs text-muted-foreground">{a.target_type}</span></>}
                      right={a.ip_address ? <span className="text-[10px] text-muted-foreground font-mono">{a.ip_address}</span> : null}
                      sub={fmt(a.created_at)}
                      detail={a.details ? JSON.stringify(a.details) : undefined}
                    />
                  ))}
                </Section>
                <Section title="User-initiated audit events" empty={!data.audit_logs?.length}>
                  {data.audit_logs?.map((a) => (
                    <Row key={a.id}
                      left={<><span className="font-medium text-xs">{a.action}</span><span className="ml-2 text-xs text-muted-foreground">{a.entity_type}</span></>}
                      right={null}
                      sub={fmt(a.created_at)}
                    />
                  ))}
                </Section>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children, empty }: { title: string; children: React.ReactNode; empty?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        {empty ? <p className="text-xs text-muted-foreground">Nothing recorded.</p> : children}
      </CardContent>
    </Card>
  );
}

function Row({ left, right, sub, detail }: { left: React.ReactNode; right?: React.ReactNode; sub?: string; detail?: string }) {
  return (
    <div className="rounded border bg-card/50 px-3 py-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0 flex items-center flex-wrap">{left}</div>
        <div className="shrink-0">{right}</div>
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      {detail && <div className="text-[10px] text-muted-foreground mt-1 font-mono break-all line-clamp-2">{detail}</div>}
    </div>
  );
}
