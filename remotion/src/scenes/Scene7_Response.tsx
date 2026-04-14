import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { DEEP_SLATE, EMERALD, WHITE, SLATE_400, SLATE_700, FONT_INTER, EMERALD_LIGHT, RED_500 } from "../theme";
import { StepIndicator } from "../components/StepIndicator";

export const Scene7_Response: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Timeline items
  const items = [
    { label: "Notification Sent", time: "Day 0", active: true },
    { label: "Counterparty Views", time: "Day 1", active: frame > 30 },
    { label: "Counterparty Accepts", time: "Day 3", active: frame > 55 },
  ];

  const descOpacity = interpolate(frame, [75, 90], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Lifecycle note
  const lifecycleOpacity = interpolate(frame, [60, 75], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: DEEP_SLATE }}>
      <StepIndicator step={6} label="Counterparty Responds" />

      <div style={{
        position: "absolute",
        top: 180,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        gap: 0,
      }}>
        {items.map((item, i) => {
          const d = i * 20;
          const itemSpring = spring({ frame: Math.max(0, frame - 10 - d), fps, config: { damping: 18 } });
          const itemOpacity = interpolate(frame - d, [5, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const dotColor = item.active ? EMERALD : SLATE_700;

          return (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 24, opacity: itemOpacity }}>
              {/* Timeline line + dot */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 40 }}>
                <div style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  backgroundColor: dotColor,
                  transform: `scale(${itemSpring})`,
                  border: item.active ? "none" : `2px solid ${SLATE_400}`,
                }} />
                {i < items.length - 1 && (
                  <div style={{
                    width: 2,
                    height: 60,
                    backgroundColor: item.active ? EMERALD : `${SLATE_700}88`,
                  }} />
                )}
              </div>
              {/* Content */}
              <div style={{ paddingBottom: 44 }}>
                <div style={{ fontFamily: FONT_INTER, fontSize: 22, fontWeight: 600, color: item.active ? WHITE : SLATE_400 }}>
                  {item.label}
                </div>
                <div style={{ fontFamily: FONT_INTER, fontSize: 16, color: SLATE_400, marginTop: 4 }}>
                  {item.time}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Lifecycle reminder */}
      <div style={{
        position: "absolute",
        right: 80,
        top: 200,
        width: 400,
        backgroundColor: `${SLATE_700}55`,
        borderRadius: 12,
        padding: "24px 28px",
        border: `1px solid ${SLATE_700}`,
        opacity: lifecycleOpacity,
      }}>
        <div style={{ fontFamily: FONT_INTER, fontSize: 16, fontWeight: 600, color: WHITE, marginBottom: 12 }}>
          Engagement Lifecycle
        </div>
        <div style={{ fontFamily: FONT_INTER, fontSize: 14, color: SLATE_400, lineHeight: 1.8 }}>
          • 7 days with no response → flagged as stale{"\n"}
          • 30 days with no response → auto-expired{"\n"}
          • Declined → trade details can be re-used
        </div>
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
        opacity: descOpacity,
      }}>
        The counterparty reviews the intent declaration and accepts. The engagement moves through its lifecycle with built-in expiry safeguards.
      </div>
    </AbsoluteFill>
  );
};
