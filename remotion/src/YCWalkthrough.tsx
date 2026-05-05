import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Img,
  staticFile,
  Sequence,
} from "remotion";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import {
  BG,
  BG_DEEP,
  EMERALD,
  EMERALD_LIGHT,
  EMERALD_PALE,
  SLATE,
  SLATE_500,
  SLATE_300,
  SLATE_200,
  SLATE_100,
  WHITE,
  FONT_DISPLAY,
  FONT_MONO,
} from "./theme";

const inter = loadInter("normal", { weights: ["400", "500", "600", "700", "800"] });
const mono = loadMono("normal", { weights: ["400", "500"] });
const FF = inter.fontFamily;
const FF_MONO = mono.fontFamily;

// ---------------------------------------------------------------------------
// Persistent editorial backdrop
// ---------------------------------------------------------------------------
function Backdrop() {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame * 0.005) * 30;
  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      {/* soft emerald aurora */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse 65% 50% at ${30 + drift}% ${20 + drift / 2}%, ${EMERALD_PALE}, transparent 60%), radial-gradient(ellipse 60% 45% at ${75 - drift}% ${85 - drift / 3}%, #F0FDF4, transparent 60%)`,
        }}
      />
      {/* faint grid */}
      <svg
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.5 }}
      >
        <defs>
          <pattern id="g" width="80" height="80" patternUnits="userSpaceOnUse">
            <path d="M 80 0 L 0 0 0 80" fill="none" stroke={SLATE_200} strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#g)" />
      </svg>
      {/* vignette */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse 90% 80% at 50% 50%, transparent 50%, rgba(15,23,42,0.06) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// Reusable pieces
// ---------------------------------------------------------------------------
function Eyebrow({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  const opacity = interpolate(s, [0, 1], [0, 1]);
  const x = interpolate(s, [0, 1], [-12, 0]);
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        fontFamily: FF_MONO,
        fontSize: 16,
        letterSpacing: "0.18em",
        color: EMERALD,
        textTransform: "uppercase",
        opacity,
        transform: `translateX(${x}px)`,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: EMERALD_LIGHT,
          boxShadow: `0 0 0 4px ${EMERALD_PALE}`,
        }}
      />
      {children}
    </div>
  );
}

