/**
 * Full-page animated background — floating gradient orbs, drifting grid,
 * and subtle particle-like dots. Layered behind entire landing page.
 * Uses CSS animations only — no JS runtime cost.
 */

export function AnimatedBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
      {/* Animated dot grid that slowly drifts */}
      <div
        className="absolute inset-[-50%] w-[200%] h-[200%] opacity-[0.03] dark:opacity-[0.05] animate-grid-drift"
        style={{
          backgroundImage: `radial-gradient(circle, hsl(var(--foreground)) 0.5px, transparent 0.5px)`,
          backgroundSize: "32px 32px",
        }}
      />

      {/* Floating orb 1 — warm copper, top-left drift */}
      <div className="absolute top-[5%] left-[10%] w-[500px] h-[500px] rounded-full blur-[160px] opacity-[0.06] animate-orb-1"
        style={{ background: `hsl(var(--primary))` }}
      />

      {/* Floating orb 2 — cool slate, mid-right drift */}
      <div className="absolute top-[35%] right-[5%] w-[400px] h-[400px] rounded-full blur-[140px] opacity-[0.04] animate-orb-2"
        style={{ background: `hsl(var(--earth-slate))` }}
      />

      {/* Floating orb 3 — sage accent, bottom-left */}
      <div className="absolute bottom-[15%] left-[15%] w-[350px] h-[350px] rounded-full blur-[120px] opacity-[0.04] animate-orb-3"
        style={{ background: `hsl(var(--earth-sage))` }}
      />

      {/* Floating orb 4 — copper echo, bottom-right */}
      <div className="absolute bottom-[5%] right-[20%] w-[300px] h-[300px] rounded-full blur-[130px] opacity-[0.035] animate-orb-4"
        style={{ background: `hsl(var(--primary))` }}
      />

      {/* Thin horizontal scan line — slow sweep */}
      <div className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/10 to-transparent animate-scan-line" />

      {/* Vertical accent lines — architectural rhythm */}
      <div className="absolute inset-0 opacity-[0.015] dark:opacity-[0.025]"
        style={{
          backgroundImage: `repeating-linear-gradient(90deg, hsl(var(--foreground)) 0, hsl(var(--foreground)) 1px, transparent 1px, transparent)`,
          backgroundSize: "240px 100%",
        }}
      />
    </div>
  );
}
