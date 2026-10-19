import React from "react";
import { Composition } from "remotion";
import { Film, DURATION } from "./Film";
import { FPS } from "./tokens";

export const Root: React.FC = () => (
  <>
    <Composition id="film-16x9" component={Film} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} defaultProps={{ fmt: "16x9" as const, audio: "mix.wav" }} />
    <Composition id="film-9x16" component={Film} durationInFrames={DURATION} fps={FPS} width={1080} height={1920} defaultProps={{ fmt: "9x16" as const, audio: "mix.wav" }} />
    <Composition id="silent-16x9" component={Film} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} defaultProps={{ fmt: "16x9" as const }} />
    <Composition id="silent-9x16" component={Film} durationInFrames={DURATION} fps={FPS} width={1080} height={1920} defaultProps={{ fmt: "9x16" as const }} />
  </>
);
