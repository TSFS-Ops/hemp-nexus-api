import { useState } from "react";
import { toast } from "sonner";

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
    description: "Confirm by email when a Proof of Intent is cryptographically sealed and binding.",
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

export function NotificationRulesTab() {
  const [state, setState] = useState<Record<string, boolean>>(
    Object.fromEntries(RULES.map((r) => [r.key, r.defaultOn])),
  );

  const toggle = (key: string) => {
    setState((s) => ({ ...s, [key]: !s[key] }));
    toast.success("Notification preference saved");
  };

  return (
    <div className="max-w-3xl">
      <div className="mb-10">
        <h2 className="text-xl font-medium text-slate-900 tracking-tight">
          Notification Rules
        </h2>
        <p className="mt-2 text-sm text-slate-500 leading-relaxed max-w-md">
          Choose precisely when the desk should reach you by email. All notifications respect quiet hours by default.
        </p>
      </div>

      <ul className="divide-y divide-slate-200 border-y border-slate-200">
        {RULES.map((rule) => (
          <li key={rule.key} className="py-6 flex items-start justify-between gap-8">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900">{rule.title}</p>
              <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">
                {rule.description}
              </p>
            </div>
            <Toggle on={state[rule.key]} onChange={() => toggle(rule.key)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      role="switch"
      aria-checked={on}
      className={[
        "shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
        on ? "bg-primary" : "bg-slate-200",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-5 w-5 transform rounded-full bg-white transition-transform shadow-sm",
          on ? "translate-x-5" : "translate-x-0.5",
        ].join(" ")}
      />
    </button>
  );
}
