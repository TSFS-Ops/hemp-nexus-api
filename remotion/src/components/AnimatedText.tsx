import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT_INTER } from "../theme";

export const AnimatedText: React.FC<{
  text: string;
  delay?: number;
  fontSize?: number;
  color?: string;
  fontWeight?: number;
  maxWidth?: number;
  lineHeight?: number;
}> = ({
  text,
  delay = 0,
  fontSize = 48,
  color = "#f8fafc",
  fontWeight = 600,
  maxWidth = 1200,
  lineHeight = 1.4,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = frame - delay;

  const opacity = interpolate(f, [0, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = interpolate(
    spring({ frame: Math.max(0, f), fps, config: { damping: 20, stiffness: 180 } }),
    [0, 1],
    [40, 0]
  );

  return (
    <div
      style={{
        fontFamily: FONT_INTER,
        fontSize,
        fontWeight,
        color,
        opacity,
        transform: `translateY(${y}px)`,
        maxWidth,
        lineHeight,
      }}
    >
      {text}
    </div>
  );
};
