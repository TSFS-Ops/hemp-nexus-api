import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { DEEP_SLATE, EMERALD, WHITE, SLATE_400, SLATE_700, FONT_INTER, FONT_MONO, EMERALD_LIGHT, AMBER_500 } from "../theme";
import { StepIndicator } from "../components/StepIndicator";

export const Scene5_GeneratePOI: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Button appears
  const btnOpacity = interpolate(frame, [5, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const btnScale = spring({ frame: frame - 8, fps, config: { damping: 15, stiffness: 200 } });

  // Click pulse at frame 40
  const clickScale = frame > 40 && frame < 55
    ? interpolate(frame, [40, 45, 55], [1, 0.95, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1;

  // Token counter
  const tokenVisible = frame > 50;
  const tokenOpacity = interpolate(frame, [50, 65], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const tokenCount = frame > 60 ? "9" : "10";
  const tokenColor = frame > 60 ? AMBER_500 : EMERALD_LIGHT;

  // State transition
  const stateVisible = frame > 70;
  const stateOpacity = interpolate(frame, [70, 85], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const arrowWidth = interpolate(frame, [75, 95], [0, 120], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const descOpacity = interpolate(frame, [90, 105], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: DEEP_SLATE }}>
      <StepIndicator step={4} label="Generate Proof of Intent" />

      <div style={{
        position: "absolute",
        top: "35%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 40,
      }}>
        {/* Big button */}
        <div style={{
          fontFamily: FONT_INTER,
          fontSize: 22,
          fontWeight: 700,
          color: WHITE,
          backgroundColor: EMERALD,
          padding: "18px 48px",
          borderRadius: 12,
          opacity: btnOpacity,
          transform: `scale(${btnScale * clickScale})`,
          cursor: "pointer",
        }}>
          Generate Proof of Intent
        </div>

        {/* Token burn indicator */}
        {tokenVisible && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            opacity: tokenOpacity,
          }}>
            <div style={{ fontFamily: FONT_INTER, fontSize: 18, color: SLATE_400 }}>Token Balance:</div>
            <div style={{
              fontFamily: FONT_MONO,
              fontSize: 32,
              fontWeight: 700,
              color: tokenColor,
            }}>
              {tokenCount}
            </div>
            {frame > 60 && (
              <div style={{
                fontFamily: FONT_INTER,
                fontSize: 14,
                color: AMBER_500,
                backgroundColor: `${AMBER_500}22`,
                padding: "4px 12px",
                borderRadius: 12,
              }}>
                −1 token burned
              </div>
            )}
          </div>
        )}

        {/* State transition */}
        {stateVisible && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            opacity: stateOpacity,
          }}>
            <div style={{
              fontFamily: FONT_INTER,
              fontSize: 18,
              fontWeight: 600,
              color: SLATE_400,
              backgroundColor: `${SLATE_700}88`,
              padding: "10px 24px",
              borderRadius: 8,
            }}>
              Discovery
            </div>
            <div style={{
              width: arrowWidth,
              height: 3,
              backgroundColor: EMERALD,
              borderRadius: 2,
              position: "relative",
            }}>
              <div style={{
                position: "absolute",
                right: -6,
                top: -5,
                width: 0,
                height: 0,
                borderLeft: `12px solid ${EMERALD}`,
                borderTop: "7px solid transparent",
                borderBottom: "7px solid transparent",
              }} />
            </div>
            <div style={{
              fontFamily: FONT_INTER,
              fontSize: 18,
              fontWeight: 600,
              color: WHITE,
              backgroundColor: `${EMERALD}33`,
              border: `1px solid ${EMERALD}`,
              padding: "10px 24px",
              borderRadius: 8,
            }}>
              Committed
            </div>
          </div>
        )}
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
        The user clicks "Generate POI." In one atomic transaction, the system burns one token and moves the match from Discovery to Committed. This is the point of no return.
      </div>
    </AbsoluteFill>
  );
};
