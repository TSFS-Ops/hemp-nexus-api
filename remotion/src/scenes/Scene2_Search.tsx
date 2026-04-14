import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig, Sequence } from "remotion";
import { DEEP_SLATE, EMERALD, WHITE, SLATE_400, SLATE_700, FONT_INTER, FONT_MONO, EMERALD_LIGHT } from "../theme";
import { StepIndicator } from "../components/StepIndicator";

export const Scene2_Search: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Search bar animation
  const barScale = spring({ frame: frame - 15, fps, config: { damping: 20, stiffness: 200 } });
  const barOpacity = interpolate(frame, [10, 25], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Typing animation
  const searchText = "maize seller Johannesburg";
  const charsVisible = Math.min(
    searchText.length,
    Math.max(0, Math.floor((frame - 30) / 2))
  );
  const displayedText = searchText.slice(0, charsVisible);

  // Description text
  const descOpacity = interpolate(frame, [60, 80], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const descY = interpolate(spring({ frame: Math.max(0, frame - 60), fps, config: { damping: 20 } }), [0, 1], [25, 0]);

  return (
    <AbsoluteFill style={{ backgroundColor: DEEP_SLATE }}>
      <div style={{
        position: "absolute",
        width: 500,
        height: 500,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${EMERALD}15 0%, transparent 70%)`,
        bottom: "-10%",
        left: "-5%",
        filter: "blur(80px)",
      }} />

      <StepIndicator step={1} label="Discovery Search" />

      <div style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: `translate(-50%, -50%)`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 40,
        width: "80%",
      }}>
        {/* Search bar */}
        <div style={{
          width: 700,
          height: 64,
          borderRadius: 12,
          border: `2px solid ${EMERALD}`,
          backgroundColor: `${SLATE_700}88`,
          display: "flex",
          alignItems: "center",
          paddingLeft: 24,
          paddingRight: 24,
          opacity: barOpacity,
          transform: `scale(${barScale})`,
        }}>
          <span style={{ fontSize: 24, marginRight: 16 }}>🔍</span>
          <span style={{
            fontFamily: FONT_MONO,
            fontSize: 20,
            color: WHITE,
            letterSpacing: 0.5,
          }}>
            {displayedText}
            {frame > 30 && frame < 80 && frame % 16 < 8 && (
              <span style={{ color: EMERALD }}>|</span>
            )}
          </span>
        </div>

        {/* Description */}
        <div style={{
          fontFamily: FONT_INTER,
          fontSize: 26,
          color: SLATE_400,
          textAlign: "center",
          maxWidth: 700,
          lineHeight: 1.6,
          opacity: descOpacity,
          transform: `translateY(${descY}px)`,
        }}>
          A user searches the platform for a trading partner. No tokens are burned. No records are created. They are simply browsing.
        </div>
      </div>
    </AbsoluteFill>
  );
};