function WordReveal({
  text,
  delay = 0,
  size = 96,
  color = SLATE,
  weight = 800,
  lineHeight = 1.05,
}: {
  text: string;
  delay?: number;
  size?: number;
  color?: string;
  weight?: number;
  lineHeight?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");
  return (
    <div
      style={{
        fontFamily: FF,
        fontSize: size,
        fontWeight: weight,
        color,
        lineHeight,
        letterSpacing: "-0.035em",
        display: "flex",
        flexWrap: "wrap",
        gap: `0 ${size * 0.25}px`,
      }}
    >
      {words.map((w, i) => {
        const s = spring({
          frame: frame - delay - i * 4,
          fps,
          config: { damping: 18, stiffness: 110 },
        });
        const y = interpolate(s, [0, 1], [size * 0.5, 0]);
        const opacity = interpolate(s, [0, 1], [0, 1]);
        const blur = interpolate(s, [0, 1], [12, 0]);
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              transform: `translateY(${y}px)`,
              opacity,
              filter: `blur(${blur}px)`,
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
}

function ScreenFrame({
  src,
  enterFrom = "right",
  scale = 1,
}: {
  src: string;
  enterFrom?: "right" | "left" | "bottom";
  scale?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 26, stiffness: 90 } });
  const opacity = interpolate(s, [0, 1], [0, 1]);
  const offset = interpolate(s, [0, 1], [80, 0]);
  const tx = enterFrom === "right" ? offset : enterFrom === "left" ? -offset : 0;
  const ty = enterFrom === "bottom" ? offset : 0;

  // gentle entry zoom only — no continuous global drift to avoid overflow
  const zoom = 1 + (1 - s) * 0.015;

  // float
  const floatY = Math.sin(frame * 0.025) * 4;

  return (
    <div
      style={{
        position: "relative",
        opacity,
        transform: `translate(${tx}px, ${ty + floatY}px) scale(${zoom * scale})`,
        transformOrigin: "center",
        borderRadius: 14,
        overflow: "hidden",
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.6) inset, 0 30px 60px -20px rgba(15,23,42,0.25), 0 12px 30px -10px rgba(15,23,42,0.15)",
        border: `1px solid ${SLATE_200}`,
        background: WHITE,
      }}
    >
      {/* browser chrome */}
      <div
        style={{
          height: 38,
          background: "#FAFBFC",
          borderBottom: `1px solid ${SLATE_200}`,
          display: "flex",
          alignItems: "center",
          paddingLeft: 14,
          gap: 7,
        }}
      >
        <div style={{ width: 11, height: 11, borderRadius: 999, background: "#FF5F57" }} />
        <div style={{ width: 11, height: 11, borderRadius: 999, background: "#FEBC2E" }} />
        <div style={{ width: 11, height: 11, borderRadius: 999, background: "#28C840" }} />
        <div
          style={{
            marginLeft: 18,
            background: WHITE,
            border: `1px solid ${SLATE_200}`,
            borderRadius: 6,
            padding: "4px 18px",
            color: SLATE_500,
            fontSize: 12,
            fontFamily: FF_MONO,
          }}
        >
          izenzo.co.za
        </div>
      </div>
      <Img src={staticFile(src)} style={{ display: "block", width: "100%" }} />
    </div>
  );
}

function Caption({
  eyebrow,
  title,
  body,
  delay = 0,
}: {
  eyebrow: string;
  title: string;
  body?: string;
  delay?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay - 12, fps, config: { damping: 22 } });
  const opacity = interpolate(s, [0, 1], [0, 1]);
  const y = interpolate(s, [0, 1], [16, 0]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Eyebrow delay={delay}>{eyebrow}</Eyebrow>
      <WordReveal text={title} delay={delay + 6} size={84} />
      {body ? (
        <div
          style={{
            fontFamily: FF,
            fontSize: 24,
            color: SLATE_500,
            maxWidth: 560,
            lineHeight: 1.45,
            opacity,
            transform: `translateY(${y}px)`,
            fontWeight: 400,
          }}
        >
          {body}
        </div>
      ) : null}
    </div>
  );
}

function ProgressBar() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const w = interpolate(frame, [0, durationInFrames], [0, 100], {
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: 96,
        right: 96,
        bottom: 56,
        height: 2,
        background: SLATE_200,
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${w}%`,
          height: "100%",
          background: EMERALD,
          transition: "none",
        }}
      />
    </div>
  );
}

function CornerMark() {
  return (
    <div
      style={{
        position: "absolute",
        top: 56,
        left: 96,
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontFamily: FF,
        color: SLATE,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          background: EMERALD,
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 18l9 5 9-5"
            stroke="white"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>Izenzo</span>
    </div>
  );
}

function CornerMeta({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 60,
        right: 96,
        fontFamily: FF_MONO,
        fontSize: 13,
        letterSpacing: "0.16em",
        color: SLATE_500,
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SCENES
// ---------------------------------------------------------------------------

// Scene 1 — Cold open (0:00–0:05) 150f
function Scene_Open() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logoS = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });
  const logoScale = interpolate(logoS, [0, 1], [0.8, 1]);
  const logoOpacity = interpolate(logoS, [0, 1], [0, 1]);
  const lineW = interpolate(frame, [25, 60], [0, 280], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const subS = spring({ frame: frame - 35, fps, config: { damping: 22 } });
  const subOpacity = interpolate(subS, [0, 1], [0, 1]);
  const subY = interpolate(subS, [0, 1], [18, 0]);

  // gentle exit
  const out = interpolate(frame, [120, 150], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: out }}>
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 18,
            transform: `scale(${logoScale})`,
            opacity: logoOpacity,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              background: EMERALD,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 18l9 5 9-5"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div
            style={{
              fontFamily: FF,
              fontSize: 88,
              fontWeight: 700,
              color: SLATE,
              letterSpacing: "-0.04em",
            }}
          >
            Izenzo
          </div>
        </div>
        <div
          style={{
            width: lineW,
            height: 2,
            background: EMERALD,
            margin: "28px auto",
            borderRadius: 2,
          }}
        />
        <div
          style={{
            fontFamily: FF_MONO,
            fontSize: 18,
            color: SLATE_500,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            opacity: subOpacity,
            transform: `translateY(${subY}px)`,
          }}
        >
          Governance Infrastructure for Institutional Trade
        </div>
      </div>
    </AbsoluteFill>
  );
}

// Generic two-column scene
function TwoCol({
  eyebrow,
  title,
  body,
  src,
  meta,
  reverse = false,
  scale = 1,
}: {
  eyebrow: string;
  title: string;
  body: string;
  src: string;
  meta?: string;
  reverse?: boolean;
  scale?: number;
}) {
  return (
    <AbsoluteFill style={{ padding: "0 96px" }}>
      <CornerMark />
      {meta ? <CornerMeta>{meta}</CornerMeta> : null}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: reverse ? "row-reverse" : "row",
          alignItems: "center",
          gap: 80,
          paddingTop: 60,
          paddingBottom: 100,
        }}
      >
        <div style={{ flex: "0 0 42%" }}>
          <Caption eyebrow={eyebrow} title={title} body={body} delay={6} />
        </div>
        <div style={{ flex: 1, display: "flex", justifyContent: "center", minWidth: 0 }}>
          <div style={{ width: "100%", maxWidth: 860 }}>
            <ScreenFrame src={src} enterFrom={reverse ? "left" : "right"} scale={scale} />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

// Scene 2 — Landing (0:05–0:12) 210f
function Scene_Landing() {
  return (
    <TwoCol
      eyebrow="01 · Network"
      title={"One cryptographic\nnetwork."}
      body="Discover counterparties, run compliance, and seal cross-border trade with mathematically provable execution."
      src="screens/01-landing.png"
      meta="LIVE · GOVERNANCE NET"
    />
  );
}

// Scene 3 — Sign in (0:12–0:18) 180f
function Scene_SignIn() {
  return (
    <TwoCol
      eyebrow="02 · Provision"
      title={"Workspace in\nminutes."}
      body="POPIA & GDPR-compliant data residency. Every session is tamper-proofly sealed before the first trade."
      src="screens/02-signup.png"
      meta="STEP · 02"
      reverse
    />
  );
}

// Scene 4 — Trade Desk (0:18–0:28) 300f
function Scene_TradeDesk() {
  return (
    <TwoCol
      eyebrow="03 · Trade Desk"
      title={"Seal deals\nwith certainty."}
      body="The all-in-one terminal for institutional commodity trade. Negotiate terms and bind evidence into a tamper-proof Proof of Intent."
      src="screens/03-trade-desk.png"
      meta="WaD · v1.2 · SHA-256"
    />
  );
}

// Scene 5 — Compliance Engine (0:28–0:36) 240f
function Scene_Compliance() {
  return (
    <TwoCol
      eyebrow="04 · Compliance"
      title={"Identity.\nResolved."}
      body="Automated KYB. UBO structures resolved to 100%. Continuous screening against OFAC, EU, UK HMT, DPL."
      src="screens/04-compliance.png"
      meta="UBO · 100% RESOLVED"
      reverse
    />
  );
}

// Scene 6 — Audit Ledger (0:36–0:44) 240f
function Scene_Audit() {
  return (
    <TwoCol
      eyebrow="05 · Audit Ledger"
      title={"Provable\ndeal records."}
      body="Eliminate manual auditing. Eradicate fraud. Accelerate capital deployment with bank-ready, hash-sealed evidence packs."
      src="screens/05-audit.png"
      meta="LEDGER · IMMUTABLE"
    />
  );
}

// Scene 7 — Sovereigns (0:44–0:52) 240f
function Scene_Sovereigns() {
  return (
    <TwoCol
      eyebrow="06 · Macro"
      title={"Trade at\nsovereign scale."}
      body="National and cross-border programmes with end-to-end provenance, automated compliance, and real-time macro telemetry."
      src="screens/06-sovereigns.png"
      meta="$2.4B · UNDER GOVERNANCE"
      reverse
    />
  );
}

// Scene 8 — Closing (0:52–1:00) 240f
function Scene_Close() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 20 } });
  const opacity = interpolate(enter, [0, 1], [0, 1]);

  // animated stat counters
  const dealsRaw = interpolate(frame, [0, 90], [0, 18429], {
    extrapolateRight: "clamp",
  });
  const wads = interpolate(frame, [10, 100], [0, 12_840], { extrapolateRight: "clamp" });
  const value = interpolate(frame, [20, 110], [0, 9.4], { extrapolateRight: "clamp" });

  const fmt = (n: number) =>
    Math.floor(n)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  const lineW = interpolate(frame, [40, 90], [0, 320], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity }}>
      <CornerMark />
      <CornerMeta>EXECUTE · WITH CERTAINTY</CornerMeta>

      <div
        style={{
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 36,
        }}
      >
        <Eyebrow>The Civilisation OS for Trade</Eyebrow>

        <div
          style={{
            fontFamily: FF,
            fontSize: 128,
            fontWeight: 800,
            color: SLATE,
            letterSpacing: "-0.045em",
            lineHeight: 1.0,
          }}
        >
          <WordReveal text="Execute with" size={128} delay={6} />
          <div style={{ marginTop: 8 }}>
            <WordReveal
              text="absolute certainty."
              size={128}
              delay={20}
              color={EMERALD}
            />
          </div>
        </div>

        <div
          style={{
            width: lineW,
            height: 2,
            background: EMERALD,
            borderRadius: 2,
          }}
        />

        {/* live stat strip */}
        <div
          style={{
            display: "flex",
            gap: 64,
            marginTop: 12,
            fontFamily: FF_MONO,
            color: SLATE,
          }}
        >
          {[
            { label: "Trade Requests", v: fmt(dealsRaw) },
            { label: "WaD Sealed", v: fmt(wads) },
            { label: "USD Under Governance", v: `$${value.toFixed(1)}B` },
          ].map((s) => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 44, fontWeight: 600, letterSpacing: "-0.02em" }}>
                {s.v}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: SLATE_500,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  marginTop: 6,
                }}
              >
                {s.label}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 40,
            display: "inline-flex",
            alignItems: "center",
            gap: 14,
            background: SLATE,
            color: WHITE,
            padding: "18px 30px",
            borderRadius: 8,
            fontFamily: FF,
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          izenzo.co.za
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 12h14M13 5l7 7-7 7"
              stroke="white"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// COMPOSITION
// ---------------------------------------------------------------------------

// scene timings (start, length) in frames
const SCENES: { from: number; dur: number; comp: React.FC }[] = [
  { from: 0, dur: 150, comp: Scene_Open }, // 0–5s
  { from: 150, dur: 210, comp: Scene_Landing }, // 5–12s
  { from: 360, dur: 180, comp: Scene_SignIn }, // 12–18s
  { from: 540, dur: 300, comp: Scene_TradeDesk }, // 18–28s
  { from: 840, dur: 240, comp: Scene_Compliance }, // 28–36s
  { from: 1080, dur: 240, comp: Scene_Audit }, // 36–44s
  { from: 1320, dur: 240, comp: Scene_Sovereigns }, // 44–52s
  { from: 1560, dur: 240, comp: Scene_Close }, // 52–60s
];

// Crossfade transition wrapper — last 18 frames of prev fade out as next fades in
function FadingScene({
  from,
  dur,
  Comp,
  isLast,
}: {
  from: number;
  dur: number;
  Comp: React.FC;
  isLast: boolean;
}) {
  const frame = useCurrentFrame();
  const local = frame - from;
  const FADE = 18;

  // Outside its window
  if (local < -FADE || local > dur + FADE) return null;

  let opacity = 1;
  if (local < 0) {
    opacity = interpolate(local, [-FADE, 0], [0, 1]);
  } else if (!isLast && local > dur - FADE) {
    opacity = interpolate(local, [dur - FADE, dur], [1, 0]);
  }

  return (
    <Sequence from={from - FADE} durationInFrames={dur + FADE * 2} layout="none">
      <AbsoluteFill style={{ opacity }}>
        <Comp />
      </AbsoluteFill>
    </Sequence>
  );
}

export const YCWalkthrough: React.FC = () => {
  return (
    <AbsoluteFill>
      <Backdrop />
      {SCENES.map((s, i) => (
        <FadingScene
          key={i}
          from={s.from}
          dur={s.dur}
          Comp={s.comp}
          isLast={i === SCENES.length - 1}
        />
      ))}
      <ProgressBar />
    </AbsoluteFill>
  );
};
