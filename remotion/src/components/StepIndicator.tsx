import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { EMERALD, WHITE, DEEP_SLATE, FONT_INTER } from "../theme";

export const StepIndicator: React.FC<{ step: number; label: string }> = ({
  step,
  label,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({ frame, fps, config: { damping: 15, stiffness: 200 } });
  const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });

  return (
    <div
      style={{
        position: "absolute",
        top: 60,
        left: 80,
        display: "flex",
        alignItems: "center",
        gap: 20,
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: EMERALD,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FONT_INTER,
          fontSize: 28,
          fontWeight: 700,
          color: WHITE,
        }}
      >
        {step}
      </div>
      <div
        style={{
          fontFamily: FONT_INTER,
          fontSize: 22,
          fontWeight: 500,
          color: "#94a3b8",
          letterSpacing: 2,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
    </div>
  );
};
