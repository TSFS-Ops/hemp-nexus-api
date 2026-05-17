import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * SecurityTab — minimal TOTP MFA enrolment + challenge UI.
 *
 * Purpose
 * ───────
 * Allow the signed-in user (notably platform admins) to:
 *   1. enrol an authenticator-app (TOTP) factor;
 *   2. challenge+verify an existing verified factor to upgrade the
 *      current session to `aal2`.
 *
 * This is the smallest surface needed to satisfy `assertAal2` in
 * `supabase/functions/_shared/aal.ts` for protected admin endpoints
 * such as `admin-match-legacy-repair`.
 *
 * Scope (deliberately narrow):
 *   • TOTP only (no SMS, no recovery codes, no per-org policy).
 *   • One factor per user (Supabase enforces unique friendly_name).
 *   • No admin-managed enrolment for other users.
 *   • The QR / secret is held in component state only and discarded
 *     once the factor is verified or the user cancels. It is never
 *     logged, never persisted to localStorage, never sent anywhere
 *     other than the Supabase MFA API.
 */

type FactorRow = {
  id: string;
  factor_type: string;
  status: "unverified" | "verified";
  friendly_name?: string | null;
  created_at?: string;
};

type EnrolPending = {
  factorId: string;
  qr: string; // SVG data URL from Supabase
  secret: string; // TOTP shared secret (manual entry fallback)
};

