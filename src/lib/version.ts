// The build's version, set by vite.config.ts: package.json version, build day, commit.
import { dayMonth } from "./format";

export const versionLabel = (version: string, day: string, sha: string) =>
  [version, dayMonth(day), sha.slice(0, 7)].filter(Boolean).join(" · ");

export const VERSION = versionLabel(__APP_VERSION__, __APP_BUILT__, __APP_COMMIT__);
