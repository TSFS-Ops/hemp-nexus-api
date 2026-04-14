import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, interpolate, spring, Sequence } from "remotion";
import { TransitionSeries, springTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";

const DARK = "#0B0F19";
const ACCENT = "#10B981";
const TEXT = "#E2E8F0";
const MUTED = "#94A3B8";

const screens = [
  { file: "screens/01-landing.png", label: "Step 1 — Landing Page", desc: "Declare your trade interest as a buyer or seller." },
  { file: "screens/02-dashboard.png", label: "Step 2 — Console", desc: "Your command centre. Credits, activity, and next steps at a glance." },
  { file: "screens/03-search.png", label: "Step 3 — Search", desc: "Find trading partners by commodity, region, or company." },
  { file: "screens/04-results.png", label: "Step 4 — Discovery Results", desc: "AI-powered discovery surfaces counterparties from registry and web." },
  { file: "screens/05-matches.png", label: "Step 5 — Matches", desc: "Review all matches, statuses, and evidence in one view." },
  { file: "screens/06-match-detail.png", label: "Step 6 — Match Detail & POI", desc: "Governance documents, jurisdiction checks, and WaD evidence." },
];

const T = 20; // transition frames

function ScreenScene({ file, label, desc }: { file: string; label: string; desc: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const imgScale = interpolate(frame, [0, 30], [1.05, 1], { extrapolateRight: "clamp" });
  const imgOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });

  const labelY = spring({ frame: frame - 10, fps, config: { damping: 20, stiffness: 180 } });
  const labelTranslate = interpolate(labelY, [0, 1], [40, 0]);
  const labelOpacity = interpolate(labelY, [0, 1], [0, 1]);

  const descSpring = spring({ frame: frame - 20, fps, config: { damping: 20, stiffness: 180 } });
  const descOpacity = interpolate(descSpring, [0, 1], [0, 1]);
  const descY = interpolate(descSpring, [0, 1], [20, 0]);

  // Subtle floating
  const floatY = Math.sin(frame * 0.03) * 3;

  return (
    <AbsoluteFill style={{ backgroundColor: DARK }}>
      {/* Subtle gradient overlay */}
      <div style={{
        position: "absolute", inset: 0,
        background: `radial-gradient(ellipse 80% 60% at 50% 80%, ${ACCENT}15, transparent)`,
      }} />

      {/* Screenshot in a browser frame */}
      <div style={{
        position: "absolute",
        top: 60 + floatY,
        left: 120,
        right: 120,
        bottom: 160,
        display: "flex",
        flexDirection: "column",
        opacity: imgOpacity,
        transform: `scale(${imgScale})`,
      }}>
        {/* Browser chrome */}
        <div style={{
          height: 36,
          background: "#1E293B",
          borderRadius: "12px 12px 0 0",
          display: "flex",
          alignItems: "center",
          paddingLeft: 16,
          gap: 8,
        }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#EF4444" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#F59E0B" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#22C55E" }} />
          <div style={{
            marginLeft: 16,
            background: "#0F172A",
            borderRadius: 6,
            padding: "4px 20px",
            color: MUTED,
            fontSize: 13,
            fontFamily: "monospace",
          }}>
            izenzo.co.za
          </div>
        </div>
        {/* Screenshot */}
        <div style={{
          flex: 1,
          overflow: "hidden",
          borderRadius: "0 0 12px 12px",
          boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
        }}>
          <Img src={staticFile(file)} style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "top",
          }} />
        </div>
      </div>

      {/* Label bar at bottom */}
      <div style={{
        position: "absolute",
        bottom: 40,
        left: 120,
        right: 120,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}>
        <div style={{
          fontSize: 28,
          fontWeight: 700,
          color: ACCENT,
          fontFamily: "sans-serif",
          letterSpacing: "-0.02em",
          transform: `translateY(${labelTranslate}px)`,
          opacity: labelOpacity,
        }}>
          {label}
        </div>
        <div style={{
          fontSize: 18,
          color: MUTED,
          fontFamily: "sans-serif",
          opacity: descOpacity,
          transform: `translateY(${descY}px)`,
        }}>
          {desc}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function TitleScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleSpring = spring({ frame, fps, config: { damping: 15, stiffness: 120 } });
  const titleScale = interpolate(titleSpring, [0, 1], [0.8, 1]);
  const titleOpacity = interpolate(titleSpring, [0, 1], [0, 1]);

  const subtitleSpring = spring({ frame: frame - 15, fps, config: { damping: 20 } });
  const subtitleOpacity = interpolate(subtitleSpring, [0, 1], [0, 1]);
  const subtitleY = interpolate(subtitleSpring, [0, 1], [30, 0]);

  const lineWidth = interpolate(frame, [20, 50], [0, 300], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{
      backgroundColor: DARK,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}>
      <div style={{
        position: "absolute", inset: 0,
        background: `radial-gradient(ellipse 60% 50% at 50% 50%, ${ACCENT}10, transparent)`,
      }} />
      <div style={{ textAlign: "center", transform: `scale(${titleScale})`, opacity: titleOpacity }}>
        <div style={{
          fontSize: 72,
          fontWeight: 800,
          color: TEXT,
          fontFamily: "sans-serif",
          letterSpacing: "-0.04em",
          lineHeight: 1.1,
        }}>
          Izenzo
        </div>
        <div style={{
          width: lineWidth,
          height: 3,
          background: ACCENT,
          margin: "16px auto",
          borderRadius: 2,
        }} />
        <div style={{
          fontSize: 26,
          color: MUTED,
          fontFamily: "sans-serif",
          opacity: subtitleOpacity,
          transform: `translateY(${subtitleY}px)`,
        }}>
          Platform Walkthrough — End to End
        </div>
      </div>
    </AbsoluteFill>
  );
}

function OutroScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const s = spring({ frame, fps, config: { damping: 15 } });
  const opacity = interpolate(s, [0, 1], [0, 1]);
  const scale = interpolate(s, [0, 1], [0.9, 1]);

  return (
    <AbsoluteFill style={{
      backgroundColor: DARK,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}>
      <div style={{
        position: "absolute", inset: 0,
        background: `radial-gradient(ellipse 60% 50% at 50% 50%, ${ACCENT}15, transparent)`,
      }} />
      <div style={{ textAlign: "center", opacity, transform: `scale(${scale})` }}>
        <div style={{
          fontSize: 48,
          fontWeight: 800,
          color: TEXT,
          fontFamily: "sans-serif",
          letterSpacing: "-0.03em",
        }}>
          Execute with Confidence.
        </div>
        <div style={{
          fontSize: 22,
          color: ACCENT,
          fontFamily: "sans-serif",
          marginTop: 16,
        }}>
          izenzo.co.za
        </div>
      </div>
    </AbsoluteFill>
  );
}

export const WalkthroughVideo: React.FC = () => {
  return (
    <AbsoluteFill>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={75}>
          <TitleScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={springTiming({ config: { damping: 200 }, durationInFrames: T })}
        />

        {screens.map((screen, i) => (
          <>
            <TransitionSeries.Sequence key={`s-${i}`} durationInFrames={90}>
              <ScreenScene file={screen.file} label={screen.label} desc={screen.desc} />
            </TransitionSeries.Sequence>
            {i < screens.length - 1 && (
              <TransitionSeries.Transition
                key={`t-${i}`}
                presentation={i % 2 === 0 ? fade() : slide({ direction: "from-right" })}
                timing={springTiming({ config: { damping: 200 }, durationInFrames: T })}
              />
            )}
          </>
        ))}

        <TransitionSeries.Transition
          presentation={fade()}
          timing={springTiming({ config: { damping: 200 }, durationInFrames: T })}
        />

        <TransitionSeries.Sequence durationInFrames={90}>
          <OutroScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
