import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { hasPreAuthState } from "@/lib/pre-auth-state";
import { getSafeReturnTo } from "@/lib/safe-redirect";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { z } from "zod";
import { Loader2, ArrowLeft } from "lucide-react";
import { HashChainMotif } from "@/components/auth/HashChainMotif";
import { lovable } from "@/integrations/lovable";

const authSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const emailSchema = z.object({
  email: z.string().email("Invalid email address"),
});

type Mode = "signin" | "signup" | "forgot" | "reset";

export default function Auth() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [pageReady, setPageReady] = useState(false);
  const [verificationPending, setVerificationPending] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Tick down the resend cooldown each second
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // ── Post-auth routing: admins → /hq; new users → /welcome; returning → persisted persona ──
  const resolvePostAuthRoute = async (userId: string): Promise<string> => {
    console.info("[Auth] resolvePostAuthRoute:start", { userId });

    // 1) Platform admins always go to HQ — bypass returnTo & persona selector entirely.
    try {
      const { data: roleRows, error: roleErr } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      console.info("[Auth] role lookup", { roleRows, roleErr: roleErr?.message });
      const isPlatformAdmin = (roleRows || []).some(r => r.role === "platform_admin");
      if (isPlatformAdmin) {
        console.info("[Auth] resolved → /hq/users (platform admin)");
        return "/hq/users";
      }
    } catch (e) {
      console.warn("[Auth] role lookup threw — falling through", e);
    }

    // 2) Honour returnTo for non-admins (deep-link recovery)
    const returnTo = searchParams.get("returnTo");
    if (returnTo) {
      const safe = getSafeReturnTo(returnTo);
      if (safe && safe !== "/dashboard") {
        const final = `${safe}${safe.includes("?") ? "&" : "?"}resume=1`;
        console.info("[Auth] resolved → returnTo", final);
        return final;
      }
    }

    // 3) Persisted persona → workspace; otherwise persona selector
    try {
      const { data, error: profErr } = await supabase
        .from("profiles")
        .select("selected_persona")
        .eq("id", userId)
        .maybeSingle();
      console.info("[Auth] persona lookup", { persona: data?.selected_persona, profErr: profErr?.message });

      const persona = data?.selected_persona;
      if (!persona) return "/welcome";
      if (persona === "developer") return "/developers/keys";
      if (persona === "governance") return "/governance/triage";
      // trade
      if (hasPreAuthState()) return "/desk?resume=1";
      return "/desk";
    } catch (e) {
      console.warn("[Auth] persona lookup threw — defaulting to /welcome", e);
      return "/welcome";
    }
  };

  useEffect(() => {
    const type = searchParams.get("type");
    const code = searchParams.get("code");

    if (type === "recovery") {
      setMode("reset");
      toast.info("Enter your new password below");
    } else if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) toast.error(error.message);
        else toast.success("Your email has been verified. You can now sign in.");
      });
    }

    if (searchParams.get("expired") === "1") {
      toast.warning("Your session expired. Sign in to continue where you left off.", { duration: 8000 });
    } else if (searchParams.get("signedOut") === "1") {
      toast.info("You've been signed out successfully.", { duration: 5000 });
    }

    const timeoutId = setTimeout(() => setPageReady(true), 8000);

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      clearTimeout(timeoutId);
      if (session?.user) {
        // Already signed in — hard-navigate so the destination route's
        // <RequireAuth> guard sees the persisted session immediately.
        const route = await resolvePostAuthRoute(session.user.id);
        window.location.assign(route);
        return;
      }
      setPageReady(true);
    }).catch(() => {
      clearTimeout(timeoutId);
      setPageReady(true);
    });

    // NOTE: We deliberately do NOT register an onAuthStateChange listener here.
    // The post-signin redirect is owned by handleSignIn (see below) using a
    // hard navigation. Adding a SPA navigate() in a SIGNED_IN listener races
    // with handleSignIn and can land us back on /auth?returnTo=… because the
    // destination's <RequireAuth> reads AuthContext, which hasn't yet
    // propagated the new session.

    return () => {
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, searchParams]);

  // ── Handlers ──
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    try {
      authSchema.parse({ email, password });
      setLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.message.includes("Email not confirmed")) {
          setVerificationPending(true);
          throw new Error("Please verify your email before signing in.");
        }
        throw error;
      }
      // ── Post-auth redirect.
      // We use a HARD navigation (window.location) rather than React Router's
      // navigate() because the destination route (e.g. /hq/users) is wrapped in
      // <RequireAuth>, which reads `isAuthenticated` from AuthContext. After
      // signInWithPassword resolves, the Supabase client has the session, but
      // AuthContext's onAuthStateChange handler hasn't yet propagated it into
      // React state. A SPA navigate causes RequireAuth to mount with
      // isAuthenticated=false and bounce back to /auth?returnTo=… (the bug
      // we hit). A full reload forces AuthContext to re-initialise from
      // getSession() with the persisted session already present.
      if (data?.user) {
        console.info("[Auth] signInWithPassword → resolving redirect from handler");
        const route = await resolvePostAuthRoute(data.user.id);
        console.info("[Auth] handler hard-navigating →", route);
        window.location.assign(route);
        return;
      }
    } catch (err) {
      if (err instanceof z.ZodError) toast.error(err.errors[0].message);
      else if (err instanceof Error) {
        const m = err.message;
        if (m.includes("Invalid login")) toast.error("Incorrect email or password.");
        else if (m.includes("rate limit") || m.includes("too many") || m.includes("locked")) {
          toast.error("Too many attempts. Wait 5 minutes, then try again.", { duration: 10000 });
        } else toast.error(m || "Sign-in failed.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    try {
      authSchema.parse({ email, password });
      setLoading(true);
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth` },
      });
      if (error) throw error;
      setVerificationPending(true);
      toast.success("Check your email to verify your account.");
    } catch (err) {
      if (err instanceof z.ZodError) toast.error(err.errors[0].message);
      else if (err instanceof Error) {
        const lower = err.message.toLowerCase();
        if (lower.includes("already registered") || lower.includes("user already")) {
          toast.error("An account with this email already exists.");
        } else if (lower.includes("rate limit") || lower.includes("for security purposes")) {
          toast.error("Too many attempts. Please wait and try again.");
        } else if (lower.includes("password") && (lower.includes("weak") || lower.includes("pwned") || lower.includes("breach"))) {
          toast.error("This password has appeared in a data breach. Choose another.");
        } else {
          toast.error(err.message || "Unable to create account.");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    try {
      emailSchema.parse({ email });
      setLoading(true);
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setResetEmailSent(true);
      toast.success("Check your email for a reset link.");
    } catch (err) {
      if (err instanceof z.ZodError) toast.error(err.errors[0].message);
      else toast.info("If an account exists, you'll receive a reset email.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    try {
      authSchema.parse({ email: "reset@placeholder.com", password });
      setLoading(true);
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Your password has been updated.");
      setMode("signin");
      setPassword("");
    } catch (err) {
      if (err instanceof z.ZodError) toast.error(err.errors[0].message);
      else if (err instanceof Error) toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const resendVerification = async () => {
    if (!email) {
      toast.error("Enter your email first.");
      return;
    }
    if (resendCooldown > 0) return;
    try {
      setLoading(true);
      const { error } = await supabase.auth.resend({ type: "signup", email });
      if (error) throw error;
      toast.success("Verification email sent.");
      setResendCooldown(60);
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      // Supabase rate limit: "For security purposes, you can only request this after N seconds."
      const match = msg.match(/after (\d+) seconds?/i);
      if (match || err?.status === 429 || /rate.?limit/i.test(msg)) {
        const wait = match ? parseInt(match[1], 10) : 30;
        setResendCooldown(wait);
        toast.error(`Please wait ${wait}s before requesting another email.`);
      } else {
        toast.error(msg || "Failed to resend verification email.");
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Render ──
  return (
    <div
      className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2 bg-white"
      style={{
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* ═══════════════ LEFT — THE GATE (form) ═══════════════ */}
      <section className="relative flex flex-col bg-white px-6 sm:px-12 lg:px-20 xl:px-24 py-10 lg:py-12 min-h-screen">
        {/* Top: logo */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md flex items-center justify-center bg-emerald-950">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="text-[17px] font-semibold tracking-tight text-slate-900">Izenzo</span>
        </div>

        {/* Center: form */}
        <div className="flex-1 flex flex-col justify-center">
          <div className="w-full max-w-sm mx-auto py-12">
            {!pageReady ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : verificationPending ? (
              <VerificationPendingBlock email={email} onResend={resendVerification} loading={loading} cooldown={resendCooldown} onBack={() => { setVerificationPending(false); setMode("signin"); }} />
            ) : mode === "reset" ? (
              <ResetForm password={password} setPassword={setPassword} loading={loading} onSubmit={handleResetPassword} />
            ) : mode === "forgot" ? (
              <ForgotForm
                email={email}
                setEmail={setEmail}
                loading={loading}
                sent={resetEmailSent}
                onSubmit={handleForgotPassword}
                onBack={() => { setMode("signin"); setResetEmailSent(false); }}
              />
            ) : (
              <AuthForm
                mode={mode}
                setMode={setMode}
                email={email}
                setEmail={setEmail}
                password={password}
                setPassword={setPassword}
                confirmPassword={confirmPassword}
                setConfirmPassword={setConfirmPassword}
                loading={loading}
                onSignIn={handleSignIn}
                onSignUp={handleSignUp}
                onForgot={() => setMode("forgot")}
              />
            )}
          </div>
        </div>

        {/* Bottom: residency disclaimer */}
        <p className="text-[11px] text-slate-400 text-center leading-relaxed">
          POPIA &amp; GDPR-compliant data residency. All sessions cryptographically sealed.
        </p>
      </section>

      {/* ═══════════════ RIGHT — THE VAULT (brand) ═══════════════ */}
      <aside className="relative hidden lg:flex flex-col justify-between p-12 xl:p-16 bg-slate-50 border-l border-slate-100 overflow-hidden">
        {/* Emerald mesh wash */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute -top-32 left-1/2 -translate-x-1/2 h-[680px] w-[1100px] rounded-full blur-3xl"
            style={{
              background:
                "radial-gradient(ellipse at center, rgba(16,185,129,0.14) 0%, rgba(16,185,129,0.05) 40%, transparent 70%)",
            }}
          />
          <div
            className="absolute bottom-0 right-0 h-[420px] w-[520px] rounded-full blur-3xl"
            style={{
              background:
                "radial-gradient(circle, rgba(5,150,105,0.10) 0%, transparent 70%)",
            }}
          />
        </div>

        {/* 40px precision grid */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(15,23,42,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.045) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            maskImage:
              "radial-gradient(ellipse at center, rgba(0,0,0,0.85) 0%, transparent 75%)",
          }}
        />

        {/* Top: status pill */}
        <div className="relative z-10 flex items-center gap-2 self-start rounded-full border border-emerald-100 bg-white/80 backdrop-blur px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.18em] text-emerald-700 shadow-sm">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 rounded-full bg-emerald-400 opacity-75 animate-ping" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          System Status · All systems operational
        </div>

        {/* Center: pull-quote */}
        <div className="relative z-10 max-w-lg">
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-emerald-700 mb-8">
            ❝
          </p>
          <blockquote className="text-3xl xl:text-4xl font-semibold tracking-tighter leading-[1.15] text-slate-900">
            Izenzo provides the cryptographic certainty required to deploy
            capital at scale.
          </blockquote>
          <div className="mt-10 flex items-center gap-3">
            <div className="h-px w-10 bg-slate-300" />
            <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-slate-500">
              Institutional Trade Finance
            </span>
          </div>
        </div>

        {/* Bottom: hash motif */}
        <div className="relative z-10 self-start">
          <HashChainMotif />
        </div>
      </aside>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Sub-components — kept inline to preserve single-file auth surface
// ─────────────────────────────────────────────────────────

function AuthForm({
  mode, setMode, email, setEmail, password, setPassword,
  confirmPassword, setConfirmPassword, loading,
  onSignIn, onSignUp, onForgot,
}: {
  mode: "signin" | "signup";
  setMode: (m: Mode) => void;
  email: string; setEmail: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  confirmPassword: string; setConfirmPassword: (v: string) => void;
  loading: boolean;
  onSignIn: (e: React.FormEvent) => void;
  onSignUp: (e: React.FormEvent) => void;
  onForgot: () => void;
}) {
  const isSignIn = mode === "signin";
  return (
    <>
      <div className="mb-10">
        <h1 className="text-[28px] font-semibold text-slate-900 tracking-tighter leading-[1.1]">
          {isSignIn ? "Sign in to your desk" : "Create your account"}
        </h1>
        <p className="mt-3 text-sm text-slate-500 leading-relaxed">
          {isSignIn ? "Continue to your sovereign trade workspace." : "Begin onboarding into the institutional trade network."}
        </p>
      </div>

      <form onSubmit={isSignIn ? onSignIn : onSignUp} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email" className="text-xs font-medium text-slate-700 tracking-wide uppercase">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="h-11 rounded-md border border-slate-200 bg-white px-4 text-[15px] text-slate-900 placeholder:text-slate-400 shadow-none focus-visible:ring-2 focus-visible:ring-emerald-600/20 focus-visible:border-emerald-600 transition-shadow"
            placeholder="you@institution.com"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-xs font-medium text-slate-700 tracking-wide uppercase">
              Password
            </Label>
            {isSignIn && (
              <button
                type="button"
                onClick={onForgot}
                className="text-xs text-slate-500 hover:text-slate-900 transition-colors"
              >
                Forgot?
              </button>
            )}
          </div>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={isSignIn ? "current-password" : "new-password"}
            minLength={8}
            className="h-11 rounded-md border border-slate-200 bg-white px-4 text-[15px] text-slate-900 placeholder:text-slate-400 shadow-none focus-visible:ring-2 focus-visible:ring-emerald-600/20 focus-visible:border-emerald-600 transition-shadow"
            placeholder={isSignIn ? "••••••••" : "Minimum 8 characters"}
          />
        </div>

        {!isSignIn && (
          <div className="space-y-2">
            <Label htmlFor="confirm-password" className="text-xs font-medium text-slate-700 tracking-wide uppercase">
              Confirm password
            </Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={8}
              className="h-11 rounded-md border border-slate-200 bg-white px-4 text-[15px] text-slate-900 placeholder:text-slate-400 shadow-none focus-visible:ring-2 focus-visible:ring-emerald-600/20 focus-visible:border-emerald-600 transition-shadow"
              placeholder="Re-enter password"
            />
            {confirmPassword.length > 0 && password !== confirmPassword && (
              <p className="text-xs text-destructive">Passwords do not match.</p>
            )}
          </div>
        )}

        <Button
          type="submit"
          disabled={loading}
          className="w-full h-11 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20 hover:shadow-emerald-700/30 font-medium text-[15px] tracking-tight transition-all"
        >
          {loading ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Please wait…</>
          ) : (
            isSignIn ? "Continue with Email" : "Create account"
          )}
        </Button>
      </form>

      <div className="mt-8 pt-6 border-t border-slate-200 text-center">
        <p className="text-sm text-slate-500">
          {isSignIn ? "New to Izenzo?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => setMode(isSignIn ? "signup" : "signin")}
            className="text-slate-900 font-medium hover:text-primary transition-colors"
          >
            {isSignIn ? "Create account" : "Sign in"}
          </button>
        </p>
      </div>

      <p className="mt-12 text-[11px] text-slate-400 text-center leading-relaxed">
        By continuing you agree to Izenzo's Terms of Service and acknowledge our compliance with POPIA & GDPR data residency standards.
      </p>
    </>
  );
}

function ForgotForm({
  email, setEmail, loading, sent, onSubmit, onBack,
}: {
  email: string; setEmail: (v: string) => void;
  loading: boolean; sent: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
}) {
  return (
    <>
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-900 transition-colors mb-8"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
      </button>

      <div className="mb-10">
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Reset your password</h1>
        <p className="mt-2 text-sm text-slate-500 leading-relaxed">
          Enter your email and we'll send a secure recovery link.
        </p>
      </div>

      {sent ? (
        <div className="p-5 border border-slate-200 rounded-md bg-slate-50">
          <p className="text-sm font-medium text-slate-900 mb-2">Reset link sent</p>
          <p className="text-sm text-slate-500 leading-relaxed">
            Check <span className="font-medium text-slate-700">{email}</span> for instructions. The link expires in 1 hour.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="reset-email" className="text-xs font-medium text-slate-700 tracking-wide uppercase">Email</Label>
            <Input
              id="reset-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-12 rounded-md border border-slate-200 bg-white px-4 text-[15px] shadow-none focus-visible:ring-1 focus-visible:ring-slate-900 focus-visible:border-slate-900"
              placeholder="you@institution.com"
            />
          </div>
          <Button type="submit" disabled={loading} className="w-full h-12 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 shadow-none font-medium">
            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…</> : "Send reset link"}
          </Button>
        </form>
      )}
    </>
  );
}

function ResetForm({
  password, setPassword, loading, onSubmit,
}: {
  password: string; setPassword: (v: string) => void;
  loading: boolean; onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <>
      <div className="mb-10">
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Set new password</h1>
        <p className="mt-2 text-sm text-slate-500 leading-relaxed">Choose a strong password — minimum 8 characters.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="new-password" className="text-xs font-medium text-slate-700 tracking-wide uppercase">New password</Label>
          <Input
            id="new-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="h-12 rounded-md border border-slate-200 bg-white px-4 text-[15px] shadow-none focus-visible:ring-1 focus-visible:ring-slate-900 focus-visible:border-slate-900"
          />
        </div>
        <Button type="submit" disabled={loading} className="w-full h-12 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 shadow-none font-medium">
          {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating…</> : "Update password"}
        </Button>
      </form>
    </>
  );
}

function VerificationPendingBlock({
  email, onResend, loading, cooldown, onBack,
}: { email: string; onResend: () => void; loading: boolean; cooldown: number; onBack: () => void }) {
  const disabled = loading || cooldown > 0;
  return (
    <>
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-900 transition-colors mb-8"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </button>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Verify your email</h1>
        <p className="mt-2 text-sm text-slate-500 leading-relaxed">
          We sent a verification link to <span className="font-medium text-slate-700">{email || "your inbox"}</span>. Open it to activate your account.
        </p>
      </div>
      <Button
        onClick={onResend}
        disabled={disabled}
        variant="outline"
        className="w-full h-12 rounded-md border-slate-200 hover:bg-slate-50 shadow-none font-medium text-slate-900"
      >
        {loading
          ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…</>
          : cooldown > 0
            ? `Resend available in ${cooldown}s`
            : "Resend verification email"}
      </Button>
      {cooldown > 0 && (
        <p className="mt-3 text-xs text-slate-400 text-center">
          For security, verification emails are throttled. Check your inbox (and spam folder) while you wait.
        </p>
      )}
    </>
  );
}
