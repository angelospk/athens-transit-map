// The map's own icons, drawn at four times their size (crisp on any screen): the metro's and the tram's marks for
// their stations, and the bus stop's sign. Drawn on a canvas, so nothing to download. From GreekCaptain's fork.

const S = 128;   // the canvas (px); added with pixelRatio 4: 32 px on the map

function canvas(w = S, h = S) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d")!] as const;
}
const data = (c: HTMLCanvasElement) => c.getContext("2d")!.getImageData(0, 0, c.width, c.height);

/** The Athens metro's mark, for its stations close in: a white disc in the green ring, the blue strokes and dot. */
export function metroLogo(): ImageData {
  const [c, g] = canvas();
  const k = S / 960 * 0.92;                                    // a little inside the canvas: the station's own ring shows
  g.translate(S / 2, S / 2); g.scale(k, k); g.translate(-480, -480);
  g.beginPath(); g.arc(480, 480, 435, 0, Math.PI * 2); g.fillStyle = "#fff"; g.fill();
  g.lineWidth = 90; g.strokeStyle = "#00963c"; g.stroke();
  g.fillStyle = "#1c4aaf";
  g.fill(new Path2D("M159 303h108l210 367H373L216 397h-57zM321 303h108l210 367H535L378 397h-57zM484 303h108l210 367H698L541 397h-57z"));
  g.beginPath(); g.arc(213, 533, 55, 0, Math.PI * 2); g.fill();
  return data(c);
}

/** The Athens tram's mark, for its stations close in: the green disc and the black branches and trunks, whole. */
export function tramLogo(): ImageData {
  const [c, g] = canvas();
  const k = (S - 8) / 277.551;
  g.translate((S - 200 * k) / 2, 4); g.scale(k, k);
  g.beginPath(); g.arc(100, 100, 100, 0, Math.PI * 2); g.fillStyle = "#83b81a"; g.fill();
  g.fillStyle = "#000";
  g.fill(new Path2D("M96.467 150.396c-4.842 7.077-8.484 15.043-10.619 23.606-6.998-16.848-23.608-28.696-42.991-28.696v5.715c22.545 0 40.816 18.271 40.816 40.816v85.714h5.714v-85.714c0-13.41 3.896-25.909 10.616-36.429 6.722 10.52 10.609 23.019 10.609 36.429v85.714h5.714v-85.714c0-22.545 18.272-40.816 40.816-40.816v-5.715c-19.385 0-35.998 11.852-42.992 28.702-2.135-8.564-5.771-16.533-10.615-23.612 12.393-16.007 31.8-26.313 53.607-26.313v-5.715c-23.08 0-43.67 10.646-57.139 27.29-13.47-16.646-34.065-27.29-57.146-27.29v5.715c21.808 0 41.213 10.305 53.61 26.314z"));
  return data(c);
}

// A bus stop: OASA's «α» on a white tile (a shadow under it, so it reads on the dark map and the light one). The
// logo (public/icons/oasa.png) loads once; until it has, a plain blue dot on the tile stands in, and MapView swaps
// the image when it comes (oasaLogo). Other cities keep the dot.
let logo: HTMLImageElement | null = null;
let logoP: Promise<HTMLImageElement | null> | null = null;
export function oasaLogo(base = import.meta.env?.BASE_URL ?? "/"): Promise<HTMLImageElement | null> {
  return (logoP ??= new Promise(ok => {
    if (typeof Image === "undefined") { ok(null); return; }
    const img = new Image();
    img.onload = () => { logo = img; ok(img); };
    img.onerror = () => ok(null);
    img.src = `${base}icons/oasa.png`;
  }));
}
// Only Athens's stops are OASA's (`oasa`); elsewhere the tile has the plain dot.
export function stopSign(oasa: boolean): ImageData {
  const [c, g] = canvas();
  g.shadowColor = "rgba(0,0,0,.35)"; g.shadowBlur = 10; g.shadowOffsetY = 4;
  g.fillStyle = "#ffffff";
  g.beginPath(); g.roundRect(20, 16, 88, 88, 24); g.fill();
  g.shadowColor = "transparent";
  if (oasa && logo) g.drawImage(logo, 33, 29, 62, 62);
  else { g.fillStyle = "#00498f"; g.beginPath(); g.arc(64, 60, 22, 0, Math.PI * 2); g.fill(); }
  return data(c);
}
