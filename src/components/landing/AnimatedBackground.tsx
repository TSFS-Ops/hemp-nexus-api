/**
 * Dark terminal animated background — dotted world map, floating emerald orbs,
 * and slow scan line. Scoped to landing page only.
 */

export function AnimatedBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
      {/* Deep dark base */}
      <div className="absolute inset-0" style={{ backgroundColor: 'var(--lt-bg)' }} />

      {/* World map dot pattern — top-left quadrant */}
      <div
        className="absolute top-0 left-0 w-[70%] h-[60%] opacity-40 world-map-dots"
      />

      {/* Animated dot grid that slowly drifts */}
      <div
        className="absolute inset-[-50%] w-[200%] h-[200%] opacity-[0.03] animate-grid-drift"
        style={{
          backgroundImage: `radial-gradient(circle, rgba(226, 232, 240, 0.5) 0.5px, transparent 0.5px)`,
          backgroundSize: "32px 32px",
        }}
      />

      {/* Floating orb 1 — emerald, top-left */}
      <div className="absolute top-[5%] left-[10%] w-[500px] h-[500px] rounded-full blur-[160px] opacity-[0.06] animate-orb-1"
        style={{ background: '#10B981' }}
      />

      {/* Floating orb 2 — slate blue, mid-right */}
      <div className="absolute top-[35%] right-[5%] w-[400px] h-[400px] rounded-full blur-[140px] opacity-[0.04] animate-orb-2"
        style={{ background: '#1E40AF' }}
      />

      {/* Floating orb 3 — emerald accent, bottom */}
      <div className="absolute bottom-[15%] left-[15%] w-[350px] h-[350px] rounded-full blur-[120px] opacity-[0.04] animate-orb-3"
        style={{ background: '#059669' }}
      />

      {/* Thin horizontal scan line */}
      <div
        className="absolute left-0 right-0 h-px animate-scan-line"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(52, 211, 153, 0.15), transparent)' }}
      />
    </div>
  );
}