export function SecurityTab() {
  const [loading, setLoading] = useState(true);
  const [factors, setFactors] = useState<FactorRow[]>([]);
  const [currentAal, setCurrentAal] = useState<"aal1" | "aal2" | "unknown">("unknown");
  const [enrolPending, setEnrolPending] = useState<EnrolPending | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: factorsData, error: factorsErr }, { data: aalData }] =
        await Promise.all([
          supabase.auth.mfa.listFactors(),
          supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        ]);
      if (factorsErr) throw factorsErr;
      // listFactors returns { totp: Factor[], all: Factor[] } across SDK versions
      const all = (factorsData as any)?.all ?? (factorsData as any)?.totp ?? [];
      setFactors(all as FactorRow[]);
      const cur = (aalData as any)?.currentLevel ?? "unknown";
      setCurrentAal(cur === "aal2" ? "aal2" : cur === "aal1" ? "aal1" : "unknown");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load security status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const verifiedFactor = factors.find((f) => f.status === "verified");
  const hasVerifiedFactor = Boolean(verifiedFactor);

  const startEnrolment = async () => {
    setBusy(true);
    try {
      // If there's a stale unverified factor, unenrol it so enroll() can succeed.
      const stale = factors.find((f) => f.status === "unverified");
      if (stale) {
        await supabase.auth.mfa.unenroll({ factorId: stale.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator (${new Date().toISOString().slice(0, 10)})`,
      });
      if (error) throw error;
      const totp = (data as any)?.totp;
      const factorId = (data as any)?.id;
      if (!factorId || !totp?.qr_code || !totp?.secret) {
        throw new Error("Enrolment response missing QR/secret");
      }
      setEnrolPending({ factorId, qr: totp.qr_code, secret: totp.secret });
      setCode("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start MFA enrolment");
    } finally {
      setBusy(false);
    }
  };

  const cancelEnrolment = async () => {
    if (!enrolPending) return;
    setBusy(true);
    try {
      await supabase.auth.mfa.unenroll({ factorId: enrolPending.factorId });
    } catch {
      // best-effort
    } finally {
      setEnrolPending(null);
      setCode("");
      setBusy(false);
      refresh();
    }
  };

  const verifyEnrolment = async () => {
    if (!enrolPending) return;
    const clean = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(clean)) {
      toast.error("Enter the 6-digit code from your authenticator app");
      return;
    }
    setBusy(true);
    try {
      const { data: challengeData, error: challengeErr } =
        await supabase.auth.mfa.challenge({ factorId: enrolPending.factorId });
      if (challengeErr) throw challengeErr;
      const challengeId = (challengeData as any)?.id;
      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId: enrolPending.factorId,
        challengeId,
        code: clean,
      });
      if (verifyErr) throw verifyErr;
      toast.success("Authenticator enrolled. This session is now MFA-verified.");
      setEnrolPending(null);
      setCode("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not verify code");
    } finally {
      setBusy(false);
    }
  };

  const challengeExisting = async () => {
    if (!verifiedFactor) return;
    const clean = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(clean)) {
      toast.error("Enter the 6-digit code from your authenticator app");
      return;
    }
    setBusy(true);
    try {
      const { data: challengeData, error: challengeErr } =
        await supabase.auth.mfa.challenge({ factorId: verifiedFactor.id });
      if (challengeErr) throw challengeErr;
      const challengeId = (challengeData as any)?.id;
      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId: verifiedFactor.id,
        challengeId,
        code: clean,
      });
      if (verifyErr) throw verifyErr;
      toast.success("Extra security code verified for this session.");
      setCode("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not verify code");
    } finally {
      setBusy(false);
    }
  };

  const removeFactor = async () => {
    if (!verifiedFactor) return;
    if (!window.confirm("Remove this authenticator? You will lose access to protected admin actions until you enrol an authenticator app again.")) {
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: verifiedFactor.id });
      if (error) throw error;
      toast.success("Authenticator removed.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove authenticator");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground/70">Loading…</div>;
  }

  return (
    <div className="space-y-8 md:space-y-10 max-w-2xl">
      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wider uppercase text-muted-foreground">
          Two-step verification
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Sensitive platform-admin actions (legacy match repair, manual state
          overrides) require an authenticator app to generate a 6-digit
          security code for this browser session. Enrol an authenticator app
          below, then enter the current code whenever the system asks you to
          verify again. If you see a message saying extra verification is
          required (error code{" "}
          <span className="font-mono text-foreground">MFA_REQUIRED</span>),
          return to this tab and enter the 6-digit code from your authenticator
          app to continue.
        </p>
        <StatusRow
          label="This session"
          value={
            currentAal === "aal2"
              ? "Extra security code verified for this session"
              : "Extra security code not verified for this session"
          }
          ok={currentAal === "aal2"}
        />
        <StatusRow
          label="Authenticator app"
          value={
            hasVerifiedFactor
              ? `Authenticator app enabled${
                  verifiedFactor!.friendly_name
                    ? ` — ${verifiedFactor!.friendly_name}`
                    : ""
                }`
              : "Authenticator app not yet enabled"
          }
          ok={hasVerifiedFactor}
        />
      </section>

      {!hasVerifiedFactor && !enrolPending && (
        <section className="space-y-3">
          <button
            onClick={startEnrolment}
            disabled={busy}
            className="inline-flex items-center justify-center px-6 py-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-[44px]"
          >
            {busy ? "Starting…" : "Enrol authenticator app"}
          </button>
          <p className="text-xs text-muted-foreground/70 leading-relaxed">
            We recommend 1Password, Authy, Google Authenticator, or any RFC 6238
            TOTP app.
          </p>
        </section>
      )}

      {enrolPending && (
        <section className="space-y-4 border border-border rounded-md p-4 md:p-6 bg-card">
          <h3 className="text-sm font-medium text-foreground">Scan this QR code</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Scan the QR code with your authenticator app, then enter the 6-digit
            code below to confirm.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <img
              src={enrolPending.qr}
              alt="MFA QR code"
              className="w-40 h-40 bg-white p-2 rounded-md border border-border"
              data-testid="mfa-qr"
            />
            <div className="flex-1 space-y-2 min-w-0">
              <label className="block text-[11px] font-medium tracking-wider uppercase text-muted-foreground">
                Secret (manual entry)
              </label>
              <code
                className="block break-all bg-muted border border-border rounded px-3 py-2 text-xs font-mono text-foreground"
                data-testid="mfa-secret"
              >
                {enrolPending.secret}
              </code>
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-[11px] font-medium tracking-wider uppercase text-muted-foreground">
              6-digit code
            </label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className="w-full sm:w-48 bg-card border border-border rounded-md px-4 py-3 text-base font-mono tracking-[0.4em] text-foreground focus:outline-none focus:border-slate-400 transition-colors"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={verifyEnrolment}
              disabled={busy || code.length !== 6}
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-[44px]"
            >
              {busy ? "Verifying…" : "Verify and enable"}
            </button>
            <button
              onClick={cancelEnrolment}
              disabled={busy}
              className="inline-flex items-center justify-center px-4 py-2.5 rounded-md border border-border text-foreground text-sm font-medium hover:bg-muted transition-colors min-h-[44px]"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {hasVerifiedFactor && currentAal !== "aal2" && (
        <section className="space-y-3 border border-border rounded-md p-4 md:p-6 bg-card">
          <h3 className="text-sm font-medium text-foreground">Verify MFA for this session</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Your authenticator app is enabled, but you have not yet entered a
            6-digit code in this browser session. Enter the current code from
            your authenticator app to unlock protected admin actions.
          </p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            className="w-full sm:w-48 bg-card border border-border rounded-md px-4 py-3 text-base font-mono tracking-[0.4em] text-foreground focus:outline-none focus:border-slate-400 transition-colors"
          />
          <button
            onClick={challengeExisting}
            disabled={busy || code.length !== 6}
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-[44px]"
          >
            {busy ? "Verifying…" : "Verify code"}
          </button>
        </section>
      )}

      {hasVerifiedFactor && (
        <section className="border-t border-border pt-6">
          <button
            onClick={removeFactor}
            disabled={busy}
            className="inline-flex items-center justify-center px-4 py-2.5 rounded-md border border-destructive/50 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors min-h-[44px] disabled:opacity-50"
          >
            Remove authenticator
          </button>
        </section>
      )}
    </div>
  );
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-border last:border-b-0">
      <span className="text-xs font-medium tracking-wider uppercase text-muted-foreground">{label}</span>
      <span className={`text-sm ${ok ? "text-primary" : "text-muted-foreground"}`}>{value}</span>
    </div>
  );
}
