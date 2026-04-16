import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Key,
  Webhook,
  BookOpen,
  Inbox,
  LayoutGrid,
  Plus,
  Terminal,
  RotateCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/developers", label: "API Overview", icon: LayoutGrid },
  { href: "/developers/keys", label: "API Keys (Active)", icon: Key },
  { href: "/developers/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/developers/dlq", label: "Dead-Letter Queue", icon: Inbox },
  { href: "/developers/docs", label: "Documentation", icon: BookOpen },
];

interface Delivery {
  id: string;
  status: number;
  event: string;
  timestamp: string;
  endpoint: string;
  payload: Record<string, unknown>;
  response: Record<string, unknown>;
}

const DELIVERIES: Delivery[] = [
  {
    id: "evt_01HQ8X7K2N",
    status: 200,
    event: "poi.generated",
    timestamp: "14:02:45",
    endpoint: "https://api.acme-trading.com/hooks/izenzo",
    payload: {
      id: "evt_01HQ8X7K2N",
      type: "poi.generated",
      created_at: "2025-04-16T14:02:45Z",
      data: {
        poi_id: "poi_9f3aB2cD7e",
        trade_request_id: "tr_4kL8mN2pQ",
        org_id: "org_xK9j2nP4Rt",
        counterparty_org_id: "org_mB7v5wX3Yc",
        commodity: "AU_DORE",
        quantity_kg: 12500,
        price_per_oz_usd: 2384.5,
        currency: "USD",
        state: "ELIGIBLE",
        signature: "sha256:7Hq2X9Bm4K8tFp1Zr6Nw3JcY...",
      },
    },
    response: {
      status: 200,
      body: { received: true, ack: "evt_01HQ8X7K2N" },
      duration_ms: 142,
    },
  },
  {
    id: "evt_01HQ8X4M9P",
    status: 500,
    event: "wad.issued",
    timestamp: "13:58:11",
    endpoint: "https://api.acme-trading.com/hooks/izenzo",
    payload: {
      id: "evt_01HQ8X4M9P",
      type: "wad.issued",
      data: { wad_id: "wad_3mP9qR1sT" },
    },
    response: {
      status: 500,
      body: { error: "internal_server_error" },
      duration_ms: 8420,
    },
  },
  {
    id: "evt_01HQ8X1B7L",
    status: 200,
    event: "match.created",
    timestamp: "13:54:22",
    endpoint: "https://api.acme-trading.com/hooks/izenzo",
    payload: { id: "evt_01HQ8X1B7L", type: "match.created" },
    response: { status: 200, body: { ok: true }, duration_ms: 98 },
  },
  {
    id: "evt_01HQ8WZ4K3",
    status: 200,
    event: "trade_request.updated",
    timestamp: "13:49:07",
    endpoint: "https://api.acme-trading.com/hooks/izenzo",
    payload: { id: "evt_01HQ8WZ4K3", type: "trade_request.updated" },
    response: { status: 200, body: { ok: true }, duration_ms: 113 },
  },
  {
    id: "evt_01HQ8WV2N8",
    status: 408,
    event: "poi.expired",
    timestamp: "13:42:55",
    endpoint: "https://api.acme-trading.com/hooks/izenzo",
    payload: { id: "evt_01HQ8WV2N8", type: "poi.expired" },
    response: { status: 408, body: { error: "timeout" }, duration_ms: 30000 },
  },
  {
    id: "evt_01HQ8WS9R1",
    status: 200,
    event: "engagement.accepted",
    timestamp: "13:38:14",
    endpoint: "https://api.acme-trading.com/hooks/izenzo",
    payload: { id: "evt_01HQ8WS9R1", type: "engagement.accepted" },
    response: { status: 200, body: { ok: true }, duration_ms: 87 },
  },
  {
    id: "evt_01HQ8WP6M5",
    status: 200,
    event: "poi.generated",
    timestamp: "13:31:02",
    endpoint: "https://api.acme-trading.com/hooks/izenzo",
    payload: { id: "evt_01HQ8WP6M5", type: "poi.generated" },
    response: { status: 200, body: { ok: true }, duration_ms: 124 },
  },
];

function StatusPill({ status }: { status: number }) {
  const ok = status >= 200 && status < 300;
  const label = ok ? `${status} OK` : `${status} ERR`;
  return (
    <span
      className={cn(
        "inline-flex items-center font-mono text-[11px] px-1.5 py-0.5 rounded border tabular-nums",
        ok
          ? "text-emerald bg-emerald-muted border-emerald/20"
          : "text-destructive bg-destructive/5 border-destructive/20",
      )}
    >
      {label}
    </span>
  );
}

