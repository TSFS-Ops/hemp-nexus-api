import { useState, useEffect, useRef } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, AlertTriangle } from "lucide-react";
import { BackButton } from "@/components/BackButton";

const TIMEOUT_MS = 15_000; // 15 seconds to detect recovery event

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    let cancelled = false;

    const markReady = () => {
      if (cancelled) return;
      setReady(true);
      setExpired(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };

    const markExpired = (msg?: string) => {
      if (cancelled) return;
      if (msg) setErrorMsg(msg);
      setExpired(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };

    // Listen for the PASSWORD_RECOVERY event (implicit flow: #access_token in hash)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        markReady();
      }
    });

    (async () => {
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      const hashParams = new URLSearchParams(hash);

      // 1) PKCE flow: ?code=... in query string (or hash fallback)
      const code = searchParams.get("code") ?? hashParams.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          markExpired(error.message);
        } else {
          markReady();
        }
        return;
      }

      // 2) Error returned in hash (e.g. expired/invalid OTP from Supabase verify)
      const hashError = hashParams.get("error_description") || hashParams.get("error");
      if (hashError) {
        markExpired(decodeURIComponent(hashError.replace(/\+/g, " ")));
        return;
      }

      // 3) token_hash / token flow: query string or hash fragment
      const tokenHash = searchParams.get("token_hash")
        ?? searchParams.get("token")
        ?? hashParams.get("token_hash")
        ?? hashParams.get("token");
      const type = searchParams.get("type") ?? hashParams.get("type");
      if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type as any,
        });
        if (error) {
          markExpired(error.message);
        } else {
          markReady();
        }
        return;
      }

      // 4) Implicit flow with tokens in the hash fragment
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) {
          markExpired(error.message);
        } else {
          markReady();
        }
        return;
      }

      // 5) Implicit flow already established a session
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        markReady();
      }
    })();

    // Timeout safety net for implicit flow if no auth event fires
    timeoutRef.current = setTimeout(() => markExpired(), TIMEOUT_MS);

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [searchParams]);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated successfully. You can now sign in.");
      navigate("/auth");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update password");
    } finally {
      setLoading(false);
    }
  };

  // Expired or invalid token state
  if (!ready && expired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm text-center space-y-4">
          <AlertTriangle className="h-8 w-8 mx-auto text-amber-500" />
          <h1 className="text-xl font-semibold text-foreground">Reset link expired or invalid</h1>
          <p className="text-sm text-muted-foreground">
            {errorMsg ?? "This password reset link has expired or is no longer valid. Reset links are single-use and expire after a short time."}
          </p>
          <Link
            to="/auth"
            className="inline-flex items-center justify-center rounded-md text-sm font-medium h-10 px-4 py-2 bg-foreground text-background hover:bg-foreground/90 transition-colors w-full"
          >
            Request a new reset link
          </Link>
          <p className="text-xs text-muted-foreground">
            Go to Sign In → Forgot Password to request a new link.
          </p>
        </div>
      </div>
    );
  }

  // Waiting for recovery event
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm text-center space-y-4">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Verifying your reset link…</p>
          <Link to="/auth" className="text-xs text-muted-foreground hover:text-foreground underline">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <BackButton fallback="/auth" label="Back to sign in" className="mb-6 -ml-3 text-muted-foreground hover:text-foreground" />
          <h1 className="text-2xl font-semibold text-foreground mb-2">Set new password</h1>
          <p className="text-sm text-muted-foreground">Enter your new password below.</p>
        </div>

        <form onSubmit={handleReset} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password" className="text-sm font-medium">New password</Label>
            <Input
              id="new-password"
              type="password"
              placeholder="Minimum 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className={`h-10 ${password.length > 0 && password.length < 8 ? 'border-destructive' : ''}`}
            />
            {password.length > 0 && password.length < 8 && (
              <p className="text-xs text-destructive">Password must be at least 8 characters ({8 - password.length} more needed)</p>
            )}
            {password.length >= 8 && (
              <p className="text-xs text-green-600">✓ Password meets minimum length</p>
            )}
          </div>
          <Button
            type="submit"
            className="w-full h-10 bg-foreground text-background hover:bg-foreground/90"
            disabled={loading || password.length < 8}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Updating…
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
