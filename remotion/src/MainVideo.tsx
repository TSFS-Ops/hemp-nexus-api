import { AbsoluteFill, Sequence } from "remotion";
import { TransitionSeries, springTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Scene1_Title } from "./scenes/Scene1_Title";
import { Scene2_Search } from "./scenes/Scene2_Search";
import { Scene3_Results } from "./scenes/Scene3_Results";
import { Scene4_CreateMatch } from "./scenes/Scene4_CreateMatch";
import { Scene5_GeneratePOI } from "./scenes/Scene5_GeneratePOI";
import { Scene6_Engagement } from "./scenes/Scene6_Engagement";
import { Scene7_Response } from "./scenes/Scene7_Response";
import { Scene8_Problem } from "./scenes/Scene8_Problem";

const T = 20; // transition duration

export const MainVideo: React.FC = () => {
  return (
    <AbsoluteFill>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={100}>
          <Scene1_Title />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={springTiming({ config: { damping: 200 }, durationInFrames: T })}
        />
        <TransitionSeries.Sequence durationInFrames={100}>
          <Scene2_Search />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={springTiming({ config: { damping: 200 }, durationInFrames: T })}
        />
        <TransitionSeries.Sequence durationInFrames={100}>
          <Scene3_Results />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={springTiming({ config: { damping: 200 }, durationInFrames: T })}
        />
        <TransitionSeries.Sequence durationInFrames={100}>
          <Scene4_CreateMatch />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={springTiming({ config: { damping: 200 }, durationInFrames: T })}
        />
        <TransitionSeries.Sequence durationInFrames={120}>
          <Scene5_GeneratePOI />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={springTiming({ config: { damping: 200 }, durationInFrames: T })}
        />
        <TransitionSeries.Sequence durationInFrames={100}>
          <Scene6_Engagement />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={springTiming({ config: { damping: 200 }, durationInFrames: T })}
        />
        <TransitionSeries.Sequence durationInFrames={100}>
          <Scene7_Response />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={springTiming({ config: { damping: 200 }, durationInFrames: T })}
        />
        <TransitionSeries.Sequence durationInFrames={140}>
          <Scene8_Problem />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
