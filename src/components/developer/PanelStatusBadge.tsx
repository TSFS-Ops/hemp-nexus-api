/**
 * PanelStatusBadge
 *
 * Small inline badge that marks a panel as one of:
 *
 *   - functional   = wired to live data, safe to act on
 *   - informational = static reference content, no live state
 *   - pending       = visible but not yet confirmed by engineering
 *
 * Sits next to a panel title so internal users immediately know what
 * they can rely on today.
 */

type Kind = "functional" | "informational" | "pending";

const TONES: Record<Kind, { label: string; cls: string }> = {
  functional: {
    label: "functional",
    cls: "text-emerald-400 border-emerald-500/40",
  },
  informational: {
    label: "informational",
    cls: "text-slate-400 border-slate-600",
  },
  pending: {
    label: "pending engineering confirmation",
    cls: "text-amber-300 border-amber-500/40",
  },
};

export function PanelStatusBadge({ kind }: { kind: Kind }) {
  const tone = TONES[kind];
  return (
    <span
      className={[
        "inline-flex items-center font-mono text-[9.5px] uppercase tracking-[0.18em] px-1.5 py-0.5 border rounded-sm",
        tone.cls,
      ].join(" ")}
      title={
        kind === "functional"
          ? "Live data, safe to act on."
          : kind === "informational"
          ? "Static reference, no live state."
          : "Visible but not yet confirmed by engineering."
      }
    >
      {tone.label}
    </span>
  );
}
