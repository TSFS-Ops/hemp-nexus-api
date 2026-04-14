import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { DEEP_SLATE, EMERALD, WHITE, SLATE_400, SLATE_700, FONT_INTER, EMERALD_LIGHT } from "../theme";
import { StepIndicator } from "../components/StepIndicator";

export const Scene6_Engagement: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Record creation
  const recordSpring = spring({ frame: frame - 10, fps, config: { damping: 18 } });
  const recordOpacity = interpolate(frame, [5, 25], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Notification paths
  const emailSpring = spring({ frame: Math.max(0, frame - 45), fps, config: { damping: 15 } });
  const emailOpacity = interpolate(frame, [40, 55], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const bellSpring = spring({ frame: Math.max(0, frame - 55), fps, config: { damping: 15 } });
  const bellOpacity = interpolate(frame, [50, 65], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const descOpacity = interpolate(frame, [75, 90], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: DEEP_SLATE }}>
      <StepIndicator step={5} label="Engagement Created & Notifications Sent" />

      <div style={{
        position: "absolute",
        top: "30%",
        left: "50%",
        transform: "translate(-50%, 0)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 50,
      }}>
        {/* Engagement record card */}
        <div style={{
          backgroundColor: `${SLATE_700}55`,
          borderRadius: 12,
          border: `1px solid ${EMERALD}44`,
          padding: "24px 40px",
          opacity: recordOpacity,
          transform: `scale(${recordSpring})`,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          alignItems: "center",
        }}>
          <div style={{ fontFamily: FONT_INTER, fontSize: 14, color: SLATE_400, textTransform: "uppercase", letterSpacing: 2 }}>
            Engagement Record
          </div>
          <div style={{
            fontFamily: FONT_INTER,
            fontSize: 20,
            fontWeight: 600,
            color: EMERALD_LIGHT,
            backgroundColor: `${EMERALD}22`,
            padding: "6px 20px",
            borderRadius: 20,
          }}>
            Status: Notification Sent
          </div>
        </div>

        {/* Notification paths */}
        <div style={{ display: "flex", gap: 60 }}>
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            opacity: emailOpacity,
            transform: `translateY(${interpolate(emailSpring, [0, 1], [20, 0])}px)`,
          }}>
            <div style={{ fontSize: 48 }}>📧</div>
            <div style={{ fontFamily: FONT_INTER, fontSize: 18, color: WHITE, fontWeight: 500 }}>Email Sent</div>
            <div style={{ fontFamily: FONT_INTER, fontSize: 14, color: SLATE_400 }}>to counterparty</div>
          </div>

          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            opacity: bellOpacity,
            transform: `translateY(${interpolate(bellSpring, [0, 1], [20, 0])}px)`,
          }}>
            <div style={{ fontSize: 48 }}>🔔</div>
            <div style={{ fontFamily: FONT_INTER, fontSize: 18, color: WHITE, fontWeight: 500 }}>In-App Alert</div>
            <div style={{ fontFamily: FONT_INTER, fontSize: 14, color: SLATE_400 }}>to counterparty</div>
          </div>
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
        Only now — after the token has been burned — is the counterparty notified. They receive an email and an in-app notification telling them someone has declared intent.
      </div>
    </AbsoluteFill>
  );
};
