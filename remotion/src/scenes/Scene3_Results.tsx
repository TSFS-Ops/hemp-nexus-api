import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { DEEP_SLATE, EMERALD, WHITE, SLATE_400, SLATE_700, FONT_INTER, EMERALD_LIGHT } from "../theme";
import { StepIndicator } from "../components/StepIndicator";

const results = [
  { name: "Grain Holdings (Pty) Ltd", location: "Johannesburg, ZA", commodity: "Maize", role: "Seller" },
  { name: "Highveld Agri Supply", location: "Pretoria, ZA", commodity: "Maize, Soya", role: "Seller" },
  { name: "Limpopo Commodities", location: "Polokwane, ZA", commodity: "Maize", role: "Seller" },
];

export const Scene3_Results: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const descOpacity = interpolate(frame, [70, 85], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: DEEP_SLATE }}>
      <StepIndicator step={2} label="Results Returned" />

      <div style={{
        position: "absolute",
        top: 160,
        left: 80,
        right: 80,
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}>
        {results.map((r, i) => {
          const d = i * 12;
          const cardSpring = spring({ frame: Math.max(0, frame - 15 - d), fps, config: { damping: 18, stiffness: 200 } });
          const cardOpacity = interpolate(frame - d, [10, 25], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const x = interpolate(cardSpring, [0, 1], [80, 0]);

          // Highlight first card after all appear
          const selected = i === 0 && frame > 60;
          const borderColor = selected ? EMERALD : `${SLATE_700}`;
          const leftBorder = selected ? `4px solid ${EMERALD}` : "4px solid transparent";

          return (
            <div key={i} style={{
              backgroundColor: selected ? `${EMERALD}11` : `${SLATE_700}55`,
              borderRadius: 12,
              padding: "24px 32px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              opacity: cardOpacity,
              transform: `translateX(${x}px)`,
              borderLeft: leftBorder,
              border: `1px solid ${borderColor}`,
            }}>
              <div>
                <div style={{ fontFamily: FONT_INTER, fontSize: 24, fontWeight: 600, color: WHITE }}>{r.name}</div>
                <div style={{ fontFamily: FONT_INTER, fontSize: 16, color: SLATE_400, marginTop: 4 }}>{r.location} · {r.commodity}</div>
              </div>
              <div style={{
                fontFamily: FONT_INTER,
                fontSize: 14,
                fontWeight: 600,
                color: EMERALD_LIGHT,
                backgroundColor: `${EMERALD}22`,
                padding: "6px 16px",
                borderRadius: 20,
              }}>
                {r.role}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{
        position: "absolute",
        bottom: 80,
        left: 80,
        right: 80,
        fontFamily: FONT_INTER,
        fontSize: 24,
        color: SLATE_400,
        lineHeight: 1.6,
        opacity: descOpacity,
      }}>
        The platform returns matching counterparties. The user browses, compares, and selects one to engage with.
      </div>
    </AbsoluteFill>
  );
};
