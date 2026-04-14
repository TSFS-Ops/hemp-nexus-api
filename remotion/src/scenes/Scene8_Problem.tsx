import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { DEEP_SLATE, EMERALD, WHITE, SLATE_400, SLATE_700, FONT_INTER, RED_500, AMBER_500 } from "../theme";

export const Scene8_Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleSpring = spring({ frame: frame - 5, fps, config: { damping: 18 } });
  const titleOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Flow items
  const steps = [
    { text: "Token burned", icon: "🔥", color: RED_500 },
    { text: "State → Committed", icon: "⚡", color: AMBER_500 },
    { text: "Then counterparty notified", icon: "📧", color: SLATE_400 },
  ];

  const idealLabel = interpolate(frame, [70, 85], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const idealSteps = [
    { text: "Counterparty notified first", icon: "📧", color: EMERALD },
    { text: "Counterparty accepts", icon: "✅", color: EMERALD },
    { text: "Then token burned & committed", icon: "🔐", color: EMERALD },
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: DEEP_SLATE }}>
      <div style={{
        position: "absolute",
        width: 800,
        height: 800,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${RED_500}08 0%, transparent 70%)`,
        top: "10%",
        left: "30%",
        filter: "blur(80px)",
      }} />

      <div style={{
        position: "absolute",
        top: 80,
        left: 80,
        fontFamily: FONT_INTER,
        fontSize: 40,
        fontWeight: 700,
        color: WHITE,
        opacity: titleOpacity,
        transform: `scale(${titleSpring})`,
      }}>
        The Current Problem
      </div>

      {/* Current flow */}
      <div style={{
        position: "absolute",
        top: 180,
        left: 80,
        width: 700,
      }}>
        <div style={{ fontFamily: FONT_INTER, fontSize: 16, color: RED_500, fontWeight: 600, marginBottom: 20, letterSpacing: 2, textTransform: "uppercase" }}>
          Current Order of Operations
        </div>
        {steps.map((s, i) => {
          const d = i * 12;
          const sOpacity = interpolate(frame - d, [20, 35], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const sX = interpolate(
            spring({ frame: Math.max(0, frame - 25 - d), fps, config: { damping: 20 } }),
            [0, 1], [40, 0]
          );
          return (
            <div key={i} style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginBottom: 20,
              opacity: sOpacity,
              transform: `translateX(${sX}px)`,
            }}>
              <span style={{ fontSize: 28 }}>{s.icon}</span>
              <span style={{
                fontFamily: FONT_INTER,
                fontSize: 22,
                color: s.color,
                fontWeight: 500,
              }}>{i + 1}. {s.text}</span>
            </div>
          );
        })}
      </div>

      {/* Ideal flow */}
      <div style={{
        position: "absolute",
        top: 180,
        right: 80,
        width: 600,
        opacity: idealLabel,
      }}>
        <div style={{ fontFamily: FONT_INTER, fontSize: 16, color: EMERALD, fontWeight: 600, marginBottom: 20, letterSpacing: 2, textTransform: "uppercase" }}>
          Intended Order
        </div>
        {idealSteps.map((s, i) => {
          const d = i * 12;
          const sOpacity = interpolate(frame - d, [75, 90], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const sX = interpolate(
            spring({ frame: Math.max(0, frame - 80 - d), fps, config: { damping: 20 } }),
            [0, 1], [40, 0]
          );
          return (
            <div key={i} style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginBottom: 20,
              opacity: sOpacity,
              transform: `translateX(${sX}px)`,
            }}>
              <span style={{ fontSize: 28 }}>{s.icon}</span>
              <span style={{
                fontFamily: FONT_INTER,
                fontSize: 22,
                color: s.color,
                fontWeight: 500,
              }}>{i + 1}. {s.text}</span>
            </div>
          );
        })}
      </div>

      <div style={{
        position: "absolute",
        bottom: 60,
        left: 80,
        right: 80,
        fontFamily: FONT_INTER,
        fontSize: 24,
        color: SLATE_400,
        lineHeight: 1.6,
        opacity: interpolate(frame, [100, 115], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
      }}>
        The system charges the user and commits the match before the counterparty has a chance to respond. The hold-point guard needs to block until acceptance.
      </div>
    </AbsoluteFill>
  );
};
