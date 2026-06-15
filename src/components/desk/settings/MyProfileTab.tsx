import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { queryClient } from "@/lib/query-client";

export function MyProfileTab() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      setFullName(data?.full_name ?? "");
      setLoading(false);
    })();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;

    const trimmedFullName = fullName.trim();
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: trimmedFullName || null })
      .eq("id", user.id);
    setSaving(false);

    if (error) {
      toast.error("Could not save profile");
      return;
    }

    setFullName(trimmedFullName);
    queryClient.setQueryData(["user-profile-org", user.id], (current: { org_id?: string | null; full_name?: string | null } | undefined) => ({
      ...current,
      full_name: trimmedFullName || null,
    }));
    queryClient.invalidateQueries({ queryKey: ["user-profile-org", user.id] });
    toast.success("Profile updated");
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground/70">Loading…</div>;
  }

  return (
    <div className="space-y-8 md:space-y-10 max-w-2xl">
      <Field label="Full name">
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="w-full bg-card border border-border rounded-md px-4 py-3 text-base md:text-sm text-foreground focus:outline-none focus:border-slate-400 transition-colors"
          placeholder="Your full legal name"
        />
      </Field>
      <Field label="Email address" hint="Your sign-in identity. Contact support to change.">
        <input
          value={user?.email ?? ""}
          disabled
          className="w-full bg-muted border border-border rounded-md px-4 py-3 text-base md:text-sm text-muted-foreground font-mono"
        />
      </Field>
      <div className="pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-[44px]"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      <DangerZone
        userEmail={user?.email ?? ""}
        onDeleted={async () => {
          await supabase.auth.signOut();
          navigate("/", { replace: true });
        }}
      />
    </div>
  );
}

const DELETION_CATEGORIES: { value: string; label: string }[] = [
  { value: "no_longer_needed", label: "No longer need the platform" },
  { value: "switched_provider", label: "Switched to another provider" },
  { value: "privacy_concerns", label: "Privacy concerns" },
  { value: "missing_features", label: "Missing features" },
  { value: "too_complex", label: "Too complex to use" },
  { value: "cost", label: "Cost" },
  { value: "other", label: "Other" },
];

function DangerZone({ userEmail, onDeleted }: { userEmail: string; onDeleted: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const [category, setCategory] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reasonValid = reason.trim().length >= 5;
  const categoryValid = DELETION_CATEGORIES.some((c) => c.value === category);
  const confirmationValid = confirmation.trim().toLowerCase() === userEmail.toLowerCase();
  const canSubmit = !submitting && reasonValid && categoryValid && confirmationValid;

  const handleDelete = async () => {
    setSubmitting(true);
    try {
      const idempotencyKey =
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `del-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const requestId =
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      if (!accessToken) {
        toast.error("Please sign in again before deleting your account.");
        return;
      }

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-account`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "X-Request-Id": requestId,
        },
        body: JSON.stringify({ confirmation, reason: reason.trim(), category }),
      });

      const data = (await response.json().catch(() => null)) as {
        message?: string;
        error?: string;
        request_id?: string;
      } | null;

      if (!response.ok) {
        const traceId = data?.request_id ?? response.headers.get("x-request-id") ?? requestId;
        const msg =
          data?.message ??
          data?.error ??
          "Could not delete account.";
        toast.error(`${msg} Trace: ${traceId}`);
        return;
      }
      toast.success(
        data?.message ??
          "Account scheduled for deletion. You can sign in within 30 days to cancel.",
        { duration: 8000 },
      );
      await onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete account.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-12 border-t border-destructive/30 pt-8">
      <h3 className="text-sm font-medium tracking-wider uppercase text-destructive mb-2">
        Danger zone
      </h3>
      <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
        Delete your account if you no longer need access. Your trade and compliance
        records are retained for the 7-year regulatory window, but your personal
        details are anonymised immediately. You have a 30-day grace period to
        recover the account by signing back in.
      </p>

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center justify-center px-4 py-2.5 rounded-md border border-destructive/50 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors min-h-[44px]"
        >
          Delete my account
        </button>
      ) : (
        <div className="space-y-4 bg-destructive/5 border border-destructive/30 rounded-md p-4 md:p-6">
          <div className="space-y-2">
            <label className="block text-xs font-medium tracking-wider uppercase text-muted-foreground">
              Reason category <span className="text-destructive">*</span>
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-card border border-border rounded-md px-4 py-3 text-sm text-foreground focus:outline-none focus:border-slate-400 transition-colors"
              aria-required="true"
            >
              <option value="">Select a reason…</option>
              {DELETION_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-medium tracking-wider uppercase text-muted-foreground">
              Tell us more <span className="text-destructive">*</span>
              <span className="ml-2 normal-case tracking-normal text-muted-foreground/70">(min 5 characters, max 500)</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Help us improve - what's prompting you to leave?"
              className="w-full bg-card border border-border rounded-md px-4 py-3 text-sm text-foreground focus:outline-none focus:border-slate-400 transition-colors resize-none"
              aria-required="true"
            />
            <p className="text-xs text-muted-foreground/70">
              {reason.trim().length}/500 - admins review these to improve the platform.
            </p>
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-medium tracking-wider uppercase text-muted-foreground">
              Type <span className="font-mono text-foreground">{userEmail}</span> to confirm <span className="text-destructive">*</span>
            </label>
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
              className="w-full bg-card border border-border rounded-md px-4 py-3 text-sm text-foreground focus:outline-none focus:border-destructive transition-colors font-mono"
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              onClick={handleDelete}
              disabled={!canSubmit}
              className="inline-flex items-center justify-center px-4 py-2.5 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
            >
              {submitting ? "Deleting…" : "Permanently delete account"}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setConfirmation("");
                setReason("");
                setCategory("");
              }}
              disabled={submitting}
              className="inline-flex items-center justify-center px-4 py-2.5 rounded-md border border-border text-foreground text-sm font-medium hover:bg-muted transition-colors min-h-[44px]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium tracking-wider uppercase text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground/70 leading-relaxed">{hint}</p>}
    </div>
  );
}
