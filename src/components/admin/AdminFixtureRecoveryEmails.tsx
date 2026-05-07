/**
 * AdminFixtureRecoveryEmails
 *
 * Production-safe HQ panel. Lets a platform_admin send a STANDARD Supabase
 * password recovery email to one of the four hard-coded Batch A fixture
 * accounts. The tester completes recovery from their own inbox.
 *
 * Hard rules:
 *  - Only the four allowlisted fixture emails can be targeted.
 *  - No password is generated, displayed, stored, logged, or shared.
 *  - The recovery link itself is never returned to this UI.
 *  - Each click writes one audit row: `uat.fixture_recovery_email_sent`.
 */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Mail, ShieldCheck, Loader2 } from "lucide-react";

const FIXTURES = [
  { email: "api@izenzo.co.za", role: "Initiator (org_admin)", org: "Batch A Initiator Ltd" },
  { email: "trade@izenzo.co.za", role: "Counterparty (org_admin)", org: "Batch A Counterparty Ltd" },
  { email: "test1@izenzo.co.za", role: "Unrelated tester (org_admin)", org: "Batch A Unrelated Ltd" },
  { email: "test2@izenzo.co.za", role: "Counterparty member (org_member)", org: "Batch A Counterparty Ltd" },
] as const;

type SentMap = Record<string, string>; // email -> ISO timestamp

const STORAGE_KEY = "hq:fixture-recovery:last-sent";

export function AdminFixtureRecoveryEmails() {
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [sent, setSent] = useState<SentMap>({});

  // Best-effort hydration of last-sent timestamps so a returning operator
  // still sees recent activity. The audit_log is the source of truth; this
  // is purely informational UI.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSent(JSON.parse(raw));
    } catch { /* ignore */ }

    // Pull the latest audit rows for this action so timestamps survive
    // device changes.
    (async () => {
      try {
        const { data } = await supabase
          .from("audit_logs")
          .select("metadata, created_at")
          .eq("action", "uat.fixture_recovery_email_sent")
          .order("created_at", { ascending: false })
          .limit(50);
        if (!data) return;
        const next: SentMap = {};
        for (const row of data) {
          const md = (row.metadata ?? {}) as { email?: string };
          if (md.email && !next[md.email]) {
            next[md.email] = row.created_at as unknown as string;
          }
        }
        if (Object.keys(next).length) {
          setSent((prev) => ({ ...next, ...prev }));
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const persist = (next: SentMap) => {
    setSent(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const handleSend = async (email: string) => {
    setBusyEmail(email);
    try {
      const { data, error } = await supabase.functions.invoke(
        "hq-fixture-recovery-email",
        { body: { email } },
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const ts = (data?.sent_at as string) ?? new Date().toISOString();
      persist({ ...sent, [email]: ts });
      toast.success(`Recovery email dispatched to ${email}`, {
        description: "Tester sets their own password from their inbox.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Could not send recovery email to ${email}`, { description: message });
    } finally {
      setBusyEmail(null);
    }
  };

  const banner = useMemo(() => (
    <div className="flex items-start gap-3 rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <div className="font-semibold">Standard recovery flow · Batch A fixtures only</div>
        <p className="mt-0.5 leading-snug">
          Sends the normal Supabase password recovery email to one of the four
          allowlisted fixture inboxes. No password is generated, shown, stored,
          or shared. The tester sets their own password from their inbox.
        </p>
      </div>
    </div>
  ), []);

  return (
    <div className="space-y-4">
      {banner}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" /> Batch A fixture recovery
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {FIXTURES.map((f) => {
            const busy = busyEmail === f.email;
            const lastSent = sent[f.email];
            return (
              <div
                key={f.email}
                className="flex flex-col gap-2 rounded border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <div className="font-mono text-sm text-slate-900">{f.email}</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <Badge variant="outline" className="font-normal">{f.role}</Badge>
                    <span>·</span>
                    <span>{f.org}</span>
                  </div>
                  {lastSent && (
                    <div className="text-xs text-slate-500">
                      Last sent: {new Date(lastSent).toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => handleSend(f.email)} disabled={busy}>
                    {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Mail className="mr-1 h-3 w-3" />}
                    Send recovery email
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

export default AdminFixtureRecoveryEmails;
