import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { DEEP_SLATE, EMERALD, WHITE, SLATE_400, SLATE_700, FONT_INTER, FONT_MONO, EMERALD_LIGHT } from "../theme";
import { StepIndicator } from "../components/StepIndicator";

export const Scene4_CreateMatch: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cardSpring = spring({ frame: frame - 10, fps, config: { damping: 18 } });
  const cardScale = interpolate(cardSpring, [0, 1], [0.9, 1]);
  const cardOpacity = interpolate(frame, [5, 25], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Status badge animation
  const badgeSpring = spring({ frame: Math.max(0, frame - 40), fps, config: { damping: 12, stiffness: 250 } });

  // Details appearing
  const fields = [
    { label: "Commodity", value: "White Maize" },
    { label: "Quantity", value: "5,000 MT" },
    { label: "Price", value: "R 4,200 / MT" },
    { label: "Side", value: "Buyer" },
  ];

  const descOpacity = interpolate(frame, [70, 85], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: DEEP_SLATE }}>
      <StepIndicator step={3} label="Create Match & Add Details" />

      <div style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: `translate(-50%, -50%) scale(${cardScale})`,
        opacity: cardOpacity,
        width: 700,
        backgroundColor: `${SLATE_700}55`,
        borderRadius: 16,
        border: `1px solid ${SLATE_700}`,
        padding: 40,
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
          <div>
            <div style={{ fontFamily: FONT_INTER, fontSize: 28, fontWeight: 700, color: WHITE }}>
              Grain Holdings (Pty) Ltd
            </div>
            <div style={{ fontFamily: FONT_INTER, fontSize: 16, color: SLATE_400, marginTop: 4 }}>
              Johannesburg, ZA
            </div>
          </div>
          <div style={{
            fontFamily: FONT_INTER,
            fontSize: 14,
            fontWeight: 600,
            color: EMERALD_LIGHT,
            backgroundColor: `${EMERALD}22`,
            padding: "8px 20px",
            borderRadius: 20,
            transform: `scale(${badgeSpring})`,
          }}>
            Discovery
          </div>
        </div>

        {/* Trade details */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {fields.map((f, i) => {
            const d = i * 8;
            const fOpacity = interpolate(frame - d, [40, 55], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            const fX = interpolate(
              spring({ frame: Math.max(0, frame - 45 - d), fps, config: { damping: 20, stiffness: 200 } }),
              [0, 1], [30, 0]
            );
            return (
              <div key={i} style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "12px 0",
                borderBottom: `1px solid ${SLATE_700}44`,
                opacity: fOpacity,
                transform: `translateX(${fX}px)`,
              }}>
                <span style={{ fontFamily: FONT_INTER, fontSize: 18, color: SLATE_400 }}>{f.label}</span>
                <span style={{ fontFamily: FONT_MONO, fontSize: 18, color: WHITE, fontWeight: 500 }}>{f.value}</span>
              </div>
            );
          })}
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
        A match record is created in "Discovery" state. The user fills in what they want to trade — commodity, quantity, price, and side. No obligations yet.
      </div>
    </AbsoluteFill>
  );
};
