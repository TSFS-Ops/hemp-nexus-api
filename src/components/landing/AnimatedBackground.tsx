/**
 * Dark terminal animated background - faint dotted world map overlay,
 * floating emerald orbs, and slow scan line. NO grid pattern.
 */

export function AnimatedBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
      {/* Deep dark navy/slate gradient base */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(145deg, #0A0E17 0%, #0D1220 40%, #0A0E17 100%)',
        }}
      />

      {/* World map dot pattern - faint, top-left quadrant */}
      <div
        className="absolute top-0 left-0 w-[70%] h-[60%] opacity-30 world-map-dots"
      />

      {/* Floating orb 1 - emerald, top-left */}
      <div className="absolute top-[5%] left-[10%] w-[500px] h-[500px] rounded-full blur-[160px] opacity-[0.06] animate-orb-1"
        style={{ background: '#10B981' }}
      />

      {/* Floating orb 2 - slate blue, mid-right */}
      <div className="absolute top-[35%] right-[5%] w-[400px] h-[400px] rounded-full blur-[140px] opacity-[0.04] animate-orb-2"
        style={{ background: '#1E40AF' }}
      />

      {/* Floating orb 3 - emerald accent, bottom */}
      <div className="absolute bottom-[15%] left-[15%] w-[350px] h-[350px] rounded-full blur-[120px] opacity-[0.04] animate-orb-3"
        style={{ background: '#059669' }}
      />

      {/* Thin horizontal scan line */}
      <div
        className="absolute left-0 right-0 h-px animate-scan-line"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(52, 211, 153, 0.12), transparent)' }}
      />
    </div>
  );
}