export default function DeveloperWebhooks() {
  const location = useLocation();
  const [selectedId, setSelectedId] = useState(DELIVERIES[0].id);
  const [tab, setTab] = useState<"request" | "response">("request");

  const selected =
    DELIVERIES.find((d) => d.id === selectedId) ?? DELIVERIES[0];

  const codeBody =
    tab === "request"
      ? JSON.stringify(selected.payload, null, 2)
      : JSON.stringify(selected.response, null, 2);

  return (
    <div className="min-h-screen-safe bg-background flex">
      {/* Developer sidebar */}
      <aside className="w-64 shrink-0 border-r border-border bg-secondary/40 flex flex-col">
        <div className="h-14 flex items-center gap-2 px-5 border-b border-border">
          <Terminal className="h-4 w-4 text-primary" />
          <span className="font-mono text-sm font-semibold text-foreground tracking-tight">
            developers
          </span>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active =
              item.href === "/developers/webhooks" ||
              location.pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors",
                  active
                    ? "bg-background text-foreground border border-border font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/60",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-border">
          <p className="font-mono text-[11px] text-muted-foreground leading-relaxed">
            ENV: <span className="text-foreground">production</span>
            <br />
            API: <span className="text-foreground">v2024-11-01</span>
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0">
        <div className="max-w-6xl mx-auto px-8 py-10">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-foreground">Webhooks</h1>
              <p className="text-sm text-muted-foreground mt-1.5">
                Inspect delivery logs and manage endpoints.
              </p>
            </div>
            <Button className="bg-foreground text-background hover:bg-foreground/90 gap-2">
              <Plus className="h-4 w-4" />
              Add Endpoint
            </Button>
          </div>

          {/* Split-pane container */}
          <div className="border border-border rounded-md overflow-hidden bg-background flex h-[640px]">
            {/* LEFT PANE — Delivery Queue */}
            <div className="w-[35%] border-r border-border flex flex-col min-w-0">
              <div className="h-10 flex items-center px-4 border-b border-border bg-secondary">
                <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
                  Delivery Queue
                </span>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">
                  {DELIVERIES.length} events
                </span>
              </div>
              <ul className="flex-1 overflow-y-auto">
                {DELIVERIES.map((d) => {
                  const active = d.id === selectedId;
                  return (
                    <li key={d.id}>
                      <button
                        onClick={() => setSelectedId(d.id)}
                        className={cn(
                          "w-full text-left px-4 py-3 border-b border-border transition-colors flex items-start gap-3 border-l-2",
                          active
                            ? "bg-secondary border-l-primary"
                            : "border-l-transparent hover:bg-secondary/50",
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <StatusPill status={d.status} />
                          <p className="font-mono text-[12px] text-foreground mt-1.5 truncate">
                            {d.event}
                          </p>
                        </div>
                        <span className="font-mono text-[11px] text-muted-foreground tabular-nums shrink-0 mt-0.5">
                          {d.timestamp}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* RIGHT PANE — Payload Details */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Endpoint header */}
              <div className="h-10 flex items-center gap-3 px-4 border-b border-border bg-secondary">
                <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground shrink-0">
                  POST
                </span>
                <span className="font-mono text-[12px] text-foreground truncate flex-1">
                  {selected.endpoint}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                >
                  <RotateCw className="h-3 w-3" />
                  Manual Retry
                </Button>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-border bg-background">
                {(
                  [
                    { id: "request" as const, label: "Request Payload" },
                    { id: "response" as const, label: "Response" },
                  ]
                ).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      "px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px",
                      tab === t.id
                        ? "text-foreground border-foreground"
                        : "text-muted-foreground border-transparent hover:text-foreground",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
                <div className="ml-auto flex items-center px-4 gap-2">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    event_id:
                  </span>
                  <span className="font-mono text-[11px] text-foreground">
                    {selected.id}
                  </span>
                </div>
              </div>

              {/* Code block */}
              <div className="flex-1 overflow-auto bg-secondary/50">
                <pre className="font-mono text-[12px] leading-relaxed text-foreground p-4 whitespace-pre">
                  {codeBody}
                </pre>
              </div>
            </div>
          </div>

          <p className="mt-4 text-xs text-muted-foreground font-mono">
            Showing last {DELIVERIES.length} deliveries · Logs retained 30 days ·
            Failed deliveries auto-retry with exponential backoff.
          </p>
        </div>
      </main>
    </div>
  );
}
