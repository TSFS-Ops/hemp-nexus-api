/**
 * Subtle cryptographic hash-chain motif for the Auth right pane.
 * Pure SVG, no external assets. Low contrast, decorative only.
 */
export function HashChainMotif() {
  // Deterministic pseudo-random hash fragments, cosmetic only
  const fragments = [
    "0x7a3f9c2e8b14d5a9",
    "0xb82d4f1c7e6a09f3",
    "0x4e9c1d8a3f5b7026",
    "0xd1f6a83c2b9e4570",
    "0x6c3e8a4f1d927b58",
    "0xa5b914f7c2306e8d",
    "0x29f74d6e1c83a0b5",
    "0xe8c14a23f96d7b50",
    "0x3b07d9f2c41a8e65",
    "0x9f2e64a8d513c70b",
  ];

  return (
    <div
      aria-hidden
      className="pointer-events-none select-none font-mono text-[10px] leading-relaxed tracking-tight text-white/[0.08] space-y-1"
    >
      {fragments.map((hash, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-white/[0.12]">└─</span>
          <span>{hash}</span>
          <span className="text-white/[0.06]">·</span>
          <span>blk {String(982341 + i).padStart(7, "0")}</span>
        </div>
      ))}
    </div>
  );
}
