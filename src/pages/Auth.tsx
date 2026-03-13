import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { hasPreAuthState } from "@/lib/pre-auth-state";
import { getSafeReturnTo } from "@/lib/safe-redirect";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { z } from "zod";
import { Loader2, ArrowLeft } from "lucide-react";
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

    const getPostAuthRedirect = () => {
      const returnTo = searchParams.get("returnTo");
      const safe = getSafeReturnTo(returnTo);
      if (returnTo && safe !== "/dashboard") return `${safe}${safe.includes("?") ? "&" : "?"}resume=1`;
      if (hasPreAuthState()) return "/dashboard/search?resume=1";
      return "/dashboard";
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate(getPostAuthRedirect());
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        navigate(getPostAuthRedirect());
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, searchParams]);

  const passwordsMatch = signUpPassword === signUpConfirmPassword;
  const showMismatch = confirmPasswordTouched && signUpConfirmPassword.length > 0 && !passwordsMatch;
  const signUpValid = signUpEmail.trim().length > 0 && signUpPassword.length >= 8 && passwordsMatch && signUpConfirmPassword.length > 0;

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    
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
              <ArrowLeft className="h-4 w-4" />
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
    if (hostType === 'preview') {
      return (
        <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>
      );
    }
    return (
      <a href={backUrl} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
        <ArrowLeft className="h-4 w-4" />
        Back to home
      </a>
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <BackLink />
          <Link to="/" className="flex items-center gap-2 mb-4 hover:opacity-80 transition-opacity">
            <div className="h-8 w-8 rounded bg-foreground flex items-center justify-center">
              <span className="text-background font-bold text-xs">CM</span>
            </div>
            <span className="font-semibold text-foreground">Compliance Match</span>
          </Link>
          <h1 className="text-2xl font-semibold text-foreground mb-2">Welcome</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to manage counterparty searches, matches, and compliance records
          </p>
        </div>

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
                  onChange={(e) => setSignInEmail(e.target.value)}
                  required
                  className="h-10"
                />
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
                  Create an account to search for counterparties, confirm intent, and manage your compliance records.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-email" className="text-sm font-medium">Email</Label>
                <Input
                  id="signup-email"
                  type="email"
                  placeholder="you@company.com"
                  value={signUpEmail}
                  onChange={(e) => setSignUpEmail(e.target.value)}
                  required
                  className="h-10"
                />
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
