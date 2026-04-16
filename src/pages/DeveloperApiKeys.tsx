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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created: string;
}

const MOCK_KEYS: ApiKeyRow[] = [
  {
    id: "1",
    name: "Production — Backend",
    prefix: "sk_live_7Hq2X9Bm4K",
    scopes: ["trade:read", "trade:write", "poi:generate"],
    created: "2025-03-12",
  },
  {
    id: "2",
    name: "Staging — CI Pipeline",
    prefix: "sk_test_3Lp8R2Wn1V",
    scopes: ["trade:read", "webhooks:manage"],
    created: "2025-03-08",
  },
  {
    id: "3",
    name: "Analytics Worker",
    prefix: "sk_live_9Tk4M6Yc8Q",
    scopes: ["audit:read"],
    created: "2025-02-21",
  },
  {
    id: "4",
    name: "Mobile SDK",
    prefix: "sk_live_2Fz1N5Jb7P",
    scopes: ["trade:read", "poi:read"],
    created: "2025-01-30",
  },
];

const NAV_ITEMS = [
  { href: "/developers", label: "API Overview", icon: LayoutGrid },
  { href: "/developers/keys", label: "API Keys (Active)", icon: Key },
  { href: "/developers/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/developers/dlq", label: "Dead-Letter Queue", icon: Inbox },
  { href: "/developers/docs", label: "Documentation", icon: BookOpen },
];

export default function DeveloperApiKeys() {
  const location = useLocation();
  const [keys, setKeys] = useState(MOCK_KEYS);

  const handleRevoke = (id: string) => {
    setKeys((prev) => prev.filter((k) => k.id !== id));
  };

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
              item.href === "/developers/keys" ||
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
        <div className="max-w-5xl mx-auto px-8 py-10">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-foreground">API Keys</h1>
              <p className="text-sm text-muted-foreground mt-1.5">
                Manage secret keys used to authenticate API requests from your
                servers.
              </p>
            </div>
            <Button className="bg-foreground text-background hover:bg-foreground/90 gap-2">
              <Plus className="h-4 w-4" />
              Create Secret Key
            </Button>
          </div>

          {/* Data table */}
          <div className="border border-border rounded-md overflow-hidden bg-background">
            <table className="w-full text-sm" data-admin-table>
              <thead className="bg-secondary border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Key Name
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Token Prefix
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Permissions (Scopes)
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Created
                  </th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.map((row, idx) => (
                  <tr
                    key={row.id}
                    className={cn(
                      idx !== keys.length - 1 && "border-b border-border",
                    )}
                  >
                    <td className="px-4 py-3 text-foreground font-medium">
                      {row.name}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-[13px] text-foreground bg-secondary px-2 py-0.5 rounded border border-border">
                        {row.prefix}…
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {row.scopes.map((scope) => (
                          <span
                            key={scope}
                            className="font-mono text-[11px] text-foreground bg-secondary px-1.5 py-0.5 rounded border border-border"
                          >
                            {scope}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">
                      {row.created}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleRevoke(row.id)}
                        className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
                {keys.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-12 text-center text-sm text-muted-foreground"
                    >
                      No active API keys.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs text-muted-foreground font-mono">
            Showing {keys.length} active keys · Revoked keys retained for 90 days
            for audit.
          </p>
        </div>
      </main>
    </div>
  );
}
