import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { DEEP_SLATE, EMERALD, WHITE, FONT_INTER, EMERALD_LIGHT } from "../theme";

export const Scene1_Title: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleScale = spring({ frame: frame - 10, fps, config: { damping: 20, stiffness: 150 } });
  const titleOpacity = interpolate(frame, [5, 25], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const subtitleOpacity = interpolate(frame, [30, 50], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const subtitleY = interpolate(spring({ frame: Math.max(0, frame - 30), fps, config: { damping: 20 } }), [0, 1], [30, 0]);
  const lineWidth = interpolate(frame, [50, 80], [0, 400], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: DEEP_SLATE, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {/* Subtle gradient orb */}
      <div style={{
        position: "absolute",
        width: 600,
        height: 600,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${EMERALD}22 0%, transparent 70%)`,
        top: "20%",
        right: "15%",
        filter: "blur(60px)",
      }} />

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 30, zIndex: 1 }}>
        <div style={{
          fontFamily: FONT_INTER,
          fontSize: 72,
          fontWeight: 700,
          color: WHITE,
          opacity: titleOpacity,
          transform: `scale(${titleScale})`,
          textAlign: "center",
        }}>
          The Izenzo Trade Flow
        </div>

        <div style={{
          width: lineWidth,
          height: 3,
          backgroundColor: EMERALD,
          borderRadius: 2,
        }} />

        <div style={{
          fontFamily: FONT_INTER,
          fontSize: 28,
          fontWeight: 400,
          color: EMERALD_LIGHT,
          opacity: subtitleOpacity,
          transform: `translateY(${subtitleY}px)`,
          textAlign: "center",
          maxWidth: 800,
          lineHeight: 1.5,
        }}>
          From discovery to proof of intent — step by step
        </div>
      </div>
    </AbsoluteFill>
  );
};
