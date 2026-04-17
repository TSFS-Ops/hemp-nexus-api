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
        const route = await resolvePostAuthRoute(session.user.id);
        navigate(route, { replace: true });
      }
      setPageReady(true);
    }).catch(() => {
      clearTimeout(timeoutId);
      setPageReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.info("[Auth] onAuthStateChange", { event, hasUser: !!session?.user });
      if (event === "SIGNED_IN" && session?.user) {
        const route = await resolvePostAuthRoute(session.user.id);
        console.info("[Auth] navigating →", route);
        navigate(route, { replace: true });
      }
    });

    return () => {
      clearTimeout(timeoutId);
      subscription.unsubscribe();
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
    <div className="min-h-screen w-full flex flex-col md:flex-row bg-white">
      {/* LEFT — 40% — pure white, ruthlessly minimal form */}
      <section className="w-full md:w-2/5 flex flex-col justify-center px-6 sm:px-12 lg:px-16 xl:px-20 py-16 bg-white">
        <div className="w-full max-w-sm mx-auto">
          {/* Wordmark */}
          <div className="mb-12">
            <h2 className="font-mono text-sm font-medium tracking-[0.2em] text-slate-900 uppercase">
              Izenzo
            </h2>
            <p className="mt-1 text-xs text-slate-500 tracking-wide">
              Trade Compliance Platform
            </p>
          </div>

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
      </section>

      {/* RIGHT — 60% — deep slate, typographic statement + hash motif */}
      <aside className="hidden md:flex md:w-3/5 bg-slate-900 relative overflow-hidden">
        {/* Subtle grid texture */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />

        <div className="relative z-10 flex flex-col justify-center w-full px-12 lg:px-20 xl:px-28">
          <div className="max-w-2xl">
            {/* Top label */}
            <div className="mb-12 flex items-center gap-3 text-white/40">
              <span className="h-px w-8 bg-white/30" />
              <span className="font-mono text-xs tracking-[0.25em] uppercase">
                Institutional Grade
              </span>
            </div>

            {/* Statement */}
            <h1 className="font-mono text-4xl lg:text-5xl xl:text-6xl font-medium tracking-tight text-white leading-[1.1]">
              Compliant Infrastructure
              <br />
              <span className="text-white/60">for Trade.</span>
            </h1>

            {/* Hash chain */}
            <div className="mt-16 pt-8 border-t border-white/10">
              <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-white/30 mb-4">
                Cryptographic Ledger · Verified Chain
              </p>
              <HashChainMotif />
            </div>

            {/* Footer mark */}
            <div className="mt-16 flex items-center justify-between text-white/30 font-mono text-[10px] tracking-wider">
              <span>SHA-256 · TLS 1.3 · POPIA · GDPR</span>
              <span>v4.0</span>
            </div>
          </div>
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
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
          {isSignIn ? "Sign in to Izenzo" : "Create your account"}
        </h1>
        <p className="mt-2 text-sm text-slate-500 leading-relaxed">
          {isSignIn ? "Continue to your trade workspace." : "Begin onboarding into the institutional trade network."}
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
            className="h-12 rounded-md border border-slate-200 bg-white px-4 text-[15px] text-slate-900 placeholder:text-slate-400 shadow-none focus-visible:ring-1 focus-visible:ring-slate-900 focus-visible:border-slate-900"
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
            className="h-12 rounded-md border border-slate-200 bg-white px-4 text-[15px] text-slate-900 placeholder:text-slate-400 shadow-none focus-visible:ring-1 focus-visible:ring-slate-900 focus-visible:border-slate-900"
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
              className="h-12 rounded-md border border-slate-200 bg-white px-4 text-[15px] text-slate-900 placeholder:text-slate-400 shadow-none focus-visible:ring-1 focus-visible:ring-slate-900 focus-visible:border-slate-900"
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
          className="w-full h-12 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 shadow-none font-medium text-[15px] tracking-tight"
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
