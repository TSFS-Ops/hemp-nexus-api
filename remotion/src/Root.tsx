import { Composition } from "remotion";
import { YCWalkthrough } from "./YCWalkthrough";

// 60s @ 30fps = 1800 frames
export const RemotionRoot = () => (
  <Composition
    id="main"
    component={YCWalkthrough}
    durationInFrames={1800}
    fps={30}
    width={1920}
    height={1080}
  />
);
