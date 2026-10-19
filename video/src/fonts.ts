// Local, pinned fonts with Greek subsets (fontsource woff2 files, bundled by Remotion).
import { continueRender, delayRender } from "remotion";
import inter400 from "@fontsource/inter/files/inter-greek-400-normal.woff2";
import inter600 from "@fontsource/inter/files/inter-greek-600-normal.woff2";
import inter800 from "@fontsource/inter/files/inter-greek-800-normal.woff2";
import inter400l from "@fontsource/inter/files/inter-latin-400-normal.woff2";
import inter600l from "@fontsource/inter/files/inter-latin-600-normal.woff2";
import inter800l from "@fontsource/inter/files/inter-latin-800-normal.woff2";
import mono400 from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2";
import mono400g from "@fontsource/jetbrains-mono/files/jetbrains-mono-greek-400-normal.woff2";
import mono700 from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2";

const faces: [string, string, string][] = [
  ["Inter", inter400, "400"], ["Inter", inter600, "600"], ["Inter", inter800, "800"],
  ["Inter", inter400l, "400"], ["Inter", inter600l, "600"], ["Inter", inter800l, "800"],
  ["JBM", mono400, "400"], ["JBM", mono400g, "400"], ["JBM", mono700, "700"],
];
const handle = delayRender("fonts");
Promise.all(faces.map(([family, url, weight]) => {
  const f = new FontFace(family, `url(${url})`, { weight });
  document.fonts.add(f);
  return f.load();
})).then(() => continueRender(handle));
