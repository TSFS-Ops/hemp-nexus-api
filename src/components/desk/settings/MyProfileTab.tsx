import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { queryClient } from "@/lib/query-client";

export function MyProfileTab() {
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
    return <div className="text-sm text-slate-400">Loading…</div>;
  }

  return (
    <div className="space-y-8 md:space-y-10 max-w-2xl">
      <Field label="Full name">
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="w-full bg-white border border-slate-200 rounded-md px-4 py-3 text-base md:text-sm text-slate-900 focus:outline-none focus:border-slate-400 transition-colors"
          placeholder="Your full legal name"
        />
      </Field>
      <Field label="Email address" hint="Your sign-in identity. Contact support to change.">
        <input
          value={user?.email ?? ""}
          disabled
          className="w-full bg-slate-50 border border-slate-200 rounded-md px-4 py-3 text-base md:text-sm text-slate-500 font-mono"
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
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium tracking-wider uppercase text-slate-500">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-400 leading-relaxed">{hint}</p>}
    </div>
  );
}
