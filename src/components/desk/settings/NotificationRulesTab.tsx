import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Rule {
  key: string;
  title: string;
  description: string;
  defaultOn: boolean;
}

const RULES: Rule[] = [
  {
    key: "counterparty_action",
    title: "Counterparty action required",
    description: "Notify me when a trading partner has acted and the deal awaits my response.",
    defaultOn: true,
  },
  {
    key: "poi_sealed",
    title: "Proof of Intent sealed",
    description: "Confirm by email when a Proof of Intent is tamper-proofally sealed and binding.",
    defaultOn: true,
  },
  {
    key: "compliance_status",
    title: "Compliance status changes",
    description: "Alert me to changes in my company's verification or jurisdiction status.",
    defaultOn: true,
  },
  {
    key: "weekly_summary",
    title: "Weekly desk summary",
    description: "A clean Monday digest of pipeline activity, sealed deals, and outstanding actions.",
    defaultOn: false,
  },
  {
    key: "new_counterparty",
    title: "New counterparty matches",
    description: "When a verified counterparty matching your trade interests joins the network.",
    defaultOn: false,
  },
];

const DEFAULTS = Object.fromEntries(RULES.map((r) => [r.key, r.defaultOn]));

export function NotificationRulesTab() {
  const { user } = useAuth();
  const [state, setState] = useState<Record<string, boolean>>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Hydrate from DB
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("preferences")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        toast.error("Could not load preferences");
      } else if (data?.preferences) {
        const stored = data.preferences as Record<string, boolean>;
        setState({ ...DEFAULTS, ...stored });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const toggle = async (key: string) => {
    if (!user) return;
    const next = { ...state, [key]: !state[key] };
    setState(next);
    setSavingKey(key);
    // Batch M Fix 6: route through edge function so audit + AAL2 gates apply.
    const { error } = await supabase.functions.invoke("update-notification-preferences", {
      body: { preferences: { [key]: next[key] } },
    });
    setSavingKey(null);
    if (error) {
      setState(state);
      const msg = (error as { message?: string }).message || "Could not save preference";
      if (msg.toLowerCase().includes("mfa")) {
        toast.error("This preference requires MFA. Enrol an authenticator app and retry.");
      } else {
        toast.error(msg);
      }
      return;
    }
    toast.success("Preference saved");
  };

  return (
    <div className="max-w-3xl">
      <div className="mb-8 md:mb-10">
        <h2 className="text-lg md:text-xl font-medium text-foreground tracking-tight">
          Notification Rules
        </h2>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-md">
          Choose precisely when the desk should reach you by email. All notifications respect quiet hours by default.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground/70">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading preferences…
        </div>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {RULES.map((rule) => (
            <li key={rule.key} className="py-5 md:py-6 flex items-start justify-between gap-4 md:gap-8">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{rule.title}</p>
                <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                  {rule.description}
                </p>
              </div>
              <Toggle
                on={state[rule.key]}
                pending={savingKey === rule.key}
                onChange={() => toggle(rule.key)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Toggle({
  on,
  pending,
  onChange,
}: {
  on: boolean;
  pending: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      disabled={pending}
      role="switch"
      aria-checked={on}
      aria-busy={pending}
      className={[
        "shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
        on ? "bg-primary" : "bg-muted",
        pending ? "opacity-60" : "",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-5 w-5 transform rounded-full bg-card transition-transform shadow-sm",
          on ? "translate-x-5" : "translate-x-0.5",
        ].join(" ")}
      />
    </button>
  );
}
