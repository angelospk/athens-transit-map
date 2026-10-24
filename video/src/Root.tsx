import React from "react";
import { Composition } from "remotion";
import "./fonts";
import { Film, DURATION } from "./Film";
import { FPS } from "./tokens";
import { FilmA, DURATION_A } from "./promo/FilmA";
import { FilmB, DURATION_B } from "./promo/FilmB";

export const Root: React.FC = () => (
  <>
    <Composition id="film-16x9" component={Film} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} defaultProps={{ fmt: "16x9" as const, audio: "mix.wav" }} />
    <Composition id="film-9x16" component={Film} durationInFrames={DURATION} fps={FPS} width={1080} height={1920} defaultProps={{ fmt: "9x16" as const, audio: "mix.wav" }} />
    <Composition id="silent-16x9" component={Film} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} defaultProps={{ fmt: "16x9" as const }} />
    <Composition id="silent-9x16" component={Film} durationInFrames={DURATION} fps={FPS} width={1080} height={1920} defaultProps={{ fmt: "9x16" as const }} />
    <Composition id="promo-a" component={FilmA} durationInFrames={DURATION_A} fps={FPS} width={1080} height={1920} defaultProps={{ audio: "promo-a.wav" }} />
    <Composition id="promo-a-silent" component={FilmA} durationInFrames={DURATION_A} fps={FPS} width={1080} height={1920} defaultProps={{}} />
    <Composition id="promo-b" component={FilmB} durationInFrames={DURATION_B} fps={FPS} width={1920} height={1080} defaultProps={{ audio: "promo-b.wav" }} />
    <Composition id="promo-b-silent" component={FilmB} durationInFrames={DURATION_B} fps={FPS} width={1920} height={1080} defaultProps={{}} />
  </>
);
