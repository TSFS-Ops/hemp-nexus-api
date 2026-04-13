import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
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
  const navigate = useNavigate();
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    // Listen for the PASSWORD_RECOVERY event from the hash fragment
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
        setExpired(false);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      }
    });

    // Also check if there's already a session with recovery type
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setReady(true);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      }
    });

    // Timeout: if no recovery event fires within 15 seconds, the link is expired or invalid
    timeoutRef.current = setTimeout(() => {
      setExpired(true);
    }, TIMEOUT_MS);

    return () => {
      subscription.unsubscribe();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

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
            This password reset link has expired or is no longer valid. Reset links are single-use and expire after a short time.
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
