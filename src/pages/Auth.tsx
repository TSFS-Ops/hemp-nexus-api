import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { hasPreAuthState } from "@/lib/pre-auth-state";
import { getSafeReturnTo } from "@/lib/safe-redirect";
import { AUTH_REDIRECT_NOTICE_KEY } from "@/components/AuthRedirectNoticeBanner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { z } from "zod";
import { Loader2, ArrowLeft } from "lucide-react";
import { lovable } from "@/integrations/lovable";
const authSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters")
});
const emailSchema = z.object({
  email: z.string().email("Invalid email address")
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
    const t = setInterval(() => setResendCooldown(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // ── Post-auth routing: admins → /hq; new users → /welcome; returning → persisted persona ──
  const resolvePostAuthRoute = async (userId: string): Promise<string> => {
    console.info("[Auth] resolvePostAuthRoute:start", {
      userId
    });

    // 1) Platform admins always go to HQ, bypass returnTo & persona selector.
    //    Rationale: an admin socially-engineered into clicking a Resend deep
    //    link should not be silently dropped onto a tenant surface. We force
    //    them to HQ instead.
    //    UX caveat: bypassing returnTo is invisible to the user - they may
    //    have legitimately wanted to open the link. We surface a toast so
    //    they know the redirect happened and can re-open the original target
    //    manually.
    try {
      const {
        data: roleRows,
        error: roleErr
      } = await supabase.from("user_roles").select("role").eq("user_id", userId);
      console.info("[Auth] role lookup", {
        roleRows,
        roleErr: roleErr?.message
      });
      const isPlatformAdmin = (roleRows || []).some(r => r.role === "platform_admin");
      if (isPlatformAdmin) {
        const requestedReturn = searchParams.get("returnTo");
        if (requestedReturn) {
          // Sanitise before echoing back into the toast - never render raw user input.
          const safeRequested = getSafeReturnTo(requestedReturn, "");
          // Persist the original deep-link so HQ can show a non-dismissable
          // banner until the admin acknowledges or opens it. A 10s toast was
          // routinely missed (client incident, see chain).
          if (safeRequested) {
            try {
              sessionStorage.setItem(
                "izenzo_admin_redirect_origin",
                JSON.stringify({ link: safeRequested, at: Date.now() })
              );
            } catch { /* storage blocked - fall through to toast only */ }
          }
          toast.info(
            safeRequested
              ? `Admin session - redirected to HQ. Original link: ${safeRequested}`
              : "Admin session - redirected to HQ instead of the requested page.",
            { duration: 10000 }
          );
        }
        console.info("[Auth] resolved → /hq/users (platform admin)");
        return "/hq/users";
      }
    } catch (e) {
      console.warn("[Auth] role lookup threw - falling through", e);
    }

    // 2) Honour returnTo for non-admins (deep-link recovery)
    const returnTo = searchParams.get("returnTo");
    if (returnTo) {
      const safe = getSafeReturnTo(returnTo);
      if (safe && safe !== "/dashboard") {
        const final = `${safe}${safe.includes("?") ? "&" : "?"}resume=1`;
        try {
          sessionStorage.setItem(
            AUTH_REDIRECT_NOTICE_KEY,
            JSON.stringify({ destination: safe, reason: searchParams.get("expired") === "1" ? "expired" : "returnTo", at: Date.now() })
          );
        } catch { /* storage unavailable - redirect still works */ }
        console.info("[Auth] resolved → returnTo", final);
        return final;
      }
    }

    // 3) Persisted persona → workspace; otherwise persona selector
    try {
      const {
        data,
        error: profErr
      } = await supabase.from("profiles").select("selected_persona").eq("id", userId).maybeSingle();
      console.info("[Auth] persona lookup", {
        persona: data?.selected_persona,
        profErr: profErr?.message
      });
      const persona = data?.selected_persona;
      if (!persona) return "/welcome";
      if (persona === "developer") return "/developers/keys";
      if (persona === "governance") return "/governance/triage";
      // trade
      if (hasPreAuthState()) return "/desk?resume=1";
      return "/desk";
    } catch (e) {
      console.warn("[Auth] persona lookup threw - defaulting to /welcome", e);
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
      supabase.auth.exchangeCodeForSession(code).then(({
        error
      }) => {
        if (error) toast.error(error.message);else toast.success("Your email has been verified. You can now sign in.");
      });
    }
    if (searchParams.get("expired") === "1") {
      toast.warning("Your session expired. Sign in to continue where you left off.", {
        duration: 8000
      });
    } else if (searchParams.get("signedOut") === "1") {
      toast.info("You've been signed out successfully.", {
        duration: 5000
      });
    }
    const timeoutId = setTimeout(() => setPageReady(true), 8000);
    supabase.auth.getSession().then(async ({
      data: {
        session
      }
    }) => {
      clearTimeout(timeoutId);
      if (session?.user) {
        // Already signed in, hard-navigate so the destination route's
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
      authSchema.parse({
        email,
        password
      });
      setLoading(true);
      const {
        data,
        error
      } = await supabase.auth.signInWithPassword({
        email,
        password
      });
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
      if (err instanceof z.ZodError) toast.error(err.errors[0].message);else if (err instanceof Error) {
        const m = err.message;
        if (m.includes("Invalid login")) toast.error("Incorrect email or password.");else if (m.includes("rate limit") || m.includes("too many") || m.includes("locked")) {
          toast.error("Too many attempts. Wait 5 minutes, then try again.", {
            duration: 10000
          });
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
      authSchema.parse({
        email,
        password
      });
      setLoading(true);
      const {
        error
      } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth`
        }
      });
      if (error) throw error;
      setVerificationPending(true);
      toast.success("Check your email to verify your account.");
    } catch (err) {
      if (err instanceof z.ZodError) toast.error(err.errors[0].message);else if (err instanceof Error) {
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
      emailSchema.parse({
        email
      });
      setLoading(true);
      const {
        error
      } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`
      });
      if (error) throw error;
      setResetEmailSent(true);
      toast.success("Check your email for a reset link.");
    } catch (err) {
      if (err instanceof z.ZodError) toast.error(err.errors[0].message);else toast.info("If an account exists, you'll receive a reset email.");
    } finally {
      setLoading(false);
    }
  };
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    try {
      authSchema.parse({
        email: "reset@placeholder.com",
        password
      });
      setLoading(true);
      const {
        error
      } = await supabase.auth.updateUser({
        password
      });
      if (error) throw error;
      toast.success("Your password has been updated.");
      setMode("signin");
      setPassword("");
    } catch (err) {
      if (err instanceof z.ZodError) toast.error(err.errors[0].message);else if (err instanceof Error) toast.error(err.message);
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
      const {
        error
      } = await supabase.auth.resend({
        type: "signup",
        email
      });
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
  return <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden bg-card p-3 sm:p-4">
      {/* ═══════════════ BACKGROUND LAYERS ═══════════════ */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[820px] w-[1300px] rounded-full blur-3xl" style={{
        background: "radial-gradient(ellipse at center, rgba(16,185,129,0.18) 0%, rgba(16,185,129,0.06) 40%, transparent 70%)"
      }} />
        <div className="absolute top-0 right-0 h-[520px] w-[620px] rounded-full blur-3xl" style={{
        background: "radial-gradient(circle, rgba(16,185,129,0.20) 0%, transparent 70%)"
      }} />
        <div className="absolute bottom-0 left-0 h-[440px] w-[540px] rounded-full blur-3xl" style={{
        background: "radial-gradient(circle, rgba(5,150,105,0.10) 0%, transparent 70%)"
      }} />
      </div>

      <div aria-hidden className="pointer-events-none absolute inset-0" style={{
      backgroundImage: "linear-gradient(to right, rgba(15,23,42,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.045) 1px, transparent 1px)",
      backgroundSize: "40px 40px",
      maskImage: "radial-gradient(ellipse at center, rgba(0,0,0,0.85) 0%, transparent 75%)",
      WebkitMaskImage: "radial-gradient(ellipse at center, rgba(0,0,0,0.85) 0%, transparent 75%)"
    }} />

      {/* ═══════════════ CENTERED AUTH CARD ═══════════════ */}
      <div className="relative z-10 w-full max-w-[440px]">
        <div className="bg-card/95 backdrop-blur-xl rounded-2xl shadow-2xl shadow-emerald-900/10 border border-white/40 ring-1 ring-slate-900/5 p-5 sm:p-6">
          {/* Logo (centered, top of card), links back to landing */}
          <div className="flex flex-col items-center mb-3">
            <Link to="/" aria-label="Back to Izenzo home" className="flex items-center gap-2 rounded-md transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--emerald))]/40 focus-visible:ring-offset-2">
              <div className="w-8 h-8 rounded-md flex items-center justify-center bg-emerald-950">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <span className="text-[16px] font-semibold tracking-tight text-foreground">Izenzo</span>
            </Link>
          </div>

          {searchParams.get("expired") === "1" && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200"
            >
              <div className="font-medium">Your session expired.</div>
              <div className="text-xs opacity-90 mt-0.5">
                Sign in again to continue where you left off. Any unsaved work was preserved locally and will reappear when you return.
              </div>
            </div>
          )}

          {/* Visible explanation for users who were silently bounced here from
              a protected route. Without this, a user who clicked a deep link
              while signed-out lands on /auth with no clue why. */}
          {searchParams.get("expired") !== "1" && (() => {
            const rt = searchParams.get("returnTo");
            if (!rt) return null;
            const safeRt = getSafeReturnTo(rt, "");
            const labelPath = safeRt || "the page you requested";
            return (
              <div
                role="status"
                className="mb-4 rounded-md border border-sky-500/40 bg-sky-500/10 p-3 text-sm text-sky-900 dark:text-sky-200"
              >
                <div className="font-medium">Sign in to continue.</div>
                <div className="text-xs opacity-90 mt-0.5 break-all">
                  We sent you here because{" "}
                  <span className="font-mono">{labelPath}</span>{" "}
                  needs you to be signed in. We'll take you back as soon as you do.
                </div>
              </div>
            );
          })()}

          {!pageReady ? <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/70" />
            </div> : verificationPending ? <VerificationPendingBlock email={email} onResend={resendVerification} loading={loading} cooldown={resendCooldown} onBack={() => {
          setVerificationPending(false);
          setMode("signin");
        }} /> : mode === "reset" ? <ResetForm password={password} setPassword={setPassword} loading={loading} onSubmit={handleResetPassword} /> : mode === "forgot" ? <ForgotForm email={email} setEmail={setEmail} loading={loading} sent={resetEmailSent} onSubmit={handleForgotPassword} onBack={() => {
          setMode("signin");
          setResetEmailSent(false);
        }} /> : <AuthForm mode={mode} setMode={setMode} email={email} setEmail={setEmail} password={password} setPassword={setPassword} confirmPassword={confirmPassword} setConfirmPassword={setConfirmPassword} loading={loading} onSignIn={handleSignIn} onSignUp={handleSignUp} onForgot={() => setMode("forgot")} />}
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground/70 text-center leading-relaxed">
          Regional data residency is configured. Per-organisation residency commitments require separate approval.
        </p>
      </div>
    </div>;
}

// ─────────────────────────────────────────────────────────
// Sub-components, kept inline to preserve single-file auth surface
// ─────────────────────────────────────────────────────────

function AuthForm({
  mode,
  setMode,
  email,
  setEmail,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  loading,
  onSignIn,
  onSignUp,
  onForgot
}: {
  mode: "signin" | "signup";
  setMode: (m: Mode) => void;
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  confirmPassword: string;
  setConfirmPassword: (v: string) => void;
  loading: boolean;
  onSignIn: (e: React.FormEvent) => void;
  onSignUp: (e: React.FormEvent) => void;
  onForgot: () => void;
}) {
  const isSignIn = mode === "signin";
  const [ssoLoading, setSsoLoading] = useState<"google" | "microsoft" | null>(null);
  const handleSso = async (provider: "google" | "microsoft") => {
    if (ssoLoading || loading) return;
    setSsoLoading(provider);
    try {
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin
      });
      if (result.redirected) return;
      if (result.error) {
        const msg = result.error.message || "";
        if (provider === "microsoft") {
          toast.info("Microsoft Entra SSO is provisioned per-tenant. Contact institutional@izenzo.co.za to enable it for your organisation.");
        } else {
          toast.error(msg || `Unable to continue with ${provider}.`);
        }
      }
    } catch (err) {
      if (provider === "microsoft") {
        toast.info("Microsoft Entra SSO is provisioned per-tenant. Contact institutional@izenzo.co.za to enable it for your organisation.");
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(msg || `Unable to continue with ${provider}.`);
      }
    } finally {
      setSsoLoading(null);
    }
  };
  return <>
      <div className="mb-4 text-center">
        <h1 className="text-[19px] font-semibold text-foreground tracking-tight leading-[1.2]">
          {isSignIn ? "Sign in to your account" : "Create your account"}
        </h1>
      </div>

      <div className="space-y-3">
        {/* ─── Enterprise SSO ─── */}
        <div className="space-y-2">
          <button type="button" onClick={() => handleSso("microsoft")} disabled={loading || ssoLoading !== null} className="relative w-full h-10 rounded-md border border-border bg-card text-muted-foreground text-[14px] font-medium hover:bg-muted hover:border-border transition-all flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed shadow-sm">
            <span className="absolute left-4 flex items-center">
              {ssoLoading === "microsoft" ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/70" /> : <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="0" y="0" width="7" height="7" fill="#F25022" />
                  <rect x="9" y="0" width="7" height="7" fill="#7FBA00" />
                  <rect x="0" y="9" width="7" height="7" fill="#00A4EF" />
                  <rect x="9" y="9" width="7" height="7" fill="#FFB900" />
                </svg>}
            </span>
            Continue with Microsoft
          </button>

          <button type="button" onClick={() => handleSso("google")} disabled={loading || ssoLoading !== null} className="relative w-full h-10 rounded-md border border-border bg-card text-muted-foreground text-[14px] font-medium hover:bg-muted hover:border-border transition-all flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed shadow-sm">
            <span className="absolute left-4 flex items-center">
              {ssoLoading === "google" ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/70" /> : <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
                  <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
                  <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
                  <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
                </svg>}
            </span>
            Continue with Google
          </button>
        </div>

        {/* ─── OR divider ─── */}
        <div className="relative py-1">
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-border" />
          <div className="relative flex justify-center">
            <span className="bg-card px-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70 font-medium">or</span>
          </div>
        </div>

        {/* ─── Email form ─── */}
        <form onSubmit={isSignIn ? onSignIn : onSignUp} className="space-y-2.5">
          <div className="space-y-1">
            <Label htmlFor="email" className="text-[11px] font-medium text-muted-foreground tracking-wide uppercase">
              Email
            </Label>
            <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/70 shadow-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--emerald))]/20 focus-visible:border-[hsl(var(--emerald)/0.4)] transition-shadow" placeholder="you@institution.com" />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between h-4">
              <Label htmlFor="password" className="text-[11px] font-medium text-muted-foreground tracking-wide uppercase">
                Password
              </Label>
              {isSignIn && <button type="button" onClick={onForgot} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                  Forgot?
                </button>}
            </div>
            <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete={isSignIn ? "current-password" : "new-password"} minLength={8} className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/70 shadow-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--emerald))]/20 focus-visible:border-[hsl(var(--emerald)/0.4)] transition-shadow" placeholder={isSignIn ? "••••••••" : "Minimum 8 characters"} />
          </div>

          {!isSignIn && <div className="space-y-1">
              <Label htmlFor="confirm-password" className="text-[11px] font-medium text-muted-foreground tracking-wide uppercase">
                Confirm password
              </Label>
              <Input id="confirm-password" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required autoComplete="new-password" minLength={8} className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/70 shadow-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--emerald))]/20 focus-visible:border-[hsl(var(--emerald)/0.4)] transition-shadow" placeholder="Re-enter password" />
              {confirmPassword.length > 0 && password !== confirmPassword && <p className="text-[11px] text-destructive">Passwords do not match.</p>}
            </div>}

          <Button type="submit" disabled={loading} className="w-full h-10 rounded-md bg-[hsl(var(--emerald))] hover:bg-[hsl(var(--emerald))] text-white shadow-md shadow-emerald-600/20 hover:shadow-emerald-700/30 font-medium text-[14px] tracking-tight transition-all">
            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Please wait…</> : isSignIn ? "Sign in" : "Create account"}
          </Button>
        </form>
      </div>

      <div className="mt-4 text-center">
        <p className="text-[13px] text-muted-foreground">
          {isSignIn ? "New to Izenzo?" : "Already have an account?"}{" "}
          <button type="button" onClick={() => setMode(isSignIn ? "signup" : "signin")} className="text-foreground font-medium hover:text-primary transition-colors">
            {isSignIn ? "Create account" : "Sign in"}
          </button>
        </p>
      </div>
    </>;
}
function ForgotForm({
  email,
  setEmail,
  loading,
  sent,
  onSubmit,
  onBack
}: {
  email: string;
  setEmail: (v: string) => void;
  loading: boolean;
  sent: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
}) {
  return <>
      <button onClick={onBack} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-8">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
      </button>

      <div className="mb-10">
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Reset your password</h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Enter your email and we'll send a secure recovery link.
        </p>
      </div>

      {sent ? <div className="p-5 border border-border rounded-md bg-muted">
          <p className="text-sm font-medium text-foreground mb-2">Reset link sent</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Check <span className="font-medium text-muted-foreground">{email}</span> for instructions. The link expires in 1 hour.
          </p>
        </div> : <form onSubmit={onSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="reset-email" className="text-xs font-medium text-muted-foreground tracking-wide uppercase">Email</Label>
            <Input id="reset-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required className="h-12 rounded-md border border-border bg-card px-4 text-base sm:text-[15px] shadow-none focus-visible:ring-1 focus-visible:ring-slate-900 focus-visible:border-slate-900" placeholder="you@institution.com" />
          </div>
          <Button type="submit" disabled={loading} className="w-full h-12 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 shadow-none font-medium">
            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…</> : "Send reset link"}
          </Button>
        </form>}
    </>;
}
function ResetForm({
  password,
  setPassword,
  loading,
  onSubmit
}: {
  password: string;
  setPassword: (v: string) => void;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return <>
      <div className="mb-10">
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Set new password</h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">Choose a strong password: minimum 8 characters.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="new-password" className="text-xs font-medium text-muted-foreground tracking-wide uppercase">New password</Label>
          <Input id="new-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} className="h-12 rounded-md border border-border bg-card px-4 text-base sm:text-[15px] shadow-none focus-visible:ring-1 focus-visible:ring-slate-900 focus-visible:border-slate-900" />
        </div>
        <Button type="submit" disabled={loading} className="w-full h-12 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 shadow-none font-medium">
          {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating…</> : "Update password"}
        </Button>
      </form>
    </>;
}
function VerificationPendingBlock({
  email,
  onResend,
  loading,
  cooldown,
  onBack
}: {
  email: string;
  onResend: () => void;
  loading: boolean;
  cooldown: number;
  onBack: () => void;
}) {
  const disabled = loading || cooldown > 0;
  return <>
      <button onClick={onBack} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-8">
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </button>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Verify your email</h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          We sent a verification link to <span className="font-medium text-muted-foreground">{email || "your inbox"}</span>. Open it to activate your account.
        </p>
      </div>
      <Button onClick={onResend} disabled={disabled} variant="outline" className="w-full h-12 rounded-md border-border hover:bg-muted shadow-none font-medium text-foreground">
        {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…</> : cooldown > 0 ? `Resend available in ${cooldown}s` : "Resend verification email"}
      </Button>
      {cooldown > 0 && <p className="mt-3 text-xs text-muted-foreground/70 text-center">
          For security, verification emails are throttled. Check your inbox (and spam folder) while you wait.
        </p>}
    </>;
}