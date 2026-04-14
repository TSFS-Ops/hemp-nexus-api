import { Composition } from "remotion";
import { WalkthroughVideo } from "./WalkthroughVideo";

export const RemotionRoot = () => (
  <Composition
    id="main"
    component={WalkthroughVideo}
    durationInFrames={720}
    fps={30}
    width={1920}
    height={1080}
  />
);
