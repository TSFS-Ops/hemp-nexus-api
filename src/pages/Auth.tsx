import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { hasPreAuthState } from "@/lib/pre-auth-state";
import { getSafeReturnTo } from "@/lib/safe-redirect";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { z } from "zod";
import { Loader2, ArrowLeft, LogIn } from "lucide-react";
import { getPublicUrl, getHostType } from "@/lib/hostname";

const authSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const emailSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export default function Auth() {
  // ── Sign-in state ──
  const [signInEmail, setSignInEmail] = useState("");
  const [signInEmailError, setSignInEmailError] = useState("");
  const [signInPassword, setSignInPassword] = useState("");

  // ── Sign-up state (isolated) ──
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpEmailError, setSignUpEmailError] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [signUpConfirmPassword, setSignUpConfirmPassword] = useState("");
  const [confirmPasswordTouched, setConfirmPasswordTouched] = useState(false);

  const [loading, setLoading] = useState(false);
  const [pageReady, setPageReady] = useState(false);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [verificationPending, setVerificationPending] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetPassword, setResetPasswordValue] = useState("");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const type = searchParams.get("type");
    const code = searchParams.get("code");
    
    if (type === "recovery") {
      setShowForgotPassword(true);
      toast.info("Enter your new password below");
    } else if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) {
          toast.error(error.message);
        } else {
          toast.success("Your email has been verified. You can now sign in.");
        }
      });
    }

    // Reinforce redirect explanations with toasts (banners alone can be missed on mobile)
    if (searchParams.get("expired") === "1") {
      toast.warning("Your session expired. Sign in to continue where you left off.", { duration: 8000 });
    } else if (searchParams.get("signedOut") === "1") {
      toast.info("You've been signed out successfully.", { duration: 5000 });
    }

    const getPostAuthRedirect = () => {
      const returnTo = searchParams.get("returnTo");
      const safe = getSafeReturnTo(returnTo);
      if (returnTo && safe !== "/dashboard") return `${safe}${safe.includes("?") ? "&" : "?"}resume=1`;
      if (hasPreAuthState()) return "/dashboard/search?resume=1";
      return "/dashboard";
    };

    // Timeout: if auth check takes >8s, show the form anyway
    const timeoutId = setTimeout(() => {
      setLoadingTimedOut(true);
      setPageReady(true);
    }, 8000);

    supabase.auth.getSession().then(({ data: { session } }) => {
      clearTimeout(timeoutId);
      if (session) {
        navigate(getPostAuthRedirect());
      }
      setPageReady(true);
    }).catch(() => {
      clearTimeout(timeoutId);
      setPageReady(true);
      setLoadingTimedOut(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        navigate(getPostAuthRedirect());
      }
    });

    return () => {
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, [navigate, searchParams]);

  const passwordsMatch = signUpPassword === signUpConfirmPassword;
  const showMismatch = confirmPasswordTouched && signUpConfirmPassword.length > 0 && !passwordsMatch;
  const signUpValid = signUpEmail.trim().length > 0 && signUpPassword.length >= 8 && passwordsMatch && signUpConfirmPassword.length > 0;

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    
    if (!passwordsMatch) {
      toast.error("Passwords do not match");
      return;
    }

    try {
      authSchema.parse({ email: signUpEmail, password: signUpPassword });
      setLoading(true);

      const { error } = await supabase.auth.signUp({
        email: signUpEmail,
        password: signUpPassword,
        options: {
          emailRedirectTo: `${window.location.origin}/auth`
        }
      });

      if (error) throw error;

      setVerificationPending(true);
      toast.success("Check your email to verify your account.");
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      } else if (error instanceof Error) {
        const msg = error.message;
        if (msg.includes("already registered") || msg.includes("already been registered")) {
          toast.error("An account with this email already exists. Try signing in instead.");
        } else if (msg.includes("rate limit") || msg.includes("too many")) {
          toast.error("Too many attempts. Please wait a moment and try again.");
        } else {
          toast.error("Unable to create account. Please try again.");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    
    try {
      authSchema.parse({ email: signInEmail, password: signInPassword });
      setLoading(true);

      const { error } = await supabase.auth.signInWithPassword({
        email: signInEmail,
        password: signInPassword,
      });

      if (error) {
        if (error.message.includes("Email not confirmed")) {
          setVerificationPending(true);
          throw new Error("Please verify your email before signing in.");
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      } else if (error instanceof Error) {
        const msg = error.message;
        if (msg.includes("Invalid login")) {
          toast.error("Incorrect email or password. Check your credentials and try again.");
        } else if (msg.includes("Email not confirmed") || msg.includes("verify your email")) {
          toast.error(msg);
      } else if (msg.includes("rate limit") || msg.includes("too many") || msg.includes("locked")) {
          toast.error(
            "Too many failed sign-in attempts. Your account is temporarily locked for security. Wait 5 minutes, then try again. If you've forgotten your password, use 'Forgot password?' above.",
            { duration: 10000 }
          );
        } else {
          toast.error(msg || "Sign-in failed. Please check your credentials.");
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
      emailSchema.parse({ email: resetEmail });
      setLoading(true);

      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;

      setResetEmailSent(true);
      toast.success("Check your email for a password reset link.");
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      } else {
        toast.info("If an account exists, you'll receive a reset email.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    
    try {
      authSchema.parse({ email: "reset@placeholder.com", password: resetPassword });
      setLoading(true);

      const { error } = await supabase.auth.updateUser({
        password: resetPassword,
      });

      if (error) throw error;

      toast.success("Your password has been updated.");
      
      setShowForgotPassword(false);
      setResetPasswordValue("");
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      } else if (error instanceof Error) {
        toast.error(error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const resendVerification = async () => {
    const email = signInEmail || signUpEmail;
    if (!email) {
      toast.error("Enter your email address first.");
      return;
    }
    try {
      setLoading(true);
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
      });

      if (error) throw error;

      toast.success("Check your inbox for the verification link.");
    } catch (error) {
      toast.error("Failed to resend verification email.");
    } finally {
      setLoading(false);
    }
  };

  // Password Reset (from email link)
  if (showForgotPassword && searchParams.get("type") === "recovery") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <button
              onClick={() => setShowForgotPassword(false)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <h1 className="text-2xl font-semibold text-foreground mb-2">Reset password</h1>
            <p className="text-sm text-muted-foreground">Enter your new password</p>
          </div>

          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password" className="text-sm font-medium">New password</Label>
              <Input
                id="new-password"
                type="password"
                placeholder="Minimum 8 characters"
                value={resetPassword}
                onChange={(e) => setResetPasswordValue(e.target.value)}
                required
                className="h-10"
              />
            </div>
            <Button type="submit" className="w-full h-10 bg-foreground text-background hover:bg-foreground/90" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                "Update password"
              )}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // Forgot Password Form
  if (showForgotPassword) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <button
              onClick={() => {
                setShowForgotPassword(false);
                setResetEmailSent(false);
              }}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
              Back to sign in
            </button>
            <h1 className="text-2xl font-semibold text-foreground mb-2">Reset password</h1>
            <p className="text-sm text-muted-foreground">
              Enter your email and we'll send you a reset link
            </p>
          </div>

          {resetEmailSent ? (
            <div className="p-4 bg-muted/40 border border-border rounded-md space-y-3">
              <p className="text-sm font-medium text-foreground">
                Reset link sent
              </p>
              <p className="text-sm text-muted-foreground">
                If an account exists for <strong>{resetEmail}</strong>, you'll receive a password reset link within a few minutes.
              </p>
              <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-4">
                <li>Check your <strong>spam or junk</strong> folder if you don't see it</li>
                <li>The link expires after 1 hour and can only be used once</li>
                <li>If nothing arrives after 5 minutes, try again or check the email address</li>
              </ul>
              <button
                onClick={() => {
                  setResetEmailSent(false);
                }}
                className="text-xs text-primary hover:underline mt-2"
              >
                Try a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email" className="text-sm font-medium">Email</Label>
                <Input
                  id="reset-email"
                  type="email"
                  placeholder="you@company.com"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                  className="h-10"
                />
              </div>
              <Button type="submit" className="w-full h-10 bg-foreground text-background hover:bg-foreground/90" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Send reset link"
                )}
              </Button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // Main Auth Form
  const hostType = getHostType();
  const backUrl = hostType === 'preview' ? '/' : getPublicUrl('/');
  
  const BackLink = () => {
    const arrowIcon = <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>;
    if (hostType === 'preview') {
      return (
        <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
          {arrowIcon}
          Back to home
        </Link>
      );
    }
    return (
      <a href={backUrl} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
        {arrowIcon}
        Back to home
      </a>
    );
  };

  if (!pageReady) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Checking your session…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6 animate-in fade-in duration-300">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <BackLink />
          <Link to="/" className="flex items-center gap-2 mb-4 hover:opacity-80 transition-opacity">
            <div className="h-8 w-8 rounded flex items-center justify-center" style={{ backgroundColor: 'hsl(160, 84%, 29%)' }}>
              <span className="text-white font-bold text-xs font-mono">IZ</span>
            </div>
            <span className="font-semibold text-foreground tracking-tight">Izenzo</span>
          </Link>
          <h1 className="text-2xl font-semibold text-foreground mb-2">Welcome</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to manage trading partner searches, matches, and compliance records
          </p>
        </div>

        {searchParams.get("expired") === "1" && (
          <Alert className="mb-6 border-destructive/30 bg-destructive/5">
            <LogIn className="h-4 w-4" />
            <AlertDescription className="text-sm text-foreground">
              Your session expired. Sign in again to continue where you left off.
              {searchParams.get("returnTo") && " You'll be redirected back automatically."}
            </AlertDescription>
          </Alert>
        )}

        {searchParams.get("signedOut") === "1" && !searchParams.get("expired") && (
          <Alert className="mb-6 border-border bg-muted/30">
            <LogIn className="h-4 w-4" />
            <AlertDescription className="text-sm text-foreground">
              You've been signed out successfully.
            </AlertDescription>
          </Alert>
        )}

        {searchParams.get("returnTo") && !searchParams.get("expired") && (
          <Alert className="mb-6 border-primary/30 bg-primary/5">
            <LogIn className="h-4 w-4" />
            <AlertDescription className="text-sm text-foreground">
              Sign in to continue where you left off. You'll be redirected back automatically.
            </AlertDescription>
          </Alert>
        )}

        {verificationPending && (
          <div className="mb-6 p-4 bg-muted/40 border border-border rounded-md">
            <p className="text-sm text-muted-foreground">
              Please verify your email before signing in. Check your inbox.
              <button
                onClick={resendVerification}
                disabled={loading}
                className="text-primary hover:underline ml-1"
              >
                Resend
              </button>
            </p>
          </div>
        )}

        <Tabs defaultValue="signin" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6 h-10 bg-muted/50 p-1">
            <TabsTrigger value="signin" className="text-sm font-medium data-[state=active]:bg-background">Sign in</TabsTrigger>
            <TabsTrigger value="signup" className="text-sm font-medium data-[state=active]:bg-background">Create account</TabsTrigger>
          </TabsList>
          
          <TabsContent value="signin">
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signin-email" className="text-sm font-medium">Email</Label>
                <Input
                  id="signin-email"
                  type="email"
                  placeholder="you@company.com"
                  value={signInEmail}
                  onChange={(e) => { setSignInEmail(e.target.value); if (signInEmailError) setSignInEmailError(""); }}
                  onBlur={() => {
                    if (signInEmail && !z.string().email().safeParse(signInEmail).success) {
                      setSignInEmailError("Enter a valid email address");
                    } else {
                      setSignInEmailError("");
                    }
                  }}
                  required
                  className={`h-10 ${signInEmailError ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                />
                {signInEmailError && (
                  <p className="text-xs text-destructive">{signInEmailError}</p>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="signin-password" className="text-sm font-medium">Password</Label>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setShowForgotPassword(true)}
                  >
                    Forgot password?
                  </button>
                </div>
                <Input
                  id="signin-password"
                  type="password"
                  placeholder="••••••••"
                  value={signInPassword}
                  onChange={(e) => setSignInPassword(e.target.value)}
                  required
                  className="h-10"
                />
                {signInPassword.length > 0 && signInPassword.length < 8 && (
                  <p className="text-xs text-destructive">Password must be at least 8 characters</p>
                )}
              </div>
              <Button type="submit" className="w-full h-10 bg-foreground text-background hover:bg-foreground/90" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
          </TabsContent>
          
          <TabsContent value="signup">
            <form onSubmit={handleSignUp} className="space-y-4">
              <div className="p-3 bg-muted/40 border border-border rounded-md mb-4">
                <p className="text-xs text-muted-foreground">
                  Create an account to search for trading partners, send trade requests, and manage your compliance records.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-email" className="text-sm font-medium">Email</Label>
                <Input
                  id="signup-email"
                  type="email"
                  placeholder="you@company.com"
                  value={signUpEmail}
                  onChange={(e) => { setSignUpEmail(e.target.value); if (signUpEmailError) setSignUpEmailError(""); }}
                  onBlur={() => {
                    if (signUpEmail && !z.string().email().safeParse(signUpEmail).success) {
                      setSignUpEmailError("Enter a valid email address");
                    } else {
                      setSignUpEmailError("");
                    }
                  }}
                  required
                  className={`h-10 ${signUpEmailError ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                />
                {signUpEmailError && (
                  <p className="text-xs text-destructive">{signUpEmailError}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-password" className="text-sm font-medium">Password</Label>
                <Input
                  id="signup-password"
                  type="password"
                  placeholder="Minimum 8 characters"
                  value={signUpPassword}
                  onChange={(e) => setSignUpPassword(e.target.value)}
                  required
                  className={`h-10 ${signUpPassword.length > 0 && signUpPassword.length < 8 ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                />
                {signUpPassword.length > 0 && signUpPassword.length < 8 && (
                  <p className="text-xs text-destructive">Password must be at least 8 characters ({8 - signUpPassword.length} more needed)</p>
                )}
                {signUpPassword.length >= 8 && (
                  <p className="text-xs text-green-600">✓ Password meets minimum length</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-confirm-password" className="text-sm font-medium">Confirm password</Label>
                <Input
                  id="signup-confirm-password"
                  type="password"
                  placeholder="Re-enter your password"
                  value={signUpConfirmPassword}
                  onChange={(e) => {
                    setSignUpConfirmPassword(e.target.value);
                    if (!confirmPasswordTouched) setConfirmPasswordTouched(true);
                  }}
                  required
                  className={`h-10 ${showMismatch ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                />
                {showMismatch && (
                  <p className="text-xs text-destructive">Passwords do not match</p>
                )}
                {confirmPasswordTouched && signUpConfirmPassword.length > 0 && passwordsMatch && signUpPassword.length >= 8 && (
                  <p className="text-xs text-green-600">✓ Passwords match</p>
                )}
              </div>
              <Button type="submit" className="w-full h-10 bg-foreground text-background hover:bg-foreground/90" disabled={loading || !signUpValid}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  "Create account"
                )}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
