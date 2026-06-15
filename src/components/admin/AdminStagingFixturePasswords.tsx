/**
 * AdminStagingFixturePasswords
 *
 * Staging-only operator panel. Lets a platform_admin generate a fresh
 * temporary password for one of the four Batch A fixture accounts and
 * receive a one-time reveal URL. The password itself is never displayed
 * in this panel and never logged. The reveal URL must be opened within
 * 5 minutes and shows the password exactly once.
 *
 * The backing edge functions refuse on production tier.
 */

import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Copy, KeyRound, Loader2, ShieldAlert, Eye } from "lucide-react";

const FIXTURE_EMAILS = [
  "api@izenzo.co.za",
  "trade@izenzo.co.za",
  "test1@izenzo.co.za",
  "test2@izenzo.co.za",
] as const;

type RevealRecord = {
  email: string;
  url: string;
  expiresAt: string;
};

export function AdminStagingFixturePasswords() {
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [reveals, setReveals] = useState<Record<string, RevealRecord>>({});
  const [revealedPassword, setRevealedPassword] = useState<{ email: string; password: string } | null>(null);

  const buildRevealUrl = (token: string) =>
    `${window.location.origin}/staging/reveal-password?token=${encodeURIComponent(token)}`;

  const handleGenerate = async (email: string) => {
    setBusyEmail(email);
    try {
      const { data, error } = await supabase.functions.invoke(
        "staging-set-fixture-password",
        { body: { email } },
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const url = buildRevealUrl(data.reveal_token);
      setReveals((prev) => ({
        ...prev,
        [email]: { email, url, expiresAt: data.expires_at },
      }));
      toast.success(`Reveal link generated for ${email}`, {
        description: "Valid for 5 minutes. Single use.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Could not generate password for ${email}`, { description: message });
    } finally {
      setBusyEmail(null);
    }
  };

  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Reveal URL copied");
    } catch {
      toast.error("Copy failed - select the URL manually");
    }
  };

  const handleRevealHere = async (email: string, url: string) => {
    const token = new URL(url).searchParams.get("token") ?? "";
    setBusyEmail(email);
    try {
      const { data, error } = await supabase.functions.invoke(
        "staging-reveal-fixture-password",
        { body: { reveal_token: token } },
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setRevealedPassword({ email: data.email, password: data.password });
      // Burn the URL - it's now consumed.
      setReveals((prev) => {
        const next = { ...prev };
        delete next[email];
        return next;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Reveal failed", { description: message });
    } finally {
      setBusyEmail(null);
    }
  };

  const banner = useMemo(() => (
    <div className="flex items-start gap-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <div className="font-semibold">Staging only</div>
        <p className="mt-0.5 leading-snug">
          This workflow is disabled on production. Generated passwords appear
          exactly once via a single-use reveal link valid for 5 minutes. The
          password is never shown in this list and never logged.
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
            <KeyRound className="h-4 w-4" /> Batch A fixture accounts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {FIXTURE_EMAILS.map((email) => {
            const reveal = reveals[email];
            const busy = busyEmail === email;
            return (
              <div
                key={email}
                className="flex flex-col gap-2 rounded border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="font-mono text-sm text-slate-900">{email}</div>
                <div className="flex flex-wrap items-center gap-2">
                  {reveal && (
                    <>
                      <code className="max-w-[28rem] truncate rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">
                        {reveal.url}
                      </code>
                      <Button size="sm" variant="outline" onClick={() => handleCopy(reveal.url)}>
                        <Copy className="mr-1 h-3 w-3" /> Copy
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => handleRevealHere(email, reveal.url)}
                      >
                        <Eye className="mr-1 h-3 w-3" /> Reveal here
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    onClick={() => handleGenerate(email)}
                    disabled={busy}
                  >
                    {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                    {reveal ? "Regenerate" : "Generate"}
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {revealedPassword && (
        <Card className="border-emerald-300">
          <CardHeader>
            <CardTitle className="text-base">
              Password for {revealedPassword.email}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-slate-600">
              Copy now. This will not be shown again. Share via your agreed
              secure channel only - never paste into chat, email, or the test guide.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-slate-900 px-3 py-2 font-mono text-sm text-emerald-200">
                {revealedPassword.password}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(revealedPassword.password);
                  toast.success("Password copied");
                }}
              >
                <Copy className="mr-1 h-3 w-3" /> Copy
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRevealedPassword(null)}
              >
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default AdminStagingFixturePasswords;
